'use client'

import { cn } from '@/lib/utils'

type RadarPoint = {
  label: string
  value: number // 0 - 100
}

export default function RadarChart({ data, color = '#22c55e' }: { data: RadarPoint[], color?: string }) {
  const size = 300
  const center = size / 2
  const radius = (size / 2) * 0.7
  const angleStep = (Math.PI * 2) / data.length

  // Calculate coordinates for a given value (0-100) at a specific index
  const getCoords = (value: number, index: number) => {
    const r = (value / 100) * radius
    const angle = angleStep * index - Math.PI / 2
    return {
      x: center + r * Math.cos(angle),
      y: center + r * Math.sin(angle),
    }
  }

  // Polygon path for the data
  const points = data.map((d, i) => getCoords(d.value, i))
  const pathData = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ') + ' Z'

  // Labels
  const labels = data.map((d, i) => {
    const { x, y } = getCoords(115, i)
    return (
      <text
        key={i}
        x={x}
        y={y}
        textAnchor="middle"
        dominantBaseline="middle"
        fontSize="10"
        fontFamily="monospace"
        fontWeight="bold"
        className="fill-current opacity-60 uppercase"
      >
        {d.label}
      </text>
    )
  })

  return (
    <div className="w-full flex justify-center items-center">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="overflow-visible">
        {/* Background Grids (Web) */}
        {[0.25, 0.5, 0.75, 1].map((scale, i) => {
          const gridPoints = data.map((_, j) => getCoords(100 * scale, j))
          const gridPath = gridPoints.map((p, j) => `${j === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ') + ' Z'
          return (
            <path
              key={i}
              d={gridPath}
              fill="none"
              stroke="white"
              strokeOpacity="0.05"
              strokeWidth="1"
            />
          )
        })}

        {/* Axis Lines */}
        {data.map((_, i) => {
          const { x, y } = getCoords(100, i)
          return (
            <line
              key={i}
              x1={center}
              y1={center}
              x2={x}
              y2={y}
              stroke="white"
              strokeOpacity="0.05"
              strokeWidth="1"
            />
          )
        })}

        {/* Data Polygon */}
        <path
          d={pathData}
          fill={color}
          fillOpacity="0.2"
          stroke={color}
          strokeWidth="3"
          strokeLinejoin="round"
          className="transition-all duration-700"
        />

        {/* Data Points */}
        {points.map((p, i) => (
          <circle
            key={i}
            cx={p.x}
            cy={p.y}
            r="4"
            fill={color}
            stroke="#0f172a"
            strokeWidth="2"
          />
        ))}

        {/* Labels Overlay */}
        {labels}
      </svg>
    </div>
  )
}
