'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Player } from '@/types'
import { ArrowUp, ArrowDown, Minus } from 'lucide-react'
import { cn } from '@/lib/utils'

type PlayerStats = Player & {
  gamesPlayed: number
  recentChange: number
}

export default function Leaderboard() {
  const [players, setPlayers] = useState<PlayerStats[]>([])
  const [loading, setLoading] = useState(true)

  const fetchLeaderboard = async () => {
    // 1. Fetch players
    const { data: playersData, error: playersError } = await supabase
      .from('players')
      .select('*')
      .order('initial_elo', { ascending: false }) // Fallback sort

    if (playersError) {
      console.error('Error fetching players:', playersError)
      return
    }

    // 2. Fetch recent games for stats (simplified for MVP)
    // In a real app, you'd likely have a materialized view or aggregated table
    // For now, we'll fetch basic stats or just trust the 'initial_elo' which is actually 'current_elo' in our simplified schema logic 
    // (Wait, my schema defined 'initial_elo', I should probably have used 'current_elo' or just 'elo'. 
    // I will assume 'initial_elo' is updated to be the current elo for simplicity, or I should have renamed it.
    // Let's assume the 'initial_elo' column tracks current Elo for now, or I'll fix the schema mental model.)
    // Actually, looking at my logic plan, I said "Update players table with new Elos". 
    // So 'initial_elo' is a bad name if it changes. I'll treat it as 'elo'.

    const mappedPlayers = playersData.map((p) => ({
      ...p,
      elo: p.initial_elo, // treating as current
      gamesPlayed: 0, // TODO: Count from games
      recentChange: 0, // TODO: Get from last game
    }))

    // Sort by Elo
    mappedPlayers.sort((a, b) => b.elo - a.elo)

    setPlayers(mappedPlayers)
    setLoading(false)
  }

  useEffect(() => {
    fetchLeaderboard()

    // Real-time subscription
    const channel = supabase
      .channel('leaderboard_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'game_results' }, () => {
        fetchLeaderboard()
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'players' }, () => {
        fetchLeaderboard()
      })
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [])

  const getRankColor = (index: number) => {
    switch (index) {
      case 0: return 'text-uno-yellow drop-shadow-[0_0_8px_rgba(254,202,0,0.5)]' // 1st
      case 1: return 'text-uno-green'  // 2nd
      case 2: return 'text-uno-blue'   // 3rd
      default: return 'text-foreground'
    }
  }

  if (loading) return <div className="p-8 text-center animate-pulse font-mono text-accent">SHUFFLING DECK...</div>

  return (
    <div className="w-full max-w-4xl mx-auto border-4 border-foreground p-1 shadow-[8px_8px_0px_0px_var(--uno-red)] bg-background">
      <div className="bg-uno-red text-white p-4 font-mono font-bold text-xl uppercase tracking-tighter flex justify-between items-center shadow-sm">
        <span>Leaderboard</span>
        <span className="text-sm bg-black/20 px-2 py-1 rounded">Season 1</span>
      </div>
      
      <div className="divide-y-2 divide-foreground/10">
        <div className="grid grid-cols-12 gap-2 md:gap-4 p-3 md:p-4 font-mono text-xs md:text-sm opacity-50 uppercase tracking-wider">
          <div className="col-span-2 md:col-span-2">Rank</div>
          <div className="col-span-6 md:col-span-5">Player</div>
          <div className="col-span-4 md:col-span-3 text-right">Rating</div>
          <div className="hidden md:block md:col-span-2 text-right">Trend</div>
        </div>

        {players.map((player, index) => (
          <div 
            key={player.id} 
            className="grid grid-cols-12 gap-2 md:gap-4 p-4 items-center hover:bg-white/5 transition-colors group relative overflow-hidden"
          >
            {/* Color accent bar on left */}
            <div className={cn(
               "absolute left-0 top-0 bottom-0 w-1",
               index === 0 ? "bg-uno-yellow" : index === 1 ? "bg-uno-green" : index === 2 ? "bg-uno-blue" : "bg-transparent"
            )} />

            <div className={cn("col-span-2 font-mono text-xl md:text-2xl font-black", getRankColor(index))}>
              #{index + 1}
            </div>
            <div className="col-span-6 md:col-span-5 font-bold text-base md:text-lg truncate">
              {player.name}
              {index === 0 && <span className="ml-2 text-base">👑</span>}
              {index === players.length - 1 && <span className="ml-2 text-base">🍆</span>}
            </div>
            <div className="col-span-4 md:col-span-3 text-right font-mono text-lg md:text-xl font-bold tabular-nums">
              {player.initial_elo}
            </div>
            <div className="hidden md:flex md:col-span-2 justify-end">
              <Minus className="opacity-20" />
            </div>
          </div>
        ))}

        {players.length === 0 && (
          <div className="p-12 text-center text-foreground/50 font-mono">
            <div className="text-4xl mb-4">🎴</div>
            No players found. Deal the first hand!
          </div>
        )}
      </div>
    </div>
  )
}
