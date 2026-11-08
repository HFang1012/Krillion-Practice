import type { Tier } from '../types'
import { TIER_META } from '../lib/tiers'

export function Sprite({
  tier,
  size = 72,
}: {
  tier: Tier | 'noecho'
  size?: number
}) {
  const ghost = tier === 'noecho'
  const src = ghost ? TIER_META.krillion.art : TIER_META[tier].art
  const className = ghost ? 'sprite ghost' : tier === 'krillion' ? 'sprite krill' : 'sprite'
  return <img className={className} src={src} alt="" width={size} height={size} />
}
