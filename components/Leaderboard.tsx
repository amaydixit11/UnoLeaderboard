'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Player } from '@/types'
import { ArrowUp, ArrowDown, Hash, Trophy, Info, Minus } from 'lucide-react'
import { cn } from '@/lib/utils'
import Link from 'next/link'
import SkillDistributionChart from './SkillDistributionChart'

type RatingMode = 'elo' | 'cf' | 'os' | 'whr'

const MODES: { key: RatingMode; label: string }[] = [
  { key: 'elo', label: 'Pairwise' },
  { key: 'cf', label: 'CF' },
  { key: 'os', label: 'OpenSkill' },
  { key: 'whr', label: 'WHR' },
]

type PlayerStats = Player & {
  gamesPlayed: number
  recentEloChange: number
  recentCfChange: number
  recentOsChange: number
  recentWhrChange: number
  cf_rating: number
  os_ordinal: number
  whr_rating: number
  os_mu: number
  os_sigma: number
}

export default function Leaderboard() {
  const [players, setPlayers] = useState<PlayerStats[]>([])
  const [loading, setLoading] = useState(true)
  const [mode, setMode] = useState<RatingMode>('os')
  const [showComparison, setShowComparison] = useState(false)

  const fetchLeaderboard = async () => {
    const { data: playersData, error: playersError } = await supabase
      .from('players')
      .select('*')
      .order('initial_elo', { ascending: false })

    if (playersError) {
      console.error('Error fetching players:', playersError)
      return
    }

    const { data: allResults } = await supabase
      .from('game_results')
      .select('player_id, elo_change, cf_change, os_change, whr_change')
      .order('created_at', { ascending: false })

    const statsMap: Record<string, { gamesPlayed: number; recentEloChange: number; recentCfChange: number; recentOsChange: number; recentWhrChange: number }> = {}
    if (allResults) {
      for (const r of allResults) {
        if (!statsMap[r.player_id]) {
          statsMap[r.player_id] = {
            gamesPlayed: 0,
            recentEloChange: r.elo_change,
            recentCfChange: r.cf_change ?? 0,
            recentOsChange: r.os_change ?? 0,
            recentWhrChange: r.whr_change ?? 0,
          }
        }
        statsMap[r.player_id].gamesPlayed++
      }
    }

    const mappedPlayers = playersData.map((p) => ({
      ...p,
      elo: p.initial_elo,
      cf_rating: p.cf_rating ?? 1000,
      os_ordinal: p.os_ordinal ?? 0,
      whr_rating: p.whr_rating ?? 1000,
      os_mu: p.os_mu ?? 25,
      os_sigma: p.os_sigma ?? 8.333,
      gamesPlayed: statsMap[p.id]?.gamesPlayed ?? 0,
      recentEloChange: statsMap[p.id]?.recentEloChange ?? 0,
      recentCfChange: statsMap[p.id]?.recentCfChange ?? 0,
      recentOsChange: statsMap[p.id]?.recentOsChange ?? 0,
      recentWhrChange: statsMap[p.id]?.recentWhrChange ?? 0,
    }))

    setPlayers(mappedPlayers)
    setLoading(false)
  }

  useEffect(() => {
    fetchLeaderboard()
    const channel = supabase
      .channel('leaderboard_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'game_results' }, () => fetchLeaderboard())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'players' }, () => fetchLeaderboard())
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [])

  const getRankColor = (index: number) => {
    switch (index) {
      case 0: return 'text-uno-yellow drop-shadow-[0_0_8px_rgba(254,202,0,0.5)]'
      case 1: return 'text-uno-green'
      case 2: return 'text-uno-blue'
      default: return 'text-foreground'
    }
  }

  const getRating = (p: PlayerStats) => {
    switch (mode) {
      case 'cf': return p.cf_rating
      case 'os': return p.os_ordinal
      case 'whr': return p.whr_rating
      default: return p.initial_elo
    }
  }

  const getChange = (p: PlayerStats) => {
    switch (mode) {
      case 'cf': return p.recentCfChange
      case 'os': return p.recentOsChange
      case 'whr': return p.recentWhrChange
      default: return p.recentEloChange
    }
  }

  const sorted = [...players].sort((a, b) => getRating(b) - getRating(a))

  if (loading) return <div className="p-8 text-center animate-pulse font-mono text-accent">SHUFFLING DECK...</div>

  return (
    <div className="space-y-4">
      <div className="w-full max-w-4xl mx-auto border-4 border-foreground p-1 shadow-[8px_8px_0px_0px_var(--uno-red)] bg-background">
        <div className="bg-uno-red text-white p-4 font-mono font-bold text-xl uppercase tracking-tighter flex justify-between items-center shadow-sm flex-wrap gap-2">
          <div className="flex items-center gap-3">
            <span>Leaderboard</span>
            <button 
              onClick={() => setShowComparison(!showComparison)}
              className={cn(
                "text-[10px] px-2 py-1 border border-white/30 hover:bg-white hover:text-uno-red transition-all",
                showComparison && "bg-white text-uno-red"
              )}
            >
              Compare Top 5
            </button>
          </div>
          <div className="flex items-center gap-2">
            {/* 4-way Rating Mode Toggle */}
            <div className="flex bg-black/30 text-[10px] md:text-xs rounded-none overflow-hidden mt-2 md:mt-0 w-full md:w-auto">
              {MODES.map(m => (
                <button
                  key={m.key}
                  onClick={() => setMode(m.key)}
                  className={cn(
                    "flex-1 md:flex-none px-1 md:px-3 py-1.5 transition-colors font-bold uppercase tracking-wider",
                    mode === m.key ? "bg-white text-uno-red" : "hover:bg-white/10"
                  )}
                >
                  {m.label}
                </button>
              ))}
            </div>
            <span className="text-sm bg-black/20 px-2 py-1 rounded hidden md:inline">Season 1</span>
          </div>
        </div>
      
        <div className="divide-y-2 divide-foreground/10">
          <div className="grid grid-cols-12 gap-2 md:gap-4 p-3 md:p-4 font-mono text-[10px] md:text-sm opacity-50 uppercase tracking-wider">
            <div className="col-span-2 md:col-span-1">Rank</div>
            <div className="col-span-5 md:col-span-4">Player</div>
            <div className="col-span-3 md:col-span-3 text-right">Rating</div>
            <div className="hidden md:block md:col-span-2 text-center">Games</div>
            <div className="col-span-2 md:col-span-2 text-right">Trend</div>
          </div>

          {sorted.map((player, index) => {
            const ratingValue = getRating(player)
            const recentChange = getChange(player)

            return (
              <div 
                key={player.id} 
                className="grid grid-cols-12 gap-2 md:gap-4 p-4 items-center hover:bg-white/5 transition-colors group relative overflow-hidden"
              >
                <div className={cn(
                   "absolute left-0 top-0 bottom-0 w-1",
                   index === 0 ? "bg-uno-yellow" : index === 1 ? "bg-uno-green" : index === 2 ? "bg-uno-blue" : "bg-transparent"
                )} />

                <div className={cn("col-span-2 md:col-span-1 font-mono text-xl md:text-2xl font-black", getRankColor(index))}>
                  #{index + 1}
                </div>
                <div className="col-span-5 md:col-span-4 font-bold text-base md:text-lg truncate">
                  <Link href={`/player/${player.id}`} className="hover:text-uno-blue transition-colors hover:underline underline-offset-4">
                    {player.name}
                  </Link>
                  {index === 0 && <span className="ml-2 text-base">👑</span>}
                  {index === sorted.length - 1 && <span className="ml-2 text-base">🍆</span>}
                </div>
                <div className="col-span-3 md:col-span-3 text-right font-mono text-lg md:text-xl font-bold tabular-nums">
                  {ratingValue}
                </div>
                <div className="hidden md:flex md:col-span-2 justify-center items-center gap-1 font-mono text-sm opacity-40">
                  <Hash size={12} />
                  {player.gamesPlayed}
                </div>
                <div className="col-span-2 md:col-span-2 flex justify-end items-center gap-1 font-mono text-sm font-bold">
                  {recentChange > 0 ? (
                    <span className="flex items-center gap-1 text-uno-green">
                      <ArrowUp size={14} />
                      +{recentChange}
                    </span>
                  ) : recentChange < 0 ? (
                    <span className="flex items-center gap-1 text-uno-red">
                      <ArrowDown size={14} />
                      {recentChange}
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 opacity-20">
                      <Minus size={14} />
                    </span>
                  )}
                </div>
              </div>
            )
          })}

          {players.length === 0 && (
            <div className="p-12 text-center text-foreground/50 font-mono">
              <div className="text-4xl mb-4">🎴</div>
              No players found. Deal the first hand!
            </div>
          )}
        </div>
      </div>

      {/* Bayesian Comparison Overlay */}
      {showComparison && (
        <div className="w-full max-w-4xl mx-auto border-4 border-foreground p-6 bg-white/5 shadow-[8px_8px_0px_0px_var(--uno-green)]">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-2 text-uno-green">
              <Info size={18} />
              <h2 className="font-mono font-bold text-lg uppercase">Skill Probabilities (Top 5)</h2>
            </div>
            <button onClick={() => setShowComparison(false)} className="text-[10px] uppercase font-mono px-2 py-1 bg-white/10 hover:bg-white/20 transition-colors">Close</button>
          </div>
          <SkillDistributionChart 
            players={sorted.slice(0, 5).map((p, i) => ({
              name: p.name,
              mu: p.os_mu,
              sigma: p.os_sigma,
              color: ['#feca00', '#22c55e', '#2563eb', '#ef4444', '#a855f7'][i] || '#ffffff'
            }))}
          />
          <div className="mt-6 p-4 bg-white/10 font-mono text-xs leading-relaxed">
            <p className="opacity-70">
              <span className="text-white font-bold">THE MATH:</span> This graph plots the Bayesian probability density for each player. The overlap between curves shows how likely an upset is. A <span className="underline decoration-uno-green">skinnier curve</span> means the system is very confident in that player's skill level.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
