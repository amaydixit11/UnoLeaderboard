'use server'

import { createClient } from '@supabase/supabase-js'
import { calculateEloChanges } from '@/lib/elo'
import { calculateCFChanges } from '@/lib/multiplayer'
import { calculateOSChanges, newOSRating, osOrdinal } from '@/lib/openskill_wrapper'
import { computeWHR, WHRGame } from '@/lib/whr'
import { normalizeRankings } from '@/lib/ranking'
import { revalidatePath } from 'next/cache'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const supabase = createClient(supabaseUrl, supabaseKey)

export async function submitGame(formData: { playerId: string; position: number }[]) {
  // 1. Normalize rankings
  const normalized = normalizeRankings(formData)
  
  // 2. Fetch current ratings for all players
  const playerIds = normalized.map(p => p.playerId)
  const { data: players, error: fetchError } = await supabase
    .from('players')
    .select('id, initial_elo, cf_rating, os_mu, os_sigma, os_ordinal, whr_rating')
    .in('id', playerIds)

  if (fetchError || !players) {
    throw new Error('Failed to fetch players')
  }

  // 2b. Fetch games played count per player (for K-factor)
  const gamesPlayedMap: Record<string, number> = {}
  for (const pid of playerIds) {
    const { count } = await supabase
      .from('game_results')
      .select('*', { count: 'exact', head: true })
      .eq('player_id', pid)
    gamesPlayedMap[pid] = count ?? 0
  }

  // ============================================================
  // 3a. Pairwise Elo
  // ============================================================
  const eloInput = normalized.map(n => {
    const player = players.find(p => p.id === n.playerId)!
    return {
      id: player.id,
      elo: player.initial_elo,
      gamesPlayed: gamesPlayedMap[n.playerId] ?? 0,
      position: n.normalizedPosition
    }
  })
  const eloChanges = calculateEloChanges(eloInput)

  // ============================================================
  // 3b. CF Expected Rank
  // ============================================================
  const cfInput = normalized.map(n => {
    const player = players.find(p => p.id === n.playerId)!
    return {
      id: player.id,
      rating: player.cf_rating ?? 1000,
      gamesPlayed: gamesPlayedMap[n.playerId] ?? 0,
      position: n.normalizedPosition
    }
  })
  const cfChanges = calculateCFChanges(cfInput)

  // ============================================================
  // 3c. OpenSkill (Bayesian Plackett-Luce)
  // ============================================================
  const osInput = normalized.map(n => {
    const player = players.find(p => p.id === n.playerId)!
    return {
      id: player.id,
      mu: player.os_mu ?? 25,
      sigma: player.os_sigma ?? 8.333,
      position: n.normalizedPosition
    }
  })
  const osChanges = calculateOSChanges(osInput)

  // ============================================================
  // 4. Create game record
  // ============================================================
  const { data: game, error: gameError } = await supabase
    .from('games')
    .insert({
      total_players: normalized.length,
      played_at: new Date().toISOString()
    })
    .select()
    .single()

  if (gameError) throw new Error('Failed to create game: ' + gameError.message)

  // ============================================================
  // 5. Insert results & update player ratings (Elo + CF + OS)
  // ============================================================
  const resultsToInsert = []
  
  for (const n of normalized) {
    const player = players.find(p => p.id === n.playerId)!
    const eloChange = eloChanges[n.playerId]
    const newElo = player.initial_elo + eloChange
    const cfChange = cfChanges[n.playerId]
    const cfBefore = player.cf_rating ?? 1000
    const newCf = cfBefore + cfChange
    const os = osChanges[n.playerId]
    const osBefore = osOrdinal({ mu: player.os_mu ?? 25, sigma: player.os_sigma ?? 8.333 })

    resultsToInsert.push({
      game_id: game.id,
      player_id: n.playerId,
      raw_positions: n.rawPositions,
      normalized_position: n.normalizedPosition,
      elo_before: player.initial_elo,
      elo_after: newElo,
      elo_change: eloChange,
      cf_before: cfBefore,
      cf_after: newCf,
      cf_change: cfChange,
      os_before: osBefore,
      os_after: os.ordinal,
      os_change: os.change,
      // WHR filled in by batch recomputation below
      whr_before: null,
      whr_after: null,
      whr_change: null,
    })

    // Update player: Elo + CF + OpenSkill (WHR updated separately)
    const { error: updateError } = await supabase
      .from('players')
      .update({
        initial_elo: newElo,
        cf_rating: newCf,
        os_mu: os.mu,
        os_sigma: os.sigma,
        os_ordinal: os.ordinal,
      })
      .eq('id', n.playerId)
    
    if (updateError) console.error('Error updating player ratings', updateError)
  }

  const { error: resultsError } = await supabase
    .from('game_results')
    .insert(resultsToInsert)

  if (resultsError) throw new Error('Failed to save results: ' + resultsError.message)

  // ============================================================
  // 6. WHR batch recomputation (processes all games from scratch)
  // ============================================================
  try {
    await recomputeWHR()
  } catch (e) {
    console.error('WHR recomputation failed (non-fatal):', e)
  }

  revalidatePath('/')
  revalidatePath('/history')
  
  return { success: true, gameId: game.id }
}

/**
 * Batch WHR recomputation. Fetches all games, runs WHR, 
 * then updates game_results and players tables.
 */
async function recomputeWHR() {
  // Fetch all games + results
  const { data: allGames } = await supabase
    .from('games')
    .select('id, played_at')
    .order('played_at', { ascending: true })

  if (!allGames || allGames.length === 0) return

  const { data: allResults } = await supabase
    .from('game_results')
    .select('id, game_id, player_id, normalized_position')

  if (!allResults) return

  // Build WHR input
  const whrGames: WHRGame[] = allGames.map(g => ({
    gameId: g.id,
    playedAt: new Date(g.played_at),
    players: allResults
      .filter(r => r.game_id === g.id)
      .map(r => ({ playerId: r.player_id, position: parseFloat(r.normalized_position) }))
  }))

  // Run WHR
  const whrResult = computeWHR(whrGames)

  // Update game_results with WHR snapshots
  for (const game of allGames) {
    const snapshot = whrResult.gameSnapshots[game.id]
    const changes = whrResult.gameChanges[game.id]
    if (!snapshot) continue

    for (const r of allResults.filter(r => r.game_id === game.id)) {
      const whrAfter = snapshot[r.player_id] ?? 1000
      const whrChange = changes[r.player_id] ?? 0
      const whrBefore = whrAfter - whrChange

      await supabase
        .from('game_results')
        .update({ whr_before: whrBefore, whr_after: whrAfter, whr_change: whrChange })
        .eq('id', r.id)
    }
  }

  // Update player final WHR ratings
  for (const [playerId, rating] of Object.entries(whrResult.playerRatings)) {
    await supabase
      .from('players')
      .update({ whr_rating: rating })
      .eq('id', playerId)
  }
}

export async function createPlayer(name: string) {
  const r = newOSRating()
  const { data, error } = await supabase
    .from('players')
    .insert({ 
      name, 
      initial_elo: 1000, 
      cf_rating: 1000,
      os_mu: r.mu,
      os_sigma: r.sigma,
      os_ordinal: osOrdinal(r),
      whr_rating: 1000,
    })
    .select()
    .single()
    
  if (error) return { error: error.message }
  revalidatePath('/')
  return { success: true, player: data }
}

export async function getPlayers() {
  const { data } = await supabase.from('players').select('*').order('name')
  return data || []
}
