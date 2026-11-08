export function Descending({ label = 'descending…' }: { label?: string }) {
  return (
    <div className="descending" role="status">
      <img className="sprite krill bob" src="/art/krillion.png" alt="" width={72} height={72} />
      <p>{label}</p>
    </div>
  )
}
