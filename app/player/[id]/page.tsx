import { supabase } from '@/lib/supabase'
import Link from 'next/link'
import { ArrowLeft, Trophy, Target, Hash } from 'lucide-react'

// Force dynamic rendering
export const dynamic = 'force-dynamic'

export default async function PlayerProfile({ params }: { params: { id: string } }) {
  const { id } = params
  
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

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
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
      </div>

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
