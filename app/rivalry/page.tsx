'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import Link from 'next/link'
import { ArrowLeft, Swords, Trophy } from 'lucide-react'
import { cn } from '@/lib/utils'

type RatingMode = 'elo' | 'cf' | 'os' | 'whr'

const MODES: { key: RatingMode; label: string; color: string }[] = [
  { key: 'elo', label: 'Elo', color: '#2563eb' },
  { key: 'cf', label: 'CF', color: '#ef4444' },
  { key: 'os', label: 'OpenSkill', color: '#22c55e' },
  { key: 'whr', label: 'WHR', color: '#feca00' },
]

type Player = { id: string; name: string; initial_elo: number; cf_rating: number; os_ordinal: number; whr_rating: number }
type SharedGame = {
  gameId: string
  playedAt: string
  p1Pos: number; p2Pos: number
  p1EloChange: number; p2EloChange: number
  p1CfChange: number; p2CfChange: number
  p1OsChange: number; p2OsChange: number
  p1WhrChange: number; p2WhrChange: number
  p1EloAfter: number; p2EloAfter: number
  p1CfAfter: number; p2CfAfter: number
  p1OsAfter: number; p2OsAfter: number
  p1WhrAfter: number; p2WhrAfter: number
  winner: string
}

export default function RivalryPage() {
  const [players, setPlayers] = useState<Player[]>([])
  const [p1Id, setP1Id] = useState('')
  const [p2Id, setP2Id] = useState('')
  const [sharedGames, setSharedGames] = useState<SharedGame[]>([])
  const [loading, setLoading] = useState(false)
  const [mode, setMode] = useState<RatingMode>('os')

  useEffect(() => {
    supabase.from('players').select('*').order('name').then(({ data }) => {
      if (data) setPlayers(data)
    })
  }, [])

  useEffect(() => {
    if (p1Id && p2Id && p1Id !== p2Id) loadRivalry()
    else setSharedGames([])
  }, [p1Id, p2Id])

  const loadRivalry = async () => {
    setLoading(true)

    const { data: p1Results } = await supabase
      .from('game_results')
      .select('*, games(played_at)')
      .eq('player_id', p1Id)

    const { data: p2Results } = await supabase
      .from('game_results')
      .select('*, games(played_at)')
      .eq('player_id', p2Id)

    if (!p1Results || !p2Results) { setLoading(false); return }

    const p1GameMap = new Map(p1Results.map(r => [r.game_id, r]))
    const shared: SharedGame[] = []

    for (const r2 of p2Results) {
      const r1 = p1GameMap.get(r2.game_id)
      if (!r1) continue

      const pos1 = parseFloat(r1.normalized_position)
      const pos2 = parseFloat(r2.normalized_position)

      shared.push({
        gameId: r1.game_id,
        playedAt: (r1.games as any).played_at,
        p1Pos: pos1, p2Pos: pos2,
        p1EloChange: r1.elo_change, p2EloChange: r2.elo_change,
        p1CfChange: r1.cf_change ?? 0, p2CfChange: r2.cf_change ?? 0,
        p1OsChange: r1.os_change ?? 0, p2OsChange: r2.os_change ?? 0,
        p1WhrChange: r1.whr_change ?? 0, p2WhrChange: r2.whr_change ?? 0,
        p1EloAfter: r1.elo_after, p2EloAfter: r2.elo_after,
        p1CfAfter: r1.cf_after ?? 1000, p2CfAfter: r2.cf_after ?? 1000,
        p1OsAfter: r1.os_after ?? 0, p2OsAfter: r2.os_after ?? 0,
        p1WhrAfter: r1.whr_after ?? 1000, p2WhrAfter: r2.whr_after ?? 1000,
        winner: pos1 < pos2 ? 'p1' : pos2 < pos1 ? 'p2' : 'draw',
      })
    }

    shared.sort((a, b) => new Date(a.playedAt).getTime() - new Date(b.playedAt).getTime())
    setSharedGames(shared)
    setLoading(false)
  }

  const p1 = players.find(p => p.id === p1Id)
  const p2 = players.find(p => p.id === p2Id)
  const p1Wins = sharedGames.filter(g => g.winner === 'p1').length
  const p2Wins = sharedGames.filter(g => g.winner === 'p2').length
  const draws = sharedGames.filter(g => g.winner === 'draw').length

  const getRating = (p: Player) => {
    switch (mode) {
      case 'cf': return p.cf_rating
      case 'os': return p.os_ordinal
      case 'whr': return p.whr_rating
      default: return p.initial_elo
    }
  }

  const modeLabel = MODES.find(m => m.key === mode)!.label

  const getP1After = (g: SharedGame) => {
    switch (mode) { case 'cf': return g.p1CfAfter; case 'os': return g.p1OsAfter; case 'whr': return g.p1WhrAfter; default: return g.p1EloAfter }
  }
  const getP2After = (g: SharedGame) => {
    switch (mode) { case 'cf': return g.p2CfAfter; case 'os': return g.p2OsAfter; case 'whr': return g.p2WhrAfter; default: return g.p2EloAfter }
  }
  const getP1Change = (g: SharedGame) => {
    switch (mode) { case 'cf': return g.p1CfChange; case 'os': return g.p1OsChange; case 'whr': return g.p1WhrChange; default: return g.p1EloChange }
  }
  const getP2Change = (g: SharedGame) => {
    switch (mode) { case 'cf': return g.p2CfChange; case 'os': return g.p2OsChange; case 'whr': return g.p2WhrChange; default: return g.p2EloChange }
  }

  return (
    <main className="min-h-screen p-4 md:p-8 max-w-5xl mx-auto space-y-8">
      <header className="flex items-center gap-4 flex-wrap">
        <Link href="/" className="p-2 border border-foreground hover:bg-uno-red hover:text-white transition-colors">
          <ArrowLeft size={20} />
        </Link>
        <h1 className="text-3xl md:text-4xl font-black font-mono uppercase tracking-tighter text-uno-red flex items-center gap-3">
          <Swords size={32} /> Rivalry
        </h1>

        {/* Rating mode toggle */}
        <div className="flex bg-white/5 border border-foreground/20 text-xs font-mono ml-auto">
          {MODES.map(m => (
            <button
              key={m.key}
              onClick={() => setMode(m.key)}
              className={cn(
                "px-3 py-1.5 transition-colors font-bold uppercase",
                mode === m.key ? "bg-uno-red text-white" : "hover:bg-white/10"
              )}
            >
              {m.label}
            </button>
          ))}
        </div>
      </header>

      {/* Player Selectors */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="border border-foreground/20 p-4 bg-white/5">
          <label className="font-mono text-xs uppercase opacity-50 mb-2 block">Player 1</label>
          <select
            className="w-full bg-background border border-foreground/20 p-3 font-mono text-lg font-bold focus:border-uno-blue outline-none appearance-none cursor-pointer rounded-none"
            value={p1Id}
            onChange={(e) => setP1Id(e.target.value)}
          >
            <option value="">Select Player...</option>
            {players.filter(p => p.id !== p2Id).map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
        <div className="border border-foreground/20 p-4 bg-white/5">
          <label className="font-mono text-xs uppercase opacity-50 mb-2 block">Player 2</label>
          <select
            className="w-full bg-background border border-foreground/20 p-3 font-mono text-lg font-bold focus:border-uno-red outline-none appearance-none cursor-pointer rounded-none"
            value={p2Id}
            onChange={(e) => setP2Id(e.target.value)}
          >
            <option value="">Select Player...</option>
            {players.filter(p => p.id !== p1Id).map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Stats */}
      {p1 && p2 && sharedGames.length > 0 && (
        <>
          {/* Head to Head Record */}
          <div className="border border-foreground/20 bg-white/5 p-6 shadow-[4px_4px_0px_0px_var(--uno-red)]">
            <div className="flex items-center justify-between">
              <div className="text-center flex-1">
                <div className="text-3xl md:text-5xl font-black font-mono text-uno-blue">{p1.name}</div>
                <div className="font-mono text-sm opacity-40 mt-1">{getRating(p1)} {modeLabel}</div>
              </div>
              <div className="text-center px-6 flex flex-col items-center">
                <div className="flex items-center gap-4 font-mono text-3xl md:text-5xl font-black">
                  <span className={cn(p1Wins > p2Wins ? "text-uno-green" : "opacity-50")}>{p1Wins}</span>
                  <span className="opacity-20 text-lg">–</span>
                  <span className={cn(p2Wins > p1Wins ? "text-uno-green" : "opacity-50")}>{p2Wins}</span>
                </div>
                {draws > 0 && <span className="font-mono text-xs opacity-30 mt-1">{draws} draws</span>}
                <span className="font-mono text-xs opacity-40 mt-1">{sharedGames.length} games together</span>
              </div>
              <div className="text-center flex-1">
                <div className="text-3xl md:text-5xl font-black font-mono text-uno-red">{p2.name}</div>
                <div className="font-mono text-sm opacity-40 mt-1">{getRating(p2)} {modeLabel}</div>
              </div>
            </div>
          </div>

          {/* Rating Chart */}
          <div className="border border-foreground/20 p-6 bg-white/5 shadow-[4px_4px_0px_0px_var(--uno-blue)]">
            <h2 className="text-sm font-bold font-mono uppercase mb-4 text-uno-blue tracking-widest">{modeLabel} Progression</h2>
            <RivalryChart
              p1Data={sharedGames.map(g => getP1After(g))}
              p2Data={sharedGames.map(g => getP2After(g))}
              p1Name={p1.name}
              p2Name={p2.name}
            />
          </div>

          {/* Shared Game History */}
          <div className="border border-foreground/20 bg-white/5 shadow-[4px_4px_0px_0px_var(--uno-yellow)]">
            <div className="bg-uno-yellow/10 p-3 font-mono text-sm font-bold uppercase tracking-wider text-uno-yellow border-b border-foreground/10">
              Game History
            </div>
            <div className="divide-y divide-foreground/5">
              {sharedGames.map((g, i) => {
                const p1Change = getP1Change(g)
                const p2Change = getP2Change(g)
                return (
                <Link key={i} href={`/game/${g.gameId}`} className="grid grid-cols-12 gap-2 p-4 items-center hover:bg-white/5 transition-colors">
                  <div className="col-span-3 md:col-span-2 font-mono text-xs opacity-40">
                    {new Date(g.playedAt).toLocaleDateString()}
                  </div>
                  <div className="col-span-4 md:col-span-3 flex items-center gap-2">
                    <span className={cn("font-bold", g.winner === 'p1' ? "text-uno-green" : "")}>
                      {p1.name} #{g.p1Pos % 1 === 0 ? g.p1Pos : g.p1Pos.toFixed(1)}
                    </span>
                    {g.winner === 'p1' && <Trophy size={12} className="text-uno-yellow" />}
                  </div>
                  <div className="col-span-4 md:col-span-3 flex items-center gap-2">
                    <span className={cn("font-bold", g.winner === 'p2' ? "text-uno-green" : "")}>
                      {p2.name} #{g.p2Pos % 1 === 0 ? g.p2Pos : g.p2Pos.toFixed(1)}
                    </span>
                    {g.winner === 'p2' && <Trophy size={12} className="text-uno-yellow" />}
                  </div>
                  <div className="hidden md:flex md:col-span-4 justify-end gap-4 font-mono text-xs">
                    <span className={p1Change >= 0 ? "text-uno-green" : "text-uno-red"}>
                      {p1Change > 0 ? '+' : ''}{p1Change}
                    </span>
                    <span className={p2Change >= 0 ? "text-uno-green" : "text-uno-red"}>
                      {p2Change > 0 ? '+' : ''}{p2Change}
                    </span>
                  </div>
                </Link>
              )})}
            </div>
          </div>
        </>
      )}

      {p1 && p2 && sharedGames.length === 0 && !loading && (
        <div className="text-center py-12 opacity-50 font-mono">
          <div className="text-4xl mb-4">🤷</div>
          These two haven&apos;t played together yet.
        </div>
      )}

      {loading && (
        <div className="text-center py-12 opacity-50 font-mono animate-pulse">
          Analyzing rivalry...
        </div>
      )}
    </main>
  )
}

// Dual-line SVG chart
function RivalryChart({ p1Data, p2Data, p1Name, p2Name }: {
  p1Data: number[]; p2Data: number[]; p1Name: string; p2Name: string
}) {
  if (p1Data.length < 2) return null

  const width = 600
  const height = 220
  const padX = 40
  const padY = 25
  const chartW = width - padX * 2
  const chartH = height - padY * 2

  const allElos = [...p1Data, ...p2Data]
  const minElo = Math.min(...allElos) - 20
  const maxElo = Math.max(...allElos) + 20
  const eloRange = maxElo - minElo || 1

  const toPoints = (data: number[]) => data.map((elo, i) => ({
    x: padX + (i / (data.length - 1)) * chartW,
    y: padY + chartH - ((elo - minElo) / eloRange) * chartH,
    elo,
  }))

  const pts1 = toPoints(p1Data)
  const pts2 = toPoints(p2Data)
  const toPath = (pts: typeof pts1) => pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')

  const yLabels = [minElo, Math.round((minElo + maxElo) / 2), maxElo]

  return (
    <div>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto" preserveAspectRatio="xMidYMid meet">
        {yLabels.map(label => {
          const y = padY + chartH - ((label - minElo) / eloRange) * chartH
          return (
            <g key={label}>
              <line x1={padX} y1={y} x2={padX + chartW} y2={y} stroke="currentColor" strokeOpacity="0.07" strokeDasharray="4" />
              <text x={padX - 6} y={y + 4} textAnchor="end" fill="currentColor" fillOpacity="0.3" fontSize="10" fontFamily="monospace">{label}</text>
            </g>
          )
        })}

        <path d={toPath(pts1)} fill="none" stroke="#2563eb" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        {pts1.map((p, i) => <circle key={`p1-${i}`} cx={p.x} cy={p.y} r="3" fill="#0f172a" stroke="#2563eb" strokeWidth="2" />)}

        <path d={toPath(pts2)} fill="none" stroke="#ef4444" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        {pts2.map((p, i) => <circle key={`p2-${i}`} cx={p.x} cy={p.y} r="3" fill="#0f172a" stroke="#ef4444" strokeWidth="2" />)}

        <text x={pts1[pts1.length - 1].x + 6} y={pts1[pts1.length - 1].y + 4} fill="#2563eb" fontSize="11" fontWeight="bold" fontFamily="monospace">
          {p1Data[p1Data.length - 1]}
        </text>
        <text x={pts2[pts2.length - 1].x + 6} y={pts2[pts2.length - 1].y + 4} fill="#ef4444" fontSize="11" fontWeight="bold" fontFamily="monospace">
          {p2Data[p2Data.length - 1]}
        </text>
      </svg>

      <div className="flex justify-center gap-6 mt-2 font-mono text-xs">
        <span className="flex items-center gap-2">
          <span className="w-3 h-0.5 bg-[#2563eb] inline-block" /> {p1Name}
        </span>
        <span className="flex items-center gap-2">
          <span className="w-3 h-0.5 bg-[#ef4444] inline-block" /> {p2Name}
        </span>
      </div>
    </div>
  )
}
