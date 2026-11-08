import { formatMeters } from '../lib/tiers'

export function TopBar({
  mode,
  points,
  onHome,
  logCount,
}: {
  mode: 'Learn' | 'Practice' | 'Dictionary'
  points: number
  onHome: () => void
  logCount?: number
}) {
  return (
    <header className="topbar">
      <button type="button" className="btn btn-ghost" onClick={onHome}>
        Surface
      </button>
      <p className="brand">
        KRILLION <span>{mode}</span>
      </p>
      <div className="depth-read">
        {logCount != null ? (
          <a href="#log">
            Log {logCount}
          </a>
        ) : (
          <span>depth</span>
        )}
        <strong>{formatMeters(points)}</strong>
      </div>
    </header>
  )
}
