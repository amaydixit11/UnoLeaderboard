'use server'

import { createClient } from '@supabase/supabase-js'
import { calculateEloChanges } from '@/lib/elo'
import { normalizeRankings } from '@/lib/ranking'
import { revalidatePath } from 'next/cache'

// Note: In a server action, we shouldn't use the client-side singleton if we want to be safe with auth/headers in future (for Next.js Auth),
// but for now, generic Supabase client is fine since we are using Service Role for admin tasks or just specific client.
// However, since we are doing Elo updates, we should probably use a Service Role key if RLS allows or just standard key if policies allow.
// Using the env vars directly here.

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
// WE NEED SERVICE ROLE KEY to bypass RLS policies if we lock them down, or just to be safe. 
// But the user might not have provided it. We will use the ANON key and rely on the open policies we set.
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const supabase = createClient(supabaseUrl, supabaseKey)

export async function submitGame(formData: { playerId: string; position: number }[]) {
  // 1. Normalize rankings
  const normalized = normalizeRankings(formData)
  
  // 2. Fetch current Elo for all players involved
  const playerIds = normalized.map(p => p.playerId)
  const { data: players, error: fetchError } = await supabase
    .from('players')
    .select('id, initial_elo') // treating initial_elo as current
    .in('id', playerIds)

  if (fetchError || !players) {
    throw new Error('Failed to fetch players')
  }

  // 2b. Fetch actual games played count for each player (for K-factor calculation)
  const gamesPlayedMap: Record<string, number> = {}
  for (const pid of playerIds) {
    const { count } = await supabase
      .from('game_results')
      .select('*', { count: 'exact', head: true })
      .eq('player_id', pid)
    gamesPlayedMap[pid] = count ?? 0
  }

  // Map to format needed for Elo calc
  const eloInput = normalized.map(n => {
    const player = players.find(p => p.id === n.playerId)
    if (!player) throw new Error(`Player ${n.playerId} not found`)
    return {
      id: player.id,
      elo: player.initial_elo,
      gamesPlayed: gamesPlayedMap[n.playerId] ?? 0,
      position: n.normalizedPosition
    }
  })

  // 3. Calculate Elo changes
  const eloChanges = calculateEloChanges(eloInput)

  // 4. Save to DB in a "transaction" (manual steps since no procedure)
  
  // A. Create Game
  const { data: game, error: gameError } = await supabase
    .from('games')
    .insert({
      total_players: normalized.length,
      played_at: new Date().toISOString()
    })
    .select()
    .single()

  if (gameError) throw new Error('Failed to create game: ' + gameError.message)

  // B. Create Game Results & Update Players
  const resultsToInsert = []
  
  for (const n of normalized) {
    const player = players.find(p => p.id === n.playerId)!
    const change = eloChanges[n.playerId]
    const newElo = player.initial_elo + change

    resultsToInsert.push({
      game_id: game.id,
      player_id: n.playerId,
      raw_positions: n.rawPositions,
      normalized_position: n.normalizedPosition,
      elo_before: player.initial_elo,
      elo_after: newElo,
      elo_change: change
    })

    // Update Player Elo
    const { error: updateError } = await supabase
      .from('players')
      .update({ initial_elo: newElo })
      .eq('id', n.playerId)
    
    if (updateError) console.error('Error updating player elo', updateError)
  }

  const { error: resultsError } = await supabase
    .from('game_results')
    .insert(resultsToInsert)

  if (resultsError) throw new Error('Failed to save results: ' + resultsError.message)

  revalidatePath('/')
  revalidatePath('/history')
  
  return { success: true, gameId: game.id }
}

export async function createPlayer(name: string) {
  const { data, error } = await supabase
    .from('players')
    .insert({ name, initial_elo: 1000 })
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
