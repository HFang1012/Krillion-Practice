import { useEffect, useMemo, useState } from 'react'
import { Dictionary } from './components/Dictionary'
import { Home } from './components/Home'
import { Learn } from './components/Learn'
import { Practice } from './components/Practice'
import { Stats } from './components/Stats'
import { Descending } from './components/Descending'
import { AskKrill } from './components/AskKrill'
import { useBank } from './hooks/useBank'
import { loadLog, saveLog } from './lib/history'
import { publicUrl } from './lib/publicUrl'
import type { QuestionRecord } from './types'

type Mode = 'home' | 'learn' | 'practice' | 'dictionary' | 'stats'

function readRoute(): { mode: Mode; promptId: string | null } {
  const parts = location.hash.replace(/^#/, '').split('/').filter(Boolean)
  if (parts[0] === 'learn') return { mode: 'learn', promptId: parts[1] ?? null }
  if (parts[0] === 'practice') return { mode: 'practice', promptId: parts[1] ?? null }
  if (parts[0] === 'dictionary') return { mode: 'dictionary', promptId: null }
  if (parts[0] === 'stats') return { mode: 'stats', promptId: null }
  return { mode: 'home', promptId: null }
}

export function App() {
  const { index, error } = useBank()
  const [route, setRoute] = useState(readRoute)
  const [log, setLog] = useState<QuestionRecord[]>(() => loadLog())
  const [livePoints, setLivePoints] = useState(0)

  useEffect(() => {
    const apply = () => setRoute(readRoute())
    window.addEventListener('hashchange', apply)
    return () => window.removeEventListener('hashchange', apply)
  }, [])

  useEffect(() => {
    const title =
      route.mode === 'learn'
        ? 'Learn · Krillion Practice'
        : route.mode === 'practice'
          ? 'Practice · Krillion Practice'
          : route.mode === 'dictionary'
            ? 'Dictionary · Krillion Practice'
            : route.mode === 'stats'
              ? 'Statistics · Krillion Practice'
              : 'Krillion Practice'
    document.title = title
  }, [route.mode])

  const savedPoints = useMemo(() => log.reduce((sum, record) => sum + record.total, 0), [log])
  const shownPoints = savedPoints + (route.mode === 'practice' ? livePoints : 0)
  const depth = Math.min(1, shownPoints / 1800)

  function navigate(hash: string) {
    if (location.hash === hash) {
      setRoute(readRoute())
      return
    }
    location.hash = hash
  }

  function append(record: QuestionRecord) {
    setLog((prev) => {
      const next = [record, ...prev].slice(0, 2000)
      saveLog(next)
      return next
    })
    setLivePoints(0)
  }

  function clearLog() {
    setLog([])
    saveLog([])
  }

  let body
  if (error || (index && index.prompts.length === 0)) {
    body = (
      <div className="home">
        <img className="sprite krill bob hero-krill" src={publicUrl('art/krillion.png')} alt="" width={96} height={96} />
        <h1>bank missing</h1>
        <p className="tagline">Run npm run bank, then reload.</p>
      </div>
    )
  } else if (!index) {
    body = <Descending />
  } else if (route.mode === 'learn') {
    body = (
      <Learn
        index={index}
        forcedId={route.promptId}
        points={shownPoints}
        onHome={() => navigate('#/')}
        onClearForce={() => navigate('#/learn')}
      />
    )
  } else if (route.mode === 'dictionary') {
    body = <Dictionary index={index} points={shownPoints} onHome={() => navigate('#/')} />
  } else if (route.mode === 'stats') {
    body = <Stats log={log} points={shownPoints} onHome={() => navigate('#/')} onNavigate={navigate} />
  } else if (route.mode === 'practice') {
    body = (
      <Practice
        index={index}
        forcedId={route.promptId}
        log={log}
        points={shownPoints}
        onHome={() => navigate('#/')}
        onClearForce={() => navigate('#/practice')}
        onAppend={append}
        onClearLog={clearLog}
        onLivePoints={setLivePoints}
      />
    )
  } else {
    body = <Home index={index} onNavigate={navigate} />
  }

  return (
    <div className="sea" style={{ ['--depth' as string]: String(depth) }}>
      <div className="bubbles" aria-hidden="true">
        <span />
        <span />
        <span />
        <span />
        <span />
        <span />
        <span />
        <span />
      </div>
      {body}
      {index && index.prompts.length ? <AskKrill index={index} /> : null}
    </div>
  )
}
