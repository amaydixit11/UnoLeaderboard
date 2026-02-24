/**
 * Recalculate all historical Elo ratings using the new dynamic K-factor.
 * 
 * This script:
 * 1. Resets all players to Elo 1000
 * 2. Processes all games chronologically  
 * 3. Recalculates Elo using the exponential decay K-factor: K(n) = 16 + 16*e^(-n/20)
 * 4. Updates game_results with corrected elo_before, elo_after, elo_change
 * 5. Updates players with final Elo
 */

import { createClient } from '@supabase/supabase-js'
import { calculateEloChanges } from '../lib/elo'
import fs from 'fs'
import path from 'path'

// Load env vars
function loadEnv() {
  try {
    const envPath = path.resolve(process.cwd(), '.env.local')
    const envFile = fs.readFileSync(envPath, 'utf8')
    const envVars: Record<string, string> = {}
    envFile.split('\n').forEach(line => {
      const [key, value] = line.split('=')
      if (key && value) envVars[key.trim()] = value.trim()
    })
    return envVars
  } catch {
    console.warn('Could not read .env.local, relying on process.env')
    return {}
  }
}

const env = loadEnv()
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase credentials')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)

async function recalculate() {
  console.log('🔄 Starting Elo recalculation with dynamic K-factor...\n')

  // 1. Fetch all players
  const { data: players, error: pErr } = await supabase.from('players').select('*')
  if (pErr || !players) throw new Error('Failed to fetch players: ' + pErr?.message)

  // 2. Fetch all games, sorted chronologically
  const { data: games, error: gErr } = await supabase
    .from('games')
    .select('*')
    .order('played_at', { ascending: true })
  if (gErr || !games) throw new Error('Failed to fetch games: ' + gErr?.message)

  // 3. Fetch all game_results
  const { data: allResults, error: rErr } = await supabase.from('game_results').select('*')
  if (rErr || !allResults) throw new Error('Failed to fetch results: ' + rErr?.message)

  // 4. Reset all player Elos to 1000 (in memory)
  const currentElo: Record<string, number> = {}
  const gamesPlayedCount: Record<string, number> = {}
  
  for (const p of players) {
    currentElo[p.id] = 1000
    gamesPlayedCount[p.id] = 0
  }

  console.log(`Found ${players.length} players, ${games.length} games, ${allResults.length} results\n`)

  // 5. Process each game chronologically
  for (const game of games) {
    // Get results for this game
    const gameResults = allResults
      .filter(r => r.game_id === game.id)
      .sort((a, b) => a.normalized_position - b.normalized_position)

    if (gameResults.length === 0) {
      console.log(`⚠️  Game ${game.id} has no results, skipping`)
      continue
    }

    const playerName = (id: string) => players.find(p => p.id === id)?.name || id

    // Build Elo input using existing normalized positions (these don't change)
    const eloInput = gameResults.map(r => ({
      id: r.player_id,
      elo: currentElo[r.player_id],
      gamesPlayed: gamesPlayedCount[r.player_id] ?? 0,
      position: parseFloat(r.normalized_position)
    }))

    // Calculate new Elo changes with dynamic K-factor
    const eloChanges = calculateEloChanges(eloInput)

    // Log
    const dateStr = new Date(game.played_at).toLocaleDateString()
    console.log(`📅 ${dateStr} — ${gameResults.length} players`)

    // Update each result in the database and track new Elo
    for (const r of gameResults) {
      const oldEloBefore = r.elo_before
      const oldEloChange = r.elo_change

      const newEloBefore = currentElo[r.player_id]
      const newEloChange = eloChanges[r.player_id]
      const newEloAfter = newEloBefore + newEloChange

      // Update the game_result row
      const { error: updateErr } = await supabase
        .from('game_results')
        .update({
          elo_before: newEloBefore,
          elo_after: newEloAfter,
          elo_change: newEloChange
        })
        .eq('id', r.id)

      if (updateErr) {
        console.error(`  ❌ Failed to update result ${r.id}:`, updateErr.message)
      }

      const kFactor = (16 + 16 * Math.exp(-(gamesPlayedCount[r.player_id] ?? 0) / 20)).toFixed(1)
      const diff = newEloChange - oldEloChange
      console.log(
        `   ${playerName(r.player_id).padEnd(10)} K=${kFactor.padEnd(5)} ` +
        `Elo: ${oldEloBefore}→${r.elo_after} (old: ${oldEloChange > 0 ? '+' : ''}${oldEloChange}) → ` +
        `${newEloBefore}→${newEloAfter} (new: ${newEloChange > 0 ? '+' : ''}${newEloChange}) ` +
        `${diff !== 0 ? `[Δ${diff > 0 ? '+' : ''}${diff}]` : ''}`
      )

      // Update in-memory Elo
      currentElo[r.player_id] = newEloAfter
    }

    // Increment games played
    for (const r of gameResults) {
      gamesPlayedCount[r.player_id] = (gamesPlayedCount[r.player_id] ?? 0) + 1
    }

    console.log()
  }

  // 6. Update all player Elos in the database
  console.log('\n📊 Final Elo ratings:')
  console.log('─'.repeat(40))

  const finalRankings = players
    .map(p => ({ name: p.name, oldElo: p.initial_elo, newElo: currentElo[p.id], games: gamesPlayedCount[p.id] }))
    .sort((a, b) => b.newElo - a.newElo)

  for (const r of finalRankings) {
    const diff = r.newElo - r.oldElo
    console.log(
      `  ${r.name.padEnd(12)} ${r.oldElo} → ${r.newElo} ` +
      `(${diff > 0 ? '+' : ''}${diff}) [${r.games} games, K=${(16 + 16 * Math.exp(-r.games / 20)).toFixed(1)}]`
    )

    await supabase
      .from('players')
      .update({ initial_elo: r.newElo })
      .eq('id', players.find(p => p.name === r.name)!.id)
  }

  console.log('\n✅ Recalculation complete!')
}

recalculate().catch(console.error)
