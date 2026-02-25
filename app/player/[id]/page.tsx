import { supabase } from '@/lib/supabase'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import { ArrowLeft, Trophy, Target, Hash, Zap, BarChart2, PieChart, Shield, Activity } from 'lucide-react'
import SkillDistributionChart from '@/components/SkillDistributionChart'
import ChaosFactorChart from '@/components/ChaosFactorChart'
import RadarChart from '@/components/RadarChart'
import { pearsonCorrelation, calculateStandardDeviation, getPlayerClass } from '@/lib/analytics'

export const dynamic = 'force-dynamic'

export default async function PlayerProfile({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  
  const { data: player } = await supabase
    .from('players')
    .select('*')
    .eq('id', id)
    .single()

  if (!player) return <div className="p-8">Player not found</div>

  const { data: results } = await supabase
    .from('game_results')
    .select('*, games(played_at, total_players)')
    .eq('player_id', id)
    .order('created_at', { ascending: false })

  const gamesPlayed = results?.length || 0
  const won = results?.filter((r: any) => r.normalized_position === 1).length || 0
  const winRate = gamesPlayed > 0 ? Math.round((won / gamesPlayed) * 100) : 0
  const avgPos = gamesPlayed > 0 
    ? (results?.reduce((sum: number, r: any) => sum + r.normalized_position, 0) / gamesPlayed).toFixed(1)
    : '-'
  const kFactor = (16 + 16 * Math.exp(-gamesPlayed / 20)).toFixed(1)

  // Rating histories (chronological)
  const sortedResults = results
    ? [...results].sort((a: any, b: any) => new Date(a.games.played_at).getTime() - new Date(b.games.played_at).getTime())
    : []

  const chartData = sortedResults.map((r: any) => ({
    date: r.games.played_at,
    elo: r.elo_after,
    cf: r.cf_after ?? null,
    os: r.os_after ?? null,
    whr: r.whr_after ?? null,
  }))

  // Relationships (Nemesis, Easy Target, Closest Rival)
  const { data: allPlayers } = await supabase.from('players').select('id, name, os_ordinal, os_mu, os_sigma')
  const gameIds = results?.map((r: any) => r.game_id) || []
  const { data: opponentResults } = await supabase
    .from('game_results')
    .select('player_id, game_id, normalized_position')
    .in('game_id', gameIds)
    .neq('player_id', id)

  const opponentStats: Record<string, { wins: number; losses: number; name: string }> = {}
  allPlayers?.forEach(p => {
    if (p.id !== id) opponentStats[p.id] = { wins: 0, losses: 0, name: p.name }
  })

  if (opponentResults && results) {
    const myPosMap = new Map(results.map((r: any) => [r.game_id, r.normalized_position]))
    opponentResults.forEach((or: any) => {
      const myPos = myPosMap.get(or.game_id)
      if (myPos !== undefined && opponentStats[or.player_id]) {
        if (myPos < or.normalized_position) opponentStats[or.player_id].wins += 1
        else if (myPos > or.normalized_position) opponentStats[or.player_id].losses += 1
      }
    })
  }

  let nemesis = { name: '-', score: 0, id: '' }
  let easyTarget = { name: '-', score: 0, id: '' }
  Object.entries(opponentStats).forEach(([oppId, stats]) => {
    if (stats.losses > nemesis.score) nemesis = { name: stats.name, score: stats.losses, id: oppId }
    if (stats.wins > easyTarget.score) easyTarget = { name: stats.name, score: stats.wins, id: oppId }
  })

  let closestRival = { name: '-', diff: Infinity, id: '' }
  const myRating = player.os_ordinal ?? 0
  allPlayers?.forEach(p => {
    if (p.id !== id && p.os_ordinal != null) {
      const diff = Math.abs(p.os_ordinal - myRating)
      if (diff < closestRival.diff) closestRival = { name: p.name, diff, id: p.id }
    }
  })

  // Chaos Factor Calculation
  const chaosData = results?.map((r: any) => ({
    lobbySize: r.games.total_players,
    placement: (r.normalized_position - 1) / (r.games.total_players - 1 || 1) // 0 (1st) to 1 (last)
  })) || []
  
  const lobbySizes = chaosData.map(d => d.lobbySize)
  const placements = chaosData.map(d => d.placement)
  const chaosCorrelation = pearsonCorrelation(lobbySizes, placements)

  // DNA Metrics Calculation (0-100)
  const maxOs = Math.max(...(allPlayers?.map(p => p.os_ordinal) || [1000]))
  const dna = {
    firepower: winRate,
    stability: Math.max(0, 100 - (calculateStandardDeviation(results?.map(r => r.normalized_position) || []) * 30)),
    chaos: Math.max(0, 50 - (chaosCorrelation * 50)), // Lower correlation = higher chaos thrives
    prestige: Math.min(100, ((player.os_ordinal || 0) / maxOs) * 100),
    clutch: Math.round((results?.filter(r => r.games.total_players >= 5 && r.normalized_position <= 2).length || 0) / (results?.filter(r => r.games.total_players >= 5).length || 1) * 100)
  }

  const playerClass = getPlayerClass(dna)

  return (
    <main className="min-h-screen p-4 md:p-8 max-w-4xl mx-auto space-y-8">
      <header className="flex items-center gap-4">
        <Link href="/" className="p-2 border border-foreground hover:bg-uno-blue hover:text-white transition-colors">
          <ArrowLeft size={20} />
        </Link>
        <h1 className="text-4xl md:text-5xl font-black font-mono uppercase tracking-tighter text-uno-blue drop-shadow-[2px_2px_0px_rgba(255,255,255,0.2)]">
          {player.name}
        </h1>
      </header>

      {/* Rating Systems */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="border border-foreground p-4 bg-white/5 border-t-4 border-t-uno-blue">
          <div className="text-xs opacity-50 uppercase font-mono mb-1">Pairwise Elo</div>
          <div className="text-3xl font-bold font-mono text-uno-blue">{player.initial_elo}</div>
        </div>
        <div className="border border-foreground p-4 bg-white/5 border-t-4 border-t-uno-red">
          <div className="text-xs opacity-50 uppercase font-mono mb-1">CF Rating</div>
          <div className="text-3xl font-bold font-mono text-uno-red">{player.cf_rating ?? 1000}</div>
        </div>
        <div className="border border-foreground p-4 bg-white/5 border-t-4 border-t-uno-green">
          <div className="text-xs opacity-50 uppercase font-mono mb-1">OpenSkill</div>
          <div className="text-3xl font-bold font-mono text-uno-green">{player.os_ordinal ?? 0}</div>
        </div>
        <div className="border border-foreground p-4 bg-white/5 border-t-4 border-t-uno-yellow">
          <div className="text-xs opacity-50 uppercase font-mono mb-1">WHR</div>
          <div className="text-3xl font-bold font-mono text-uno-yellow">{player.whr_rating ?? 1000}</div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="border border-foreground/20 p-4 bg-white/5">
          <div className="text-xs opacity-50 uppercase font-mono mb-1">Win Rate</div>
          <div className="text-2xl font-bold font-mono flex items-center gap-2">
            <Trophy size={18} /> {winRate}%
          </div>
        </div>
        <div className="border border-foreground/20 p-4 bg-white/5">
          <div className="text-xs opacity-50 uppercase font-mono mb-1">Avg Position</div>
          <div className="text-2xl font-bold font-mono flex items-center gap-2">
            <Target size={18} /> {avgPos}
          </div>
        </div>
        <div className="border border-foreground/20 p-4 bg-white/5">
          <div className="text-xs opacity-50 uppercase font-mono mb-1">Games Played</div>
          <div className="text-2xl font-bold font-mono flex items-center gap-2">
            <Hash size={18} /> {gamesPlayed}
          </div>
        </div>
        <div className="border border-foreground/20 p-4 bg-white/5">
          <div className="text-xs opacity-50 uppercase font-mono mb-1 text-uno-blue">Class</div>
          <div className={cn("text-2xl font-bold font-mono flex items-center gap-2", playerClass.color)}>
            <Shield size={18} /> {playerClass.label}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-center bg-black/20 p-6 border border-foreground/10">
        <div className="space-y-4">
          <div className="inline-block px-3 py-1 bg-uno-blue/10 border border-uno-blue/30 font-mono text-xs font-bold text-uno-blue uppercase tracking-widest">
            Player DNA
          </div>
          <h2 className={cn("text-5xl font-black font-mono uppercase tracking-tighter", playerClass.color)}>
            {playerClass.label}
          </h2>
          <p className="text-sm font-mono opacity-60 leading-relaxed max-w-md">
            {playerClass.description}
          </p>
          <div className="grid grid-cols-2 gap-x-8 gap-y-2 pt-4">
            {Object.entries(dna).map(([key, val]) => (
              <div key={key} className="flex justify-between items-center border-b border-white/5 pb-1">
                <span className="text-[10px] font-mono uppercase opacity-40">{key}</span>
                <span className="text-sm font-bold font-mono">{val}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="relative">
          <RadarChart 
            data={[
              { label: 'Firepower', value: dna.firepower },
              { label: 'Stability', value: dna.stability },
              { label: 'Chaos', value: dna.chaos },
              { label: 'Prestige', value: dna.prestige },
              { label: 'Clutch', value: dna.clutch },
            ]} 
            color={playerClass.color.includes('green') ? '#22c55e' : playerClass.color.includes('red') ? '#ef4444' : playerClass.color.includes('yellow') ? '#feca00' : '#2563eb'}
          />
        </div>
      </div>

      {/* 4-Line Rating History Chart */}
      {chartData.length > 1 && (
        <div className="border border-foreground/20 p-6 bg-white/5 shadow-[4px_4px_0px_0px_var(--uno-blue)]">
          <h2 className="text-sm font-bold font-mono uppercase mb-4 text-uno-blue tracking-widest">Rating History</h2>
          <QuadRatingChart data={chartData} />
        </div>
      )}
      {/* Relationships */}
      {gamesPlayed > 0 && (
        <>
          <h2 className="text-xl font-bold font-mono uppercase mt-8 border-b border-foreground/20 pb-2 text-foreground">Rivals</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {nemesis.id ? (
              <Link href={`/rivalry?p1=${id}&p2=${nemesis.id}`} className="block border border-foreground/20 p-4 bg-white/5 hover:border-uno-red transition-colors group">
                <div className="text-xs opacity-50 uppercase font-mono mb-1 text-uno-red">Nemesis</div>
                <div className="text-2xl font-bold font-mono group-hover:text-uno-red transition-colors">{nemesis.name}</div>
                <div className="text-xs font-mono opacity-50 mt-1">{nemesis.score} losses against</div>
              </Link>
            ) : (
              <div className="border border-foreground/20 p-4 bg-white/5 opacity-50"><div className="text-xs uppercase font-mono mb-1 text-uno-red">Nemesis</div><div className="text-2xl font-bold font-mono">-</div></div>
            )}
            
            {easyTarget.id ? (
              <Link href={`/rivalry?p1=${id}&p2=${easyTarget.id}`} className="block border border-foreground/20 p-4 bg-white/5 hover:border-uno-green transition-colors group">
                <div className="text-xs opacity-50 uppercase font-mono mb-1 text-uno-green">Easy Target</div>
                <div className="text-2xl font-bold font-mono group-hover:text-uno-green transition-colors">{easyTarget.name}</div>
                <div className="text-xs font-mono opacity-50 mt-1">{easyTarget.score} wins against</div>
              </Link>
            ) : (
              <div className="border border-foreground/20 p-4 bg-white/5 opacity-50"><div className="text-xs uppercase font-mono mb-1 text-uno-green">Easy Target</div><div className="text-2xl font-bold font-mono">-</div></div>
            )}

            {closestRival.id ? (
              <Link href={`/rivalry?p1=${id}&p2=${closestRival.id}`} className="block border border-foreground/20 p-4 bg-white/5 hover:border-uno-blue transition-colors group">
                <div className="text-xs opacity-50 uppercase font-mono mb-1 text-uno-blue">Closest Rival</div>
                <div className="text-2xl font-bold font-mono group-hover:text-uno-blue transition-colors">{closestRival.name}</div>
                <div className="text-xs font-mono opacity-50 mt-1">OS diff: {Math.round(closestRival.diff)}</div>
              </Link>
            ) : (
              <div className="border border-foreground/20 p-4 bg-white/5 opacity-50"><div className="text-xs uppercase font-mono mb-1 text-uno-blue">Closest Rival</div><div className="text-2xl font-bold font-mono">-</div></div>
            )}
          </div>
        </>
      )}


      <h2 className="text-xl font-bold font-mono uppercase mt-8 border-b border-foreground/20 pb-2 text-foreground flex items-center gap-2">
        <BarChart2 size={20} /> Deep Analytics
      </h2>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {/* Bayesian Skill Distribution */}
        <div className="border border-foreground/20 p-6 bg-white/5 shadow-[4px_4px_0px_0px_var(--uno-green)]">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-bold font-mono uppercase text-uno-green tracking-widest">Skill Distribution</h3>
            <span className="text-[10px] font-mono opacity-40 uppercase">OpenSkill Bayesian Model</span>
          </div>
          <SkillDistributionChart 
            players={[
              { 
                name: player.name, 
                mu: player.os_mu ?? 25, 
                sigma: player.os_sigma ?? 8.333, 
                color: '#22c55e' 
              },
              { 
                name: 'Group Avg', 
                mu: (allPlayers?.reduce((acc: number, p: any) => acc + (p.os_mu || 25), 0) || 0) / (allPlayers?.length || 1),
                sigma: 8.333,
                color: 'rgba(255,255,255,0.2)'
              }
            ]} 
          />
          <p className="mt-4 text-xs font-mono opacity-50 leading-relaxed">
            This "Bell Curve" represents your mathematical skill range. A <span className="text-uno-green font-bold">tall, narrow peak</span> indicates high certainty in your rank, while a <span className="text-white font-bold opacity-100">wide hill</span> means you are still a "Wildcard".
          </p>
        </div>

        {/* Chaos Factor Correlation */}
        <div className="border border-foreground/20 p-6 bg-white/5 shadow-[4px_4px_0px_0px_var(--uno-red)]">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-bold font-mono uppercase text-uno-red tracking-widest">Chaos Factor</h3>
            <span className="text-[10px] font-mono opacity-40 uppercase">Lobby size vs Performance</span>
          </div>
          <ChaosFactorChart 
            data={chaosData} 
            correlation={chaosCorrelation}
          />
          <p className="mt-4 text-xs font-mono opacity-50 leading-relaxed">
            Measures if your performance correlates with group size. 
            Negative correlation means you thrive in <span className="text-uno-red font-bold">large, chaotic lobbies</span>.
            Positive means you are a <span className="text-uno-blue font-bold">Duelist</span>.
          </p>
        </div>
      </div>

      <h2 className="text-xl font-bold font-mono uppercase mt-8 border-b border-foreground/20 pb-2 text-uno-yellow flex items-center gap-2">
        <PieChart size={20} /> Recent Performance
      </h2>
      
      <div className="space-y-4">
        {results?.map((res: any) => (
          <Link key={res.id} href={`/game/${res.game_id}`} className="block bg-white/5 p-4 border-l-4 border-l-transparent hover:border-l-uno-yellow transition-all">
            <div className="flex justify-between items-start">
              <div className="flex flex-col">
                <span className="font-mono text-xs opacity-50">{new Date(res.games.played_at).toLocaleDateString()}</span>
                <span className="font-bold flex items-center gap-2">
                  {res.normalized_position === 1 ? (
                    <><span className="text-uno-yellow">1st Place</span> 👑</>
                  ) : (
                    `${res.normalized_position}${getOrdinal(Math.round(res.normalized_position))} Place`
                  )}
                </span>
              </div>
              
              <div className="flex gap-4 font-mono text-sm font-bold">
                <div className="flex flex-col items-end">
                  <span className={res.elo_change >= 0 ? 'text-uno-green' : 'text-uno-red'}>
                    {res.elo_change > 0 ? '+' : ''}{res.elo_change}
                  </span>
                  <span className="text-[10px] opacity-30 uppercase">Elo</span>
                </div>
                {res.cf_change != null && (
                  <div className="flex flex-col items-end">
                    <span className={res.cf_change >= 0 ? 'text-uno-green' : 'text-uno-red'}>
                      {res.cf_change > 0 ? '+' : ''}{res.cf_change}
                    </span>
                    <span className="text-[10px] opacity-30 uppercase">CF</span>
                  </div>
                )}
                {res.os_change != null && (
                  <div className="flex flex-col items-end">
                    <span className={res.os_change >= 0 ? 'text-uno-green' : 'text-uno-red'}>
                      {res.os_change > 0 ? '+' : ''}{res.os_change}
                    </span>
                    <span className="text-[10px] opacity-30 uppercase">OS</span>
                  </div>
                )}
                {res.whr_change != null && (
                  <div className="flex flex-col items-end">
                    <span className={res.whr_change >= 0 ? 'text-uno-green' : 'text-uno-red'}>
                      {res.whr_change > 0 ? '+' : ''}{res.whr_change}
                    </span>
                    <span className="text-[10px] opacity-30 uppercase">WHR</span>
                  </div>
                )}
              </div>
            </div>
          </Link>
        ))}

        {gamesPlayed === 0 && <div className="text-center opacity-50">No games played yet.</div>}
      </div>
    </main>
  )
}

function getOrdinal(n: number) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
}

// 4-line SVG Chart: Elo (blue), CF (red), OS (green), WHR (yellow)
function QuadRatingChart({ data }: {
  data: { elo: number; cf: number | null; os: number | null; whr: number | null; date: string }[]
}) {
  if (data.length < 2) return null

  const LINES: { key: 'elo' | 'cf' | 'os' | 'whr'; label: string; color: string }[] = [
    { key: 'elo', label: 'Elo', color: '#2563eb' },
    { key: 'cf', label: 'CF', color: '#ef4444' },
    { key: 'os', label: 'OpenSkill', color: '#22c55e' },
    { key: 'whr', label: 'WHR', color: '#feca00' },
  ]

  const width = 600
  const height = 250
  const padX = 45
  const padY = 25
  const chartW = width - padX * 2
  const chartH = height - padY * 2

  // Collect all values for y-axis range
  const allVals: number[] = []
  for (const d of data) {
    allVals.push(d.elo)
    if (d.cf != null) allVals.push(d.cf)
    if (d.os != null) allVals.push(d.os)
    if (d.whr != null) allVals.push(d.whr)
  }
  const minVal = Math.min(...allVals) - 30
  const maxVal = Math.max(...allVals) + 30
  const range = maxVal - minVal || 1

  const toX = (i: number) => padX + (i / (data.length - 1)) * chartW
  const toY = (v: number) => padY + chartH - ((v - minVal) / range) * chartH

  const buildPath = (key: 'elo' | 'cf' | 'os' | 'whr') => {
    const pts: { x: number; y: number; v: number }[] = []
    for (let i = 0; i < data.length; i++) {
      const val = data[i][key]
      if (val != null) pts.push({ x: toX(i), y: toY(val), v: val })
    }
    if (pts.length < 2) return null
    const path = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')
    return { path, pts }
  }

  const yLabels = [minVal, Math.round((minVal + maxVal) / 2), maxVal]
  const y1000 = toY(1000)
  const show1000 = minVal < 1000 && maxVal > 1000

  return (
    <div>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto" preserveAspectRatio="xMidYMid meet">
        {/* Y-axis labels */}
        {yLabels.map(label => {
          const y = toY(label)
          return (
            <g key={label}>
              <line x1={padX} y1={y} x2={padX + chartW} y2={y} stroke="currentColor" strokeOpacity="0.07" strokeDasharray="4" />
              <text x={padX - 6} y={y + 4} textAnchor="end" fill="currentColor" fillOpacity="0.3" fontSize="10" fontFamily="monospace">{Math.round(label)}</text>
            </g>
          )
        })}

        {/* 1000 baseline */}
        {show1000 && (
          <g>
            <line x1={padX} y1={y1000} x2={padX + chartW} y2={y1000} stroke="#feca00" strokeOpacity="0.2" strokeDasharray="6 3" />
            <text x={padX + chartW + 4} y={y1000 + 4} fill="#feca00" fillOpacity="0.3" fontSize="9" fontFamily="monospace">1000</text>
          </g>
        )}

        {/* Lines */}
        {LINES.map(line => {
          const result = buildPath(line.key)
          if (!result) return null
          return (
            <g key={line.key}>
              <path d={result.path} fill="none" stroke={line.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" strokeOpacity="0.8" />
              {result.pts.map((p, i) => (
                <circle key={i} cx={p.x} cy={p.y} r="2.5" fill="#0f172a" stroke={line.color} strokeWidth="1.5" />
              ))}
              {/* End label */}
              <text
                x={result.pts[result.pts.length - 1].x + 6}
                y={result.pts[result.pts.length - 1].y + 4}
                fill={line.color}
                fontSize="10"
                fontWeight="bold"
                fontFamily="monospace"
              >
                {result.pts[result.pts.length - 1].v}
              </text>
            </g>
          )
        })}
      </svg>

      {/* Legend */}
      <div className="flex justify-center gap-5 mt-2 font-mono text-xs">
        {LINES.map(line => (
          <span key={line.key} className="flex items-center gap-1.5">
            <span className="w-3 h-0.5 inline-block" style={{ backgroundColor: line.color }} />
            {line.label}
          </span>
        ))}
      </div>
    </div>
  )
}
