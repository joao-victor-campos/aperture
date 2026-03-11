interface ApertureIconProps {
  size?: number
  className?: string
}

/**
 * Camera-aperture / iris-diaphragm icon — the Aperture app logo.
 * 6 overlapping blade-shaped petals create the classic f-stop opening pattern.
 */
export default function ApertureIcon({ size = 20, className = '' }: ApertureIconProps) {
  const blades = [0, 60, 120, 180, 240, 300]

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="Aperture"
    >
      <defs>
        <radialGradient id="ap-blade" cx="50%" cy="25%" r="75%">
          <stop offset="0%" stopColor="#fb923c" />
          <stop offset="100%" stopColor="#c2410c" />
        </radialGradient>
      </defs>

      {/* Dark background disc */}
      <circle cx="50" cy="50" r="50" fill="#130800" />

      {/* 6 aperture blades */}
      <g fill="url(#ap-blade)">
        {blades.map((angle) => (
          <path
            key={angle}
            d="M50 14 Q74 32 50 50 Q26 32 50 14"
            transform={`rotate(${angle} 50 50)`}
          />
        ))}
      </g>

      {/* Center opening */}
      <circle cx="50" cy="50" r="13" fill="#130800" />
      <circle cx="50" cy="50" r="13" fill="none" stroke="#f97316" strokeWidth="0.8" opacity="0.5" />
    </svg>
  )
}
