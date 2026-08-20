import { useEffect, useState } from 'react'
import BottomNav, { TABS } from './components/BottomNav'
import ErrorBoundary from './components/ErrorBoundary'
import Onboarding from './screens/Onboarding'
import Home from './screens/Home'
import MapScreen from './screens/MapScreen'
import Chat from './screens/Chat'
import Gallery from './screens/Gallery'
import Finance from './screens/Finance'
import Diagnostics from './screens/Diagnostics'
import { initTelemetry, breadcrumb, attachSink, record } from './lib/telemetry'
import { hasFirebase } from './lib/firebase'
import { pushDiagnostics, loadProfile, saveProfile } from './lib/db'

initTelemetry()

// Mirror the crash log to Firestore once a project is configured.
if (hasFirebase) attachSink(pushDiagnostics)

export default function App() {
  const [onboarded, setOnboarded] = useState(false)
  const [tab, setTab] = useState('home')
  const [debug, setDebug] = useState(
    () => new URLSearchParams(location.search).get('debug') === '1'
  )

  // Returning users skip onboarding; the profile also seeds their preferences.
  useEffect(() => {
    loadProfile()
      .then((profile) => {
        if (profile?.styles?.length > 0) setOnboarded(true)
        breadcrumb('lifecycle', `profile loaded (${profile?.uid ?? 'none'})`)
      })
      .catch((err) => record({ kind: 'db', message: `loadProfile: ${err.message}` }))
  }, [])

  const go = (next) => {
    breadcrumb('nav', `tab -> ${next}`)
    setTab(next)
  }

  const finishOnboarding = (prefs) => {
    saveProfile(prefs)
    breadcrumb('lifecycle', 'onboarding complete')
    setOnboarded(true)
  }

  if (debug) {
    return (
      <div className="shell">
        <div className="app" dir="rtl">
          <Diagnostics onClose={() => setDebug(false)} />
        </div>
      </div>
    )
  }

  return (
    <div className="shell">
      <div className="app" dir="rtl">
        {!onboarded ? (
          <ErrorBoundary scope="onboarding">
            <Onboarding onDone={finishOnboarding} />
          </ErrorBoundary>
        ) : (
          <>
            {/* Wide screens get a side rail; narrow ones the floating bottom bar. */}
            <aside className="rail" aria-label="ניווט ראשי">
              <span className="rail-brand">TripAI</span>
              {TABS.map(({ id, label, Icon }) => (
                <button
                  key={id}
                  className={`rail-item ${tab === id ? 'active' : ''}`}
                  onClick={() => go(id)}
                  aria-current={tab === id ? 'page' : undefined}
                >
                  <span className="rail-glyph"><Icon size={19} /></span>
                  <span>{label}</span>
                </button>
              ))}
              <button className="rail-item rail-debug" onClick={() => setDebug(true)}>
                <span className="rail-glyph">🩺</span>
                <span>אבחון</span>
              </button>
            </aside>

            <div className="stage">
              <ErrorBoundary scope={tab} key={tab}>
                {tab === 'home' && (
                  <Home onStartRoute={() => go('map')} onOpenChat={() => go('chat')} />
                )}
                {tab === 'map' && <MapScreen />}
                {tab === 'chat' && <Chat />}
                {tab === 'gallery' && <Gallery />}
                {tab === 'finance' && <Finance />}
              </ErrorBoundary>
            </div>

            <BottomNav tab={tab} onChange={go} onDebug={() => setDebug(true)} />
          </>
        )}
      </div>
    </div>
  )
}
