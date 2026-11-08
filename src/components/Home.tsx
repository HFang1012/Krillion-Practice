import type { BankIndex } from '../types'
import { publicUrl } from '../lib/publicUrl'

export function Home({ index, onNavigate }: { index: BankIndex; onNavigate: (hash: string) => void }) {
  return (
    <div className="home">
      <img className="sprite krill bob hero-krill" src={publicUrl('art/krillion.png')} alt="" width={120} height={120} />
      <p className="eyebrow">KRILLION</p>
      <h1>the practice dive</h1>
      <p className="tagline">one in a krillion.</p>
      <div className="mode-grid">
        <button type="button" className="mode-card" onClick={() => onNavigate('#/learn')}>
          <img className="sprite krill" src={publicUrl('art/krillion.png')} alt="" width={72} height={72} />
          <span className="mode-kicker">Mode 01</span>
          <span className="mode-name">Learn</span>
          <span className="mode-copy">
            A random prompt, the gem, and a look at the ladder. Enter or the button drops you onto the next one.
          </span>
        </button>
        <button type="button" className="mode-card" onClick={() => onNavigate('#/practice')}>
          <img className="sprite" src={publicUrl('art/puffer.png')} alt="" width={72} height={72} />
          <span className="mode-kicker">Mode 02</span>
          <span className="mode-name">Practice</span>
          <span className="mode-copy">
            Type an answer and get the same tier, points, and depth. Extra hits raise that question. Next logs it.
          </span>
        </button>
        <button type="button" className="mode-card" onClick={() => onNavigate('#/dictionary')}>
          <img className="sprite" src={publicUrl('art/schooler.png')} alt="" width={72} height={72} />
          <span className="mode-kicker">Mode 03</span>
          <span className="mode-name">Dictionary</span>
          <span className="mode-copy">Search a question and read every answer on its sheet.</span>
        </button>
      </div>
      <p className="home-stats">
        {index.promptCount.toLocaleString('en-US')} prompts · {index.answerCount.toLocaleString('en-US')} answers · through {index.through}
      </p>
      <footer className="fine-print">
        <p>Unofficial practice. Not affiliated with krillion.io.</p>
        <p>
          Sheets from the{' '}
          <a href={index.source} target="_blank" rel="noreferrer">
            public archive
          </a>
          . The live dive is at{' '}
          <a href="https://krillion.io/" target="_blank" rel="noreferrer">
            krillion.io
          </a>
          .
        </p>
      </footer>
    </div>
  )
}
