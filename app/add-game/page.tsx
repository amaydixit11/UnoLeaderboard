'use client'

import { useState, useEffect } from 'react'
import { getPlayers, submitGame, createPlayer } from '@/app/actions'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Plus, Trash2, UserPlus, Save } from 'lucide-react'
import { cn } from '@/lib/utils'

export default function AddGame() {
  const router = useRouter()
  const [availablePlayers, setAvailablePlayers] = useState<any[]>([])
  // Begin with 4 positions
  const [positions, setPositions] = useState<{ playerId: string; position: number }[]>([
    { playerId: '', position: 1 },
    { playerId: '', position: 2 },
    { playerId: '', position: 3 },
    { playerId: '', position: 4 }
  ])
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [newPlayerName, setNewPlayerName] = useState('')
  const [showNewPlayerInput, setShowNewPlayerInput] = useState(false)

  useEffect(() => {
    loadPlayers()
  }, [])

  const loadPlayers = async () => {
    const p = await getPlayers()
    setAvailablePlayers(p)
  }

  const handleAddPosition = () => {
    setPositions([...positions, { playerId: '', position: positions.length + 1 }])
  }

  const handleRemovePosition = (index: number) => {
    if (positions.length <= 4) return
    const newPositions = positions.filter((_, i) => i !== index)
    // Recalculate positions based on index to keep order sane? No, user might want explicit positions.
    // But usually positions are sequential. Let's re-index sequential for UI convenience, but user might overwrite.
    // For now, raw index + 1
    const reindexed = newPositions.map((p, i) => ({ ...p, position: i + 1 }))
    setPositions(reindexed)
  }

  const handleChangePlayer = (index: number, playerId: string) => {
    const newPositions = [...positions]
    newPositions[index].playerId = playerId
    setPositions(newPositions)
  }

  const handleCreatePlayer = async () => {
    if (!newPlayerName.trim()) return
    await createPlayer(newPlayerName)
    setNewPlayerName('')
    setShowNewPlayerInput(false)
    loadPlayers()
  }

  const handleSubmit = async () => {
    // Validate
    if (positions.some(p => !p.playerId)) {
      alert('Please select a player for all positions')
      return
    }

    setIsSubmitting(true)
    try {
      await submitGame(positions)
      router.push('/')
    } catch (e: any) {
      alert('Error submitting game: ' + e.message)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <main className="min-h-screen p-4 md:p-8 max-w-2xl mx-auto space-y-8">
      <header className="flex items-center gap-4">
        <Link href="/" className="p-2 border border-foreground hover:bg-foreground hover:text-background transition-colors">
          <ArrowLeft size={20} />
        </Link>
        <h1 className="text-2xl font-bold font-mono uppercase">Log Game Result</h1>
      </header>

      <div className="border border-foreground/20 p-6 bg-white/5 space-y-6 shadow-[8px_8px_0px_0px_var(--uno-yellow)]">
        <div className="flex justify-between items-center">
          <h2 className="font-mono text-uno-yellow uppercase text-sm tracking-widest font-bold">Rankings</h2>
          <button 
            onClick={() => setShowNewPlayerInput(!showNewPlayerInput)}
            className="text-xs uppercase font-bold flex items-center gap-1 text-foreground hover:text-uno-green transition-colors"
          >
            <UserPlus size={14} /> New Player
          </button>
        </div>

        {showNewPlayerInput && (
          <div className="flex gap-2 p-2 bg-uno-green/10 border border-uno-green/50">
            <input 
              className="bg-transparent border-b border-uno-green px-2 py-1 outline-none text-base flex-1 placeholder:text-foreground/30"
              placeholder="Player Name"
              value={newPlayerName}
              onChange={(e) => setNewPlayerName(e.target.value)}
            />
            <button onClick={handleCreatePlayer} className="text-uno-green font-bold text-xs uppercase px-2">
              Add
            </button>
          </div>
        )}

        <div className="space-y-3">
          {positions.map((pos, index) => (
            <div key={index} className="flex items-center gap-4 animate-in slide-in-from-left-2 fade-in duration-300" style={{ animationDelay: `${index * 50}ms` }}>
              <div className="font-mono font-bold text-xl w-8 text-right opacity-50">
                #{pos.position}
              </div>
              <div className="flex-1">
                <select 
                  className="w-full bg-background border border-foreground/20 p-3 font-mono text-base focus:border-uno-blue outline-none appearance-none cursor-pointer rounded-none"
                  value={pos.playerId}
                  onChange={(e) => handleChangePlayer(index, e.target.value)}
                >
                  <option value="">Select Player...</option>
                  {availablePlayers.map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
              <button 
                onClick={() => handleRemovePosition(index)}
                disabled={positions.length <= 4}
                className="opacity-50 hover:opacity-100 disabled:opacity-10 hover:text-uno-red transition-colors p-2"
              >
                <Trash2 size={20} />
              </button>
            </div>
          ))}
        </div>

        <button 
          onClick={handleAddPosition}
          className="w-full py-4 border-2 border-dashed border-foreground/20 text-foreground/50 hover:border-uno-green hover:text-uno-green transition-colors uppercase font-mono text-sm flex items-center justify-center gap-2"
        >
          <Plus size={16} /> Add Position
        </button>

      </div>

      <div className="flex gap-4">
        <button 
          onClick={handleSubmit}
          disabled={isSubmitting}
          className="flex-1 bg-uno-red text-white font-bold py-4 uppercase font-mono tracking-wider hover:bg-uno-red/90 transition-all flex items-center justify-center gap-2 disabled:opacity-50 shadow-[4px_4px_0px_0px_rgba(255,255,255,0.2)] transform active:translate-y-1 active:shadow-none"
        >
          {isSubmitting ? 'Playing Wild Card...' : (
            <>
              <Save size={18} /> Confirm & Save
            </>
          )}
        </button>
      </div>
    </main>
  )
}
