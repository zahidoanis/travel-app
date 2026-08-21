import { useState } from 'react'
import BottomNav, { TABS, RAIL_ONLY } from './components/BottomNav'
import ErrorBoundary from './components/ErrorBoundary'
import Welcome from './screens/Welcome'
import Onboarding from './screens/Onboarding'
import Home from './screens/Home'
import MapScreen from './screens/MapScreen'
import Chat from './screens/Chat'
import Gallery from './screens/Gallery'
import Finance from './screens/Finance'
import Days from './screens/Days'
import Restaurants from './screens/Restaurants'
import Diagnostics from './screens/Diagnostics'
import { TripProvider, useTrip } from './TripProvider'
import { initTelemetry, breadcrumb, attachSink } from './lib/telemetry'
import { hasFirebase } from './lib/firebase'
import { pushDiagnostics } from './lib/db'

initTelemetry()

// Mirror the crash log to Firestore once a project is configured.
if (hasFirebase) attachSink(pushDiagnostics)

export default function App() {
  return (
    <TripProvider>
      <Shell />
    </TripProvider>
  )
}

function Shell() {
  const { isReal, completeOnboarding, profile } = useTrip()
  const [tab, setTab] = useState('home')
  const [started, setStarted] = useState(false)
  const [debug, setDebug] = useState(
    () => new URLSearchParams(location.search).get('debug') === '1'
  )

  const go = (next) => {
    breadcrumb('nav', `tab -> ${next}`)
    setTab(next)
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

  // `profile === null` means the load is still in flight; showing onboarding
  // then would flash it at a returning user before their trip appears.
  const onboarding = profile !== null && !isReal

  return (
    <div className="shell">
      <div className="app" dir="rtl">
        {onboarding && !started ? (
          <ErrorBoundary scope="welcome">
            <Welcome onStart={() => setStarted(true)} />
          </ErrorBoundary>
        ) : onboarding ? (
          <ErrorBoundary scope="onboarding">
            <Onboarding onDone={completeOnboarding} />
          </ErrorBoundary>
        ) : (
          <>
            <aside className="rail" aria-label="ניווט ראשי">
              <span className="rail-brand">TripAI</span>
              {[...TABS, ...RAIL_ONLY].map(({ id, label, Icon }) => (
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
                  <Home
                    onStartRoute={() => go('map')}
                    onOpenChat={() => go('chat')}
                    onOpenDays={() => go('days')}
                    onOpenFood={() => go('food')}
                  />
                )}
                {tab === 'map' && <MapScreen />}
                {tab === 'chat' && <Chat />}
                {tab === 'gallery' && <Gallery />}
                {tab === 'finance' && <Finance />}
                {tab === 'days' && <Days />}
                {tab === 'food' && <Restaurants />}
              </ErrorBoundary>
            </div>

            <BottomNav tab={tab} onChange={go} onDebug={() => setDebug(true)} />
          </>
        )}
      </div>
    </div>
  )
}
