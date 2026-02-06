
import { createClient } from '@supabase/supabase-js'
import { calculateEloChanges } from '../lib/elo'
import { normalizeRankings } from '../lib/ranking'
import fs from 'fs'
import path from 'path'

// Load env vars manually since we are not in Next.js runtime
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
  } catch (e) {
    console.warn('Could not read .env.local, relying on process.env')
    return {}
  }
}

const env = loadEnv()
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase credentials in .env.local')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)

// --- DATA ---
// Chronological Order: Jan 7, then Feb 6 (1:20 PM -> 1:50 PM -> 10:46 PM -> 11:30 PM)

const gamesData = [
  {
    date: '2026-01-07T12:00:00Z', // Jan 7, 2026 (Corrected from 2025 typo)
    raw: ['Chetan', 'Rishi', 'Rohit', 'Saurav', 'Kabeer', 'Amay', 'Akshay']
  },
  {
    date: '2026-02-06T13:20:00Z', // 1:20 PM
    raw: ['Rohit', 'Kabeer', 'Amay', 'Saurav', 'Chetan', 'Akshay', 'Rohit', 'Akshay', 'Rohit']
  },
  {
    date: '2026-02-06T13:50:00Z', // 1:50 PM
    raw: ['Rishi', 'Akshay', 'Chetan', 'Saurav', 'Amay', 'Kabeer', 'Rohit', 'Kabeer', 'Amay', 'Kabeer', 'Kabeer']
  },
  {
    date: '2026-02-05T22:46:00Z', // 10:46 PM
    raw: ['Shashank', 'Amay', 'Kabeer', 'Rohit', 'Rishi', 'Chetan', 'Rohit', 'Kabeer', 'Rohit']
  },
  {
    date: '2026-02-05T23:30:00Z', // 11:30 PM
    raw: ['Rohit', 'Akshay', 'Saurav', 'Amay', 'Farhan', 'Rishi']
  }
]

async function seed() {
  console.log('🌱 Starting seed process...')

  // 1. Get or Create Players
  const uniqueNames = new Set<string>()
  gamesData.forEach(g => g.raw.forEach(n => uniqueNames.add(n)))
  
  const playerMap = new Map<string, any>() // Name -> DB Object

  for (const name of uniqueNames) {
    let { data: existing } = await supabase.from('players').select('*').eq('name', name).single()
    
    if (!existing) {
      console.log(`Creating player: ${name}`)
      const { data: newPlayer, error } = await supabase
        .from('players')
        .insert({ name, initial_elo: 1000 })
        .select()
        .single()
      
      if (error) throw new Error(`Failed to create ${name}: ${error.message}`)
      existing = newPlayer
    } else {
      // RESET Elo for consistent history replay
      const { data: resetResult, error: resetError } = await supabase
        .from('players')
        .update({ initial_elo: 1000 })
        .eq('id', existing.id)
        .select()
        .single()
        
        if (resetError) console.error('Reset error', resetError)
        existing = resetResult
    }
    
    playerMap.set(name, existing)
  }
  
  // 2. Clear All Games to prevent duplicate history
  console.log('⚠️ Clearing ALL game history...')
  await supabase.from('game_results').delete().neq('id', '00000000-0000-0000-0000-000000000000') 
  await supabase.from('games').delete().neq('id', '00000000-0000-0000-0000-000000000000') 

  // 3. Process Games
  for (const gameData of gamesData) {
    console.log(`\nProcessing Game: ${gameData.date}`)
    
    // Prepare input for normalization
    const rawInputs = gameData.raw.map((name, index) => {
      const p = playerMap.get(name)
      return { playerId: p.id, position: index + 1 }
    })

    const normalized = normalizeRankings(rawInputs)
    
    // Fetch latest Elo states
    const playerIds = normalized.map(p => p.playerId)
    const { data: currentPlayers } = await supabase
        .from('players')
        .select('id, initial_elo')
        .in('id', playerIds)
    
    // Prepare for Elo Calc
    const eloCalcInput = normalized.map(n => {
        const p = currentPlayers?.find(cp => cp.id === n.playerId)
        if (!p) throw new Error(`Player ${n.playerId} not found during recalculation`)
        return {
            id: n.playerId,
            elo: p.initial_elo,
            gamesPlayed: 10, 
            position: n.normalizedPosition
        }
    })

    const eloChanges = calculateEloChanges(eloCalcInput)
    console.log('Elo Changes:', eloChanges)

    // Insert Game
    const { data: gameRow, error: gErr } = await supabase
        .from('games')
        .insert({
            played_at: gameData.date,
            total_players: normalized.length
        })
        .select()
        .single()
        
    if (gErr) throw new Error(gErr.message)

    // Insert Results & Update Players
    const resultsPayload = []
    
    for (const n of normalized) {
        const p = currentPlayers?.find(cp => cp.id === n.playerId)!
        const change = eloChanges[n.playerId]
        const newElo = p.initial_elo + change
        
        resultsPayload.push({
            game_id: gameRow.id,
            player_id: n.playerId,
            raw_positions: n.rawPositions,
            normalized_position: n.normalizedPosition,
            elo_before: p.initial_elo,
            elo_after: newElo,
            elo_change: change
        })

        await supabase.from('players').update({ initial_elo: newElo }).eq('id', n.playerId)
    }

    await supabase.from('game_results').insert(resultsPayload)
  }

  console.log('\n✅ Seed complete!')
}

seed().catch(console.error)
