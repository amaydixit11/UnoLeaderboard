import { supabase } from '@/lib/supabase'
import Link from 'next/link'
import { ArrowLeft, Trophy, Target, Hash, Zap } from 'lucide-react'

// Force dynamic rendering
export const dynamic = 'force-dynamic'

export default async function PlayerProfile({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  
  // Fetch player
  const { data: player } = await supabase
    .from('players')
    .select('*')
    .eq('id', id)
    .single()

  if (!player) return <div className="p-8">Player not found</div>

  // Fetch stats (simplified)
  const { data: results } = await supabase
    .from('game_results')
    .select('*, games(played_at, total_players)')
    .eq('player_id', id)
    .order('created_at', { ascending: false })

  const gamesPlayed = results?.length || 0
  const won = results?.filter((r: any) => r.normalized_position === 1).length || 0
  const winRate = gamesPlayed > 0 ? Math.round((won / gamesPlayed) * 100) : 0
  
  // Calculate avg position
  const avgPos = gamesPlayed > 0 
    ? (results?.reduce((sum: number, r: any) => sum + r.normalized_position, 0) / gamesPlayed).toFixed(1)
    : '-'

  // Calculate K-factor: K(n) = 16 + 16 * e^(-n/20)
  const kFactor = (16 + 16 * Math.exp(-gamesPlayed / 20)).toFixed(1)

  // Elo history for chart (chronological order)
  const eloHistory = results
    ? [...results]
        .sort((a: any, b: any) => new Date(a.games.played_at).getTime() - new Date(b.games.played_at).getTime())
        .map((r: any) => ({ elo: r.elo_after, date: r.games.played_at }))
    : []

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

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <div className="border border-foreground p-4 bg-white/5 border-t-4 border-t-uno-blue">
          <div className="text-xs opacity-50 uppercase font-mono mb-1">Current Elo</div>
          <div className="text-3xl font-bold font-mono text-uno-blue">{player.initial_elo}</div>
        </div>
        <div className="border border-foreground p-4 bg-white/5 border-t-4 border-t-uno-yellow">
          <div className="text-xs opacity-50 uppercase font-mono mb-1">Win Rate</div>
          <div className="text-3xl font-bold font-mono flex items-center gap-2 text-uno-yellow">
            <Trophy size={20} />
            {winRate}%
          </div>
        </div>
        <div className="border border-foreground p-4 bg-white/5 border-t-4 border-t-uno-green">
          <div className="text-xs opacity-50 uppercase font-mono mb-1">Avg Position</div>
          <div className="text-3xl font-bold font-mono flex items-center gap-2 text-uno-green">
            <Target size={20} />
            {avgPos}
          </div>
        </div>
        <div className="border border-foreground p-4 bg-white/5 border-t-4 border-t-uno-red">
          <div className="text-xs opacity-50 uppercase font-mono mb-1">Games Played</div>
          <div className="text-3xl font-bold font-mono flex items-center gap-2 text-uno-red">
            <Hash size={20} />
            {gamesPlayed}
          </div>
        </div>
        <div className="border border-foreground p-4 bg-white/5 border-t-4 border-t-foreground/40">
          <div className="text-xs opacity-50 uppercase font-mono mb-1">K-Factor</div>
          <div className="text-3xl font-bold font-mono flex items-center gap-2">
            <Zap size={20} />
            {kFactor}
          </div>
          <div className="text-xs opacity-30 font-mono mt-1">Rating volatility</div>
        </div>
      </div>

      {/* Elo History Chart */}
      {eloHistory.length > 1 && (
        <div className="border border-foreground/20 p-6 bg-white/5 shadow-[4px_4px_0px_0px_var(--uno-blue)]">
          <h2 className="text-sm font-bold font-mono uppercase mb-4 text-uno-blue tracking-widest">Elo History</h2>
          <EloChart data={eloHistory} />
        </div>
      )}

      <h2 className="text-xl font-bold font-mono uppercase mt-8 border-b border-foreground/20 pb-2 text-uno-yellow">Recent Performance</h2>
      
      <div className="space-y-4">
        {results?.map((res: any) => (
          <div key={res.id} className="flex justify-between items-center bg-white/5 p-4 border-l-4 border-l-transparent hover:border-l-uno-yellow transition-all">
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
            
            <div className="flex flex-col items-end">
              <span className={`font-mono font-bold text-xl ${res.elo_change >= 0 ? 'text-uno-green' : 'text-uno-red'}`}>
                {res.elo_change > 0 ? '+' : ''}{res.elo_change}
              </span>
              <span className="font-mono text-xs opacity-30">{res.elo_after} Elo</span>
            </div>
          </div>
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

// Pure SVG Elo History Chart
function EloChart({ data }: { data: { elo: number; date: string }[] }) {
  if (data.length < 2) return null

  const width = 600
  const height = 200
  const padX = 40
  const padY = 20
  const chartW = width - padX * 2
  const chartH = height - padY * 2

  const elos = data.map(d => d.elo)
  const minElo = Math.min(...elos) - 20
  const maxElo = Math.max(...elos) + 20
  const eloRange = maxElo - minElo || 1

  // Map data to SVG coordinates
  const points = data.map((d, i) => {
    const x = padX + (i / (data.length - 1)) * chartW
    const y = padY + chartH - ((d.elo - minElo) / eloRange) * chartH
    return { x, y, elo: d.elo, date: d.date }
  })

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')
  const areaPath = linePath + ` L ${points[points.length - 1].x} ${padY + chartH} L ${points[0].x} ${padY + chartH} Z`

  // Y-axis labels
  const yLabels = [minElo, Math.round((minElo + maxElo) / 2), maxElo]

  // 1000 reference line
  const y1000 = padY + chartH - ((1000 - minElo) / eloRange) * chartH
  const show1000 = minElo < 1000 && maxElo > 1000

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto" preserveAspectRatio="xMidYMid meet">
      <defs>
        <linearGradient id="eloGradient" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#2563eb" stopOpacity="0.3" />
          <stop offset="100%" stopColor="#2563eb" stopOpacity="0.02" />
        </linearGradient>
      </defs>

      {/* Y-axis labels */}
      {yLabels.map(label => {
        const y = padY + chartH - ((label - minElo) / eloRange) * chartH
        return (
          <g key={label}>
            <line x1={padX} y1={y} x2={padX + chartW} y2={y} stroke="currentColor" strokeOpacity="0.07" strokeDasharray="4" />
            <text x={padX - 6} y={y + 4} textAnchor="end" fill="currentColor" fillOpacity="0.3" fontSize="10" fontFamily="monospace">{label}</text>
          </g>
        )
      })}

      {/* 1000 reference line */}
      {show1000 && (
        <g>
          <line x1={padX} y1={y1000} x2={padX + chartW} y2={y1000} stroke="#feca00" strokeOpacity="0.3" strokeDasharray="6 3" />
          <text x={padX + chartW + 4} y={y1000 + 4} fill="#feca00" fillOpacity="0.4" fontSize="9" fontFamily="monospace">1000</text>
        </g>
      )}

      {/* Area fill */}
      <path d={areaPath} fill="url(#eloGradient)" />

      {/* Line */}
      <path d={linePath} fill="none" stroke="#2563eb" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />

      {/* Data points */}
      {points.map((p, i) => (
        <g key={i}>
          <circle cx={p.x} cy={p.y} r="4" fill="#0f172a" stroke="#2563eb" strokeWidth="2" />
          {/* First and last labels */}
          {(i === 0 || i === points.length - 1) && (
            <text 
              x={p.x} 
              y={p.y - 10} 
              textAnchor={i === 0 ? 'start' : 'end'} 
              fill="#2563eb" 
              fontSize="11" 
              fontWeight="bold" 
              fontFamily="monospace"
            >
              {p.elo}
            </text>
          )}
        </g>
      ))}
    </svg>
  )
}
