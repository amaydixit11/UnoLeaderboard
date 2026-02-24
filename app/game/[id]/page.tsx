import { supabase } from '@/lib/supabase'
import Link from 'next/link'
import { ArrowLeft, Calendar, Users, Swords, Zap } from 'lucide-react'
import { cn } from '@/lib/utils'

export const dynamic = 'force-dynamic'

// Elo helpers
function getExpectedScore(playerElo: number, opponentElo: number): number {
  return 1 / (1 + Math.pow(10, (opponentElo - playerElo) / 400))
}

function getKFactor(gamesPlayed: number): number {
  return 16 + 16 * Math.exp(-gamesPlayed / 20)
}

export default async function GameDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const { data: game } = await supabase
    .from('games')
    .select('*')
    .eq('id', id)
    .single()

  if (!game) return <div className="p-8 font-mono">Game not found</div>

  const { data: results } = await supabase
    .from('game_results')
    .select('*, players(name)')
    .eq('game_id', id)
    .order('normalized_position', { ascending: true })

  if (!results || results.length === 0) return <div className="p-8 font-mono">No results found</div>

  // Games played count for each player at game time
  const gamesPlayedMap: Record<string, number> = {}
  for (const r of results) {
    const { count } = await supabase
      .from('game_results')
      .select('*, games!inner(played_at)', { count: 'exact', head: true })
      .eq('player_id', r.player_id)
      .lt('games.played_at', game.played_at)
    gamesPlayedMap[r.player_id] = count ?? 0
  }

  // Compute pairwise breakdown
  const pairwise: {
    p1Name: string; p2Name: string
    p1Elo: number; p2Elo: number
    p1Pos: number; p2Pos: number
    p1Expected: number; p2Expected: number
    p1K: number; p2K: number
    p1Change: number; p2Change: number
    outcome: string
  }[] = []

  for (let i = 0; i < results.length; i++) {
    for (let j = i + 1; j < results.length; j++) {
      const r1 = results[i]
      const r2 = results[j]

      const e1 = getExpectedScore(r1.elo_before, r2.elo_before)
      const e2 = getExpectedScore(r2.elo_before, r1.elo_before)

      const k1 = getKFactor(gamesPlayedMap[r1.player_id] ?? 0)
      const k2 = getKFactor(gamesPlayedMap[r2.player_id] ?? 0)

      const pos1 = parseFloat(r1.normalized_position)
      const pos2 = parseFloat(r2.normalized_position)

      let s1 = 0.5, s2 = 0.5
      if (pos1 < pos2) { s1 = 1; s2 = 0 }
      else if (pos1 > pos2) { s1 = 0; s2 = 1 }

      pairwise.push({
        p1Name: (r1.players as any)?.name || 'Unknown',
        p2Name: (r2.players as any)?.name || 'Unknown',
        p1Elo: r1.elo_before, p2Elo: r2.elo_before,
        p1Pos: pos1, p2Pos: pos2,
        p1Expected: e1, p2Expected: e2,
        p1K: k1, p2K: k2,
        p1Change: k1 * (s1 - e1),
        p2Change: k2 * (s2 - e2),
        outcome: pos1 < pos2 ? `${(r1.players as any)?.name} won` : pos1 > pos2 ? `${(r2.players as any)?.name} won` : 'Draw',
      })
    }
  }

  const dateStr = new Date(game.played_at).toLocaleDateString()
  const timeStr = new Date(game.played_at).toLocaleTimeString()

  const SYSTEMS = [
    { key: 'elo', label: 'Elo', color: 'text-uno-blue', before: 'elo_before', after: 'elo_after', change: 'elo_change' },
    { key: 'cf', label: 'CF', color: 'text-uno-red', before: 'cf_before', after: 'cf_after', change: 'cf_change' },
    { key: 'os', label: 'OpenSkill', color: 'text-uno-green', before: 'os_before', after: 'os_after', change: 'os_change' },
    { key: 'whr', label: 'WHR', color: 'text-uno-yellow', before: 'whr_before', after: 'whr_after', change: 'whr_change' },
  ] as const

  return (
    <main className="min-h-screen p-4 md:p-8 max-w-5xl mx-auto space-y-8">
      <header className="flex items-center gap-4">
        <Link href="/history" className="p-2 border border-foreground hover:bg-uno-blue hover:text-white transition-colors">
          <ArrowLeft size={20} />
        </Link>
        <div>
          <h1 className="text-3xl md:text-4xl font-black font-mono uppercase tracking-tighter text-uno-blue">
            Game Detail
          </h1>
          <div className="flex items-center gap-4 mt-1 font-mono text-sm opacity-50">
            <span className="flex items-center gap-1"><Calendar size={14} /> {dateStr} • {timeStr}</span>
            <span className="flex items-center gap-1"><Users size={14} /> {game.total_players} players</span>
          </div>
        </div>
      </header>

      {/* Final Standings — all 4 rating systems */}
      <div className="border border-foreground/20 bg-white/5 shadow-[4px_4px_0px_0px_var(--uno-yellow)]">
        <div className="bg-uno-yellow/10 p-3 font-mono text-sm font-bold uppercase tracking-wider text-uno-yellow border-b border-foreground/10">
          Final Standings
        </div>
        <div className="divide-y divide-foreground/5">
          {results.map((r: any, index: number) => {
            const kFactor = getKFactor(gamesPlayedMap[r.player_id] ?? 0)
            return (
              <div key={r.id} className="p-4 space-y-2">
                {/* Player row */}
                <div className="flex items-center gap-4">
                  <span className={cn(
                    "font-mono text-xl font-black w-10",
                    index === 0 ? "text-uno-yellow" : index === 1 ? "text-uno-green" : index === 2 ? "text-uno-blue" : "text-foreground/50"
                  )}>
                    #{r.normalized_position % 1 === 0 ? r.normalized_position : parseFloat(r.normalized_position).toFixed(1)}
                  </span>
                  <span className="font-bold text-lg flex-1">
                    <Link href={`/player/${r.player_id}`} className="hover:text-uno-blue transition-colors hover:underline underline-offset-4">
                      {r.players?.name}
                    </Link>
                    {index === 0 && <span className="ml-2">👑</span>}
                  </span>
                  <span className="font-mono text-xs opacity-40 flex items-center gap-1">
                    <Zap size={10} /> K={kFactor.toFixed(1)}
                  </span>
                </div>

                {/* Rating changes grid */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 ml-14">
                  {SYSTEMS.map(sys => {
                    const before = r[sys.before]
                    const after = r[sys.after]
                    const change = r[sys.change]
                    if (before == null && after == null) return null
                    return (
                      <div key={sys.key} className="flex items-center gap-2 font-mono text-xs">
                        <span className={cn("font-bold uppercase text-[10px] w-6", sys.color)}>{sys.label}</span>
                        <span className="opacity-40">{before ?? '—'}</span>
                        <span className="opacity-20">→</span>
                        <span className="font-bold">{after ?? '—'}</span>
                        <span className={cn(
                          "font-bold",
                          change > 0 ? "text-uno-green" : change < 0 ? "text-uno-red" : "opacity-30"
                        )}>
                          {change != null ? (change > 0 ? '+' : '') + change : ''}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Pairwise Breakdown */}
      <div className="border border-foreground/20 bg-white/5 shadow-[4px_4px_0px_0px_var(--uno-blue)]">
        <div className="bg-uno-blue/10 p-3 font-mono text-sm font-bold uppercase tracking-wider text-uno-blue border-b border-foreground/10 flex items-center gap-2">
          <Swords size={16} />
          Pairwise Breakdown ({pairwise.length} matchups)
        </div>
        <div className="overflow-x-auto">
          <table className="w-full font-mono text-sm">
            <thead>
              <tr className="border-b border-foreground/10 text-xs uppercase opacity-40">
                <th className="p-3 text-left">Player 1</th>
                <th className="p-3 text-center">vs</th>
                <th className="p-3 text-left">Player 2</th>
                <th className="p-3 text-center">Expected</th>
                <th className="p-3 text-center">Actual</th>
                <th className="p-3 text-right">Δ P1</th>
                <th className="p-3 text-right">Δ P2</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-foreground/5">
              {pairwise.map((p, i) => (
                <tr key={i} className="hover:bg-white/5 transition-colors">
                  <td className="p-3">
                    <span className="font-bold">{p.p1Name}</span>
                    <span className="opacity-30 ml-1 text-xs">({p.p1Elo})</span>
                  </td>
                  <td className="p-3 text-center opacity-20">⚔️</td>
                  <td className="p-3">
                    <span className="font-bold">{p.p2Name}</span>
                    <span className="opacity-30 ml-1 text-xs">({p.p2Elo})</span>
                  </td>
                  <td className="p-3 text-center text-xs opacity-50">
                    {(p.p1Expected * 100).toFixed(0)}% – {(p.p2Expected * 100).toFixed(0)}%
                  </td>
                  <td className="p-3 text-center text-xs">
                    {p.outcome}
                  </td>
                  <td className={cn("p-3 text-right font-bold", p.p1Change >= 0 ? "text-uno-green" : "text-uno-red")}>
                    {p.p1Change >= 0 ? '+' : ''}{p.p1Change.toFixed(1)}
                  </td>
                  <td className={cn("p-3 text-right font-bold", p.p2Change >= 0 ? "text-uno-green" : "text-uno-red")}>
                    {p.p2Change >= 0 ? '+' : ''}{p.p2Change.toFixed(1)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  )
}
