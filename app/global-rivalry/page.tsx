import { supabase } from '@/lib/supabase'
import Link from 'next/link'
import { ArrowLeft, Grid } from 'lucide-react'
import { cn } from '@/lib/utils'

export const dynamic = 'force-dynamic'

type Player = { id: string; name: string }

export default async function GlobalRivalryPage() {
  const { data: players } = await supabase
    .from('players')
    .select('id, name, os_ordinal')
    .order('os_ordinal', { ascending: false })

  if (!players) return <div className="p-8">No players found</div>

  const { data: results } = await supabase
    .from('game_results')
    .select('player_id, game_id, normalized_position')

  // Matrix: matrix[playerA][playerB] = { wins, losses, ties } (from A's perspective against B)
  const matrix: Record<string, Record<string, { wins: number; losses: number; ties: number }>> = {}
  
  // Initialize matrix
  players.forEach(p1 => {
    matrix[p1.id] = {}
    players.forEach(p2 => {
      if (p1.id !== p2.id) {
        matrix[p1.id][p2.id] = { wins: 0, losses: 0, ties: 0 }
      }
    })
  })

  if (results) {
    // Group results by game
    const games: Record<string, { player_id: string; pos: number }[]> = {}
    results.forEach(r => {
      if (!games[r.game_id]) games[r.game_id] = []
      games[r.game_id].push({ player_id: r.player_id, pos: r.normalized_position })
    })

    // Compute pairwise results for each game
    Object.values(games).forEach(gamePlayers => {
      for (let i = 0; i < gamePlayers.length; i++) {
        for (let j = 0; j < gamePlayers.length; j++) {
          if (i === j) continue
          const p1 = gamePlayers[i]
          const p2 = gamePlayers[j]
          
          if (matrix[p1.player_id] && matrix[p1.player_id][p2.player_id]) {
            if (p1.pos < p2.pos) {
              matrix[p1.player_id][p2.player_id].wins++
            } else if (p1.pos > p2.pos) {
              matrix[p1.player_id][p2.player_id].losses++
            } else {
              matrix[p1.player_id][p2.player_id].ties++
            }
          }
        }
      }
    })
  }

  const getCellColor = (wins: number, losses: number) => {
    if (wins === 0 && losses === 0) return 'bg-white/5 opacity-30 text-foreground'
    const total = wins + losses
    const winRate = wins / total
    
    if (winRate > 0.5) return 'bg-uno-green/20 text-uno-green font-bold'
    if (winRate < 0.5) return 'bg-uno-red/20 text-uno-red font-bold'
    return 'bg-white/10 text-foreground'
  }

  return (
    <main className="min-h-screen p-4 md:p-8 max-w-[95vw] mx-auto space-y-8">
      <header className="flex items-center gap-4 flex-wrap">
        <Link href="/" className="p-2 border border-foreground hover:bg-uno-yellow hover:text-black transition-colors">
          <ArrowLeft size={20} />
        </Link>
        <h1 className="text-3xl md:text-4xl font-black font-mono uppercase tracking-tighter text-uno-yellow flex items-center gap-3">
          <Grid size={32} /> Global Rivalry Matrix
        </h1>
      </header>

      <div className="border border-foreground/20 p-6 bg-white/5 shadow-[4px_4px_0px_0px_var(--uno-yellow)] overflow-x-auto">
        <div className="text-sm font-mono opacity-60 mb-6">
          Row player's win rate against Column player in shared games.
          <br/>
          <span className="text-uno-green font-bold">Green: Winning</span> | <span className="text-uno-red font-bold">Red: Losing</span>
        </div>

        <table className="w-full text-left border-collapse min-w-max">
          <thead>
            <tr>
              <th className="p-3 border-b-2 border-r-2 border-foreground/20 bg-background sticky left-0 z-10 w-32">
                <div className="text-xs uppercase font-mono opacity-50">Player</div>
              </th>
              {players.map(p => (
                <th key={p.id} className="p-3 border-b-2 border-foreground/20 text-center w-24">
                  <Link href={`/player/${p.id}`} className="hover:text-uno-yellow transition-colors font-mono text-sm font-bold truncate block max-w-[80px] mx-auto">
                    {p.name}
                  </Link>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {players.map(p1 => (
              <tr key={p1.id} className="hover:bg-white/5 transition-colors">
                <th className="p-3 border-r-2 border-b border-foreground/20 bg-background sticky left-0 z-10 w-32">
                  <Link href={`/player/${p1.id}`} className="hover:text-uno-yellow transition-colors font-mono text-sm font-bold truncate block">
                    {p1.name}
                  </Link>
                </th>
                {players.map(p2 => {
                  if (p1.id === p2.id) {
                    return <td key={p2.id} className="p-3 border-b border-foreground/20 bg-black/50 text-center">-</td>
                  }

                  const stats = matrix[p1.id][p2.id]
                  const total = stats.wins + stats.losses
                  const hasPlayed = total > 0

                  return (
                    <td key={p2.id} className="p-0 border-b border-foreground/20 relative group">
                      <Link 
                        href={`/rivalry?p1=${p1.id}&p2=${p2.id}`}
                        className={cn(
                          "flex flex-col items-center justify-center p-3 h-full w-full transition-colors hover:ring-2 hover:ring-uno-yellow hover:ring-inset z-0 relative",
                          getCellColor(stats.wins, stats.losses)
                        )}
                      >
                        {hasPlayed ? (
                          <>
                            <div className="text-sm font-mono">{Math.round((stats.wins / total) * 100)}%</div>
                            <div className="text-[10px] font-mono opacity-50">{stats.wins} - {stats.losses}</div>
                          </>
                        ) : (
                          <div className="text-sm font-mono opacity-30">-</div>
                        )}
                      </Link>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  )
}
