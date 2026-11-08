import { TIER_META } from '../lib/tiers'

export function Descending({ label = 'descending…' }: { label?: string }) {
  return (
    <div className="descending" role="status">
      <img className="sprite krill bob" src={TIER_META.krillion.art} alt="" width={72} height={72} />
      <p>{label}</p>
    </div>
  )
}
