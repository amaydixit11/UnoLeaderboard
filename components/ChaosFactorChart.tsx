'use client'

import { linearRegression } from '@/lib/analytics'
import { cn } from '@/lib/utils'

export default function ChaosFactorChart({ 
  data,
  correlation 
}: { 
  data: { lobbySize: number; placement: number }[]
  correlation: number
}) {
  const width = 500
  const height = 300
  const pad = 40
  const chartW = width - pad * 2
  const chartH = height - pad * 2

  if (data.length < 2) return <div className="p-8 text-center opacity-30 font-mono">Insufficient data for chaos analysis</div>

  const xMax = Math.max(8, ...data.map(d => d.lobbySize))
  const xMin = 2
  const yMax = 1 // Placements are 0-1 (normalized)
  const yMin = 0

  const toX = (x: number) => pad + ((x - xMin) / (xMax - xMin)) * chartW
  const toY = (y: number) => height - pad - (y / yMax) * chartH

  // Regression line
  const { m, b } = linearRegression(data.map(d => d.lobbySize), data.map(d => d.placement))
  const x1 = xMin
  const y1 = m * xMin + b
  const x2 = xMax
  const y2 = m * xMax + b

  const getChaosType = (r: number) => {
    if (r > 0.3) return { label: 'The Duelist', color: 'text-uno-blue', desc: 'Performs better in small groups' }
    if (r < -0.3) return { label: 'Chaos Lord', color: 'text-uno-red', desc: 'Thrives in large, messy lobbies' }
    return { label: 'The Machine', color: 'text-uno-yellow', desc: 'Performance is size-independent' }
  }

  const type = getChaosType(correlation)

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-start">
        <div>
          <div className={cn("text-xl font-black font-mono uppercase", type.color)}>{type.label}</div>
          <div className="text-xs font-mono opacity-50 uppercase">{type.desc}</div>
        </div>
        <div className="text-right">
          <div className="text-xs font-mono opacity-50 uppercase">Correlation (r)</div>
          <div className="text-xl font-bold font-mono">{correlation.toFixed(3)}</div>
        </div>
      </div>

      <div className="bg-white/5 border border-foreground/10 p-4">
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto overflow-visible">
          {/* Grid lines */}
          {[0, 0.5, 1].map(y => (
            <line 
              key={y} 
              x1={pad} y1={toY(y)} x2={width - pad} y2={toY(y)} 
              stroke="currentColor" strokeOpacity="0.05" 
            />
          ))}

          {/* Axes */}
          <line x1={pad} y1={height - pad} x2={width - pad} y2={height - pad} stroke="currentColor" strokeOpacity="0.3" />
          <line x1={pad} y1={pad} x2={pad} y2={height - pad} stroke="currentColor" strokeOpacity="0.3" />

          {/* Labels */}
          <text x={width - pad} y={height - pad + 20} textAnchor="end" fontSize="10" fontFamily="monospace" fill="currentColor" opacity="0.4">Lobby Size</text>
          <text x={pad / 2} y={pad} textAnchor="start" fontSize="10" fontFamily="monospace" fill="currentColor" opacity="0.4" transform={`rotate(-90, ${pad / 2}, ${pad})`}>Placement (Top 0 → 1 Bottom)</text>

          {/* Regression Line */}
          <line 
            x1={toX(x1)} y1={toY(y1)} x2={toX(x2)} y2={toY(y2)} 
            stroke="currentColor" strokeWidth="2" strokeDasharray="4 2" strokeOpacity="0.5"
          />

          {/* Data Points */}
          {data.map((d, i) => (
            <circle 
              key={i} 
              cx={toX(d.lobbySize)} 
              cy={toY(d.placement)} 
              r="4" 
              className={cn("fill-current", type.color)}
              fillOpacity="0.6"
            />
          ))}
        </svg>
      </div>
    </div>
  )
}
