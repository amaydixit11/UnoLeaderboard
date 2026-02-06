import Link from 'next/link'
import Leaderboard from '@/components/Leaderboard'
import { Plus, History } from 'lucide-react'

export default function Home() {
  return (
    <main className="min-h-screen p-4 md:p-8 space-y-8">
      <header className="max-w-4xl mx-auto flex flex-col md:flex-row justify-between items-center gap-6 mb-8 md:mb-12 text-center md:text-left">
        <div>
          <h1 className="text-5xl md:text-7xl font-black tracking-tighter uppercase glitch-text text-uno-red drop-shadow-[4px_4px_0px_rgba(255,255,255,0.2)]">
            UNO No Mercy
          </h1>
          <p className="font-mono text-uno-yellow uppercase tracking-widest mt-2 font-bold text-sm md:text-base">
            The Desperate Ranking System
          </p>
        </div>
        
        <div className="flex flex-col sm:flex-row gap-4 w-full md:w-auto">
          <Link 
            href="/add-game" 
            className="flex-1 md:flex-none flex items-center justify-center gap-2 bg-uno-blue text-white font-bold py-3 md:py-4 px-8 hover:bg-uno-blue/80 transition-all transform hover:scale-105 uppercase font-mono shadow-[4px_4px_0px_0px_rgba(255,255,255,0.2)]"
          >
            <Plus size={24} />
            Log Game
          </Link>
          <Link 
            href="/history" 
            className="flex-1 md:flex-none flex items-center justify-center gap-2 border-2 border-uno-yellow text-uno-yellow font-bold py-3 md:py-4 px-8 hover:bg-uno-yellow hover:text-black transition-all transform hover:scale-105 uppercase font-mono"
          >
            <History size={24} />
            History
          </Link>
        </div>
      </header>

      <Leaderboard />

      <footer className="max-w-4xl mx-auto pt-12 text-center font-mono text-xs opacity-30 uppercase">
        System Operational • v1.0.0
      </footer>
    </main>
  )
}
