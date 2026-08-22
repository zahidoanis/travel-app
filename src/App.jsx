import { useState } from 'react'
import BottomNav, { TABS, RAIL_ONLY } from './components/BottomNav'
import { User } from './components/Icons'
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
import Arrival from './screens/Arrival'
import Diagnostics from './screens/Diagnostics'
import { TripProvider, useTrip } from './TripProvider'
import AccountSheet from './components/AccountSheet'
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
  const { isReal, completeOnboarding, loading, user, syncState } = useTrip()
  const [tab, setTab] = useState('home')
  const [started, setStarted] = useState(false)
  const [accountOpen, setAccountOpen] = useState(false)
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

  // `profile === null` means the load is still in flight. Rendering the tabs
  // then handed every screen a null trip and they crashed on trip.city — which
  // is why the first load showed the error boundary and a retry looked fine:
  // by the second attempt anonymous auth was cached and the profile arrived
  // sooner. Wait for it instead.
  if (loading) {
    return (
      <div className="shell">
        <div className="app" dir="rtl">
          <div className="boot">
            <span className="boot-mark">Travel<span className="boot-ai">-AI</span></span>
            <span className="typing"><i /><i /><i /></span>
          </div>
        </div>
      </div>
    )
  }

  const onboarding = !isReal

  return (
    <div className="shell">
      <div className="app" dir="rtl">
        {onboarding && !started ? (
          <ErrorBoundary scope="welcome">
            <Welcome onStart={() => setStarted(true)} />
          </ErrorBoundary>
        ) : onboarding ? (
          <ErrorBoundary scope="onboarding">
            <div className="onboarding">
              <Onboarding onDone={completeOnboarding} />
            </div>
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
              <button className="rail-item" onClick={() => setAccountOpen(true)}>
                <span className="rail-glyph">
                  {user && !user.anonymous && user.photo
                    ? <img src={user.photo} alt="" className="rail-photo" />
                    : <User size={19} />}
                </span>
                <span>{user && !user.anonymous ? (user.name?.split(' ')[0] || 'החשבון') : 'שמור טיול'}</span>
              </button>

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
                {tab === 'arrival' && <Arrival />}
              </ErrorBoundary>
            </div>

            <BottomNav tab={tab} onChange={go} onDebug={() => setDebug(true)} />
            <AccountSheet open={accountOpen} onClose={() => setAccountOpen(false)} />
          </>
        )}
      </div>
    </div>
  )
}
