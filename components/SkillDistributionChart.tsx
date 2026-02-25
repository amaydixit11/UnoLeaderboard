'use client'

import { normalPDF } from '@/lib/analytics'

type PlayerDist = {
  name: string
  mu: number
  sigma: number
  color: string
}

export default function SkillDistributionChart({ players }: { players: PlayerDist[] }) {
  const width = 600
  const height = 300
  const pad = 40
  const chartW = width - pad * 2
  const chartH = height - pad * 2

  // Determine x-axis range (3 sigma around mu for all players)
  const xMin = Math.min(...players.map(p => p.mu - 4 * p.sigma))
  const xMax = Math.max(...players.map(p => p.mu + 4 * p.sigma))
  const xRange = xMax - xMin

  // Determine y-axis max for scaling
  const samplePoints = 100
  const step = xRange / samplePoints
  let yMax = 0

  const plots = players.map(p => {
    const points: { x: number; y: number }[] = []
    for (let i = 0; i <= samplePoints; i++) {
      const xVal = xMin + i * step
      const yVal = normalPDF(xVal, p.mu, p.sigma)
      if (yVal > yMax) yMax = yVal
      points.push({ x: xVal, y: yVal })
    }
    return { ...p, points }
  })

  const toX = (x: number) => pad + ((x - xMin) / xRange) * chartW
  const toY = (y: number) => height - pad - (y / yMax) * chartH

  return (
    <div className="w-full">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto overflow-visible">
        {/* Axes */}
        <line x1={pad} y1={height - pad} x2={width - pad} y2={height - pad} stroke="currentColor" strokeOpacity="0.2" />
        <line x1={pad} y1={pad} x2={pad} y2={height - pad} stroke="currentColor" strokeOpacity="0.1" strokeDasharray="4" />
        
        {/* X-axis labels */}
        {[xMin, (xMin + xMax) / 2, xMax].map((val, i) => (
          <text
            key={i}
            x={toX(val)}
            y={height - pad + 20}
            textAnchor="middle"
            fontSize="10"
            fontFamily="monospace"
            fill="currentColor"
            opacity="0.5"
          >
            {Math.round(val)}
          </text>
        ))}

        {/* Distributions */}
        {plots.map((p, i) => {
          const pathData = p.points.map((pt, j) => 
            `${j === 0 ? 'M' : 'L'} ${toX(pt.x)} ${toY(pt.y)}`
          ).join(' ')
          
          const areaData = `${pathData} L ${toX(p.points[p.points.length - 1].x)} ${height - pad} L ${toX(p.points[0].x)} ${height - pad} Z`

          return (
            <g key={i}>
              <path
                d={areaData}
                fill={p.color}
                fillOpacity="0.1"
              />
              <path
                d={pathData}
                fill="none"
                stroke={p.color}
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeOpacity="0.8"
              />
              {/* Peek Label */}
              <text
                x={toX(p.mu)}
                y={toY(normalPDF(p.mu, p.mu, p.sigma)) - 10}
                textAnchor="middle"
                fontSize="10"
                fontWeight="bold"
                fontFamily="monospace"
                fill={p.color}
              >
                {p.name}
              </text>
            </g>
          )
        })}
      </svg>
      
      <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-4">
        {players.map((p, i) => (
          <div key={i} className="flex flex-col border-l-2 pl-2" style={{ borderColor: p.color }}>
            <span className="text-[10px] uppercase font-mono opacity-50">Skill Range (2σ)</span>
            <span className="text-sm font-bold font-mono">
              {Math.round(p.mu - 2 * p.sigma)} - {Math.round(p.mu + 2 * p.sigma)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
