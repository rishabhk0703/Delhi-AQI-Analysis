import React from 'react'

// Semi-circular gauge, 0-500 AQI scale, colored bands matching Indian AQI categories.
export default function AQIDial({ value, color, size = 200 }) {
  const clamped = Math.max(0, Math.min(500, value))
  const pct = clamped / 500
  const radius = size / 2 - 14
  const cx = size / 2
  const cy = size / 2 + 6

  const startAngle = 180
  const endAngle = 0
  const angle = startAngle - pct * (startAngle - endAngle)

  const polarToCartesian = (cx, cy, r, angleDeg) => {
    const rad = (angleDeg * Math.PI) / 180
    return { x: cx + r * Math.cos(rad), y: cy - r * Math.sin(rad) }
  }

  const arcPath = (r, a1, a2) => {
    const p1 = polarToCartesian(cx, cy, r, a1)
    const p2 = polarToCartesian(cx, cy, r, a2)
    const largeArc = a1 - a2 <= 180 ? 0 : 1
    return `M ${p1.x} ${p1.y} A ${r} ${r} 0 ${largeArc} 1 ${p2.x} ${p2.y}`
  }

  const bands = [
    { from: 0, to: 50, color: '#22c55e' },
    { from: 50, to: 100, color: '#84cc16' },
    { from: 100, to: 200, color: '#eab308' },
    { from: 200, to: 300, color: '#f97316' },
    { from: 300, to: 400, color: '#ef4444' },
    { from: 400, to: 500, color: '#991b1b' },
  ]

  const needleTip = polarToCartesian(cx, cy, radius - 6, angle)

  return (
    <svg width={size} height={size / 2 + 40} viewBox={`0 0 ${size} ${size / 2 + 40}`}>
      {bands.map((b, i) => {
        const a1 = 180 - (b.from / 500) * 180
        const a2 = 180 - (b.to / 500) * 180
        return (
          <path
            key={i}
            d={arcPath(radius, a1, a2)}
            stroke={b.color}
            strokeWidth={12}
            fill="none"
            strokeLinecap="butt"
            opacity={0.85}
          />
        )
      })}
      <line
        x1={cx}
        y1={cy}
        x2={needleTip.x}
        y2={needleTip.y}
        stroke="#e7edf3"
        strokeWidth={2.5}
        strokeLinecap="round"
      />
      <circle cx={cx} cy={cy} r={5} fill="#e7edf3" />
      <text
        x={cx}
        y={cy - 30}
        textAnchor="middle"
        className="dial-number"
        fill={color}
        fontSize={38}
      >
        {Math.round(clamped)}
      </text>
      <text
        x={cx}
        y={cy - 10}
        textAnchor="middle"
        fill="#8695a7"
        fontSize={11}
        fontFamily="var(--font-mono)"
        letterSpacing="0.06em"
      >
        AQI
      </text>
    </svg>
  )
}
