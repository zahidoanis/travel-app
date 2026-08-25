import { useEffect, useState } from 'react'
import BottomNav, { TABS, RAIL_ONLY } from './components/BottomNav'
import { User } from './components/Icons'
import ErrorBoundary from './components/ErrorBoundary'
import Welcome from './screens/Welcome'
import Onboarding from './screens/Onboarding'
import Home from './screens/Home'
import MapScreen from './screens/MapScreen'
import Chat from './screens/Chat'
import Finance from './screens/Finance'
import Days from './screens/Days'
import Restaurants from './screens/Restaurants'
import Arrival from './screens/Arrival'
import Hotels from './screens/Hotels'
import Summary from './screens/Summary'
import Diagnostics from './screens/Diagnostics'
import { TripProvider, useTrip } from './TripProvider'
import { PARTY_COLORS } from './data'
import AccountSheet from './components/AccountSheet'
import JoinWelcomeSheet from './components/JoinWelcomeSheet'
import NotificationsSheet from './components/NotificationsSheet'
import { initTelemetry, breadcrumb, attachSink } from './lib/telemetry'
import { hasFirebase } from './lib/firebase'
import { pushDiagnostics } from './lib/db'
import { initials } from './lib/text'

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
  const {
    isReal, completeOnboarding, loading, user, syncState, skipWelcome,
    accountOpen, openAccount, closeAccount,
    profile, updateTrip, editStep, closeEdit,
  } = useTrip()
  const [tab, setTab] = useState('home')
  const [started, setStarted] = useState(false)
  const [debug, setDebug] = useState(
    () => new URLSearchParams(location.search).get('debug') === '1'
  )
  const [saveError, setSaveError] = useState(null)
  useEffect(() => {
    if (!saveError) return
    const t = setTimeout(() => setSaveError(null), 5000)
    return () => clearTimeout(t)
  }, [saveError])

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
            <span className="boot-mark">Trip<span className="boot-ai">AI</span></span>
            <span className="typing"><i /><i /><i /></span>
          </div>
        </div>
      </div>
    )
  }

  // Editing an existing trip reuses the onboarding wizard rather than a
  // second form for the same fields — seeded with what's already saved,
  // opened on whichever question the caller asked for, and free to leave
  // early. Only reachable once a real trip exists, so `profile` here is
  // always the trip being edited, never the pre-onboarding blank slate.
  // Belt and suspenders alongside the button-level guard in AccountSheet:
  // whatever opened the editor, there is nothing to edit without a trip to
  // seed it from, and `profile` being null here would otherwise crash on
  // the very first field read below.
  if (editStep && profile) {
    // Every field defaulted, not just spread from the stored document — a
    // trip made before some field existed (lat/lng here, for anyone who
    // planned before that shipped) leaves that key genuinely undefined on
    // `profile`, and Firestore's setDoc() rejects an undefined value
    // outright. It rejects synchronously, before any network call, so nothing
    // in the same write goes through either — silently, since saveTrip()
    // swallows the error into telemetry rather than surfacing it. The whole
    // edit looked like it saved and then reverted on the next real read.
    const editInitial = {
      destination: profile.destination ?? '',
      country: profile.country ?? '',
      destinationEn: profile.destinationEn ?? '',
      lat: profile.lat ?? null,
      lng: profile.lng ?? null,
      from: profile.from ?? '',
      to: profile.to ?? '',
      styles: profile.styles ?? [],
      parties: profile.parties?.length ? profile.parties : [
        { id: 'p1', name: '', members: [{ name: '', age: '' }], color: PARTY_COLORS[0] },
      ],
      cuisines: profile.cuisines ?? ['local'],
      flight: profile.flight ?? { airline: '', number: '', arrivalAirport: '', date: '' },
      stays: profile.stays ?? [],
    }
    const saveEdit = async (answers) => {
      const { nights, travellers, ...patch } = answers
      const ok = await updateTrip(patch)
      // `false` means "no backend configured" as often as it means "the
      // write actually failed" — updateTrip() can't tell those apart, so
      // this decides based on whether a backend exists at all. Only the
      // real failure gets a message; local-only mode always looked like
      // this and isn't an error.
      if (ok || !hasFirebase) {
        closeEdit()
      } else {
        setSaveError('השמירה נכשלה. בדוק חיבור לאינטרנט ונסה שוב.')
      }
    }

    return (
      <div className="shell">
        <div className="app" dir="rtl">
          {saveError && (
            <div className="toast">
              <div
                style={{ color: 'var(--rose, #EF4444)', pointerEvents: 'auto', cursor: 'pointer' }}
                onClick={() => setSaveError(null)}
              >
                {saveError}
              </div>
            </div>
          )}
          <ErrorBoundary scope="edit-trip">
            <div className="onboarding">
              <Onboarding
                editMode
                startAt={editStep}
                initial={editInitial}
                onDone={saveEdit}
                onClose={closeEdit}
              />
            </div>
          </ErrorBoundary>
        </div>
      </div>
    )
  }

  const onboarding = !isReal

  return (
    <div className="shell">
      <div className="app" dir="rtl">
        {/* skipWelcome means this is a returning user planning a second
            trip, not a first visit — the marketing screen would be noise. */}
        {onboarding && !started && !skipWelcome ? (
          <ErrorBoundary scope="welcome">
            <Welcome onStart={() => setStarted(true)} onSignIn={openAccount} />
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
                  onClick={() => (id === 'trips' ? openAccount() : go(id))}
                  aria-current={tab === id ? 'page' : undefined}
                >
                  <span className="rail-glyph"><Icon size={19} /></span>
                  <span>{label}</span>
                </button>
              ))}
              <button className="rail-item" onClick={openAccount}>
                <span className="rail-glyph">
                  {user && !user.anonymous && user.photo ? (
                    <img src={user.photo} alt="" className="rail-photo" />
                  ) : user && !user.anonymous && initials(user.name) ? (
                    <span className="rail-initials">{initials(user.name)}</span>
                  ) : (
                    <User size={19} />
                  )}
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
                    onOpenArrival={() => go('arrival')}
                    onOpenHotels={() => go('hotels')}
                    onOpenSummary={() => go('summary')}
                  />
                )}
                {tab === 'map' && <MapScreen />}
                {tab === 'chat' && <Chat />}
                {tab === 'finance' && <Finance />}
                {tab === 'days' && <Days />}
                {tab === 'food' && <Restaurants />}
                {tab === 'arrival' && <Arrival />}
                {tab === 'hotels' && <Hotels />}
                {tab === 'summary' && <Summary />}
              </ErrorBoundary>
            </div>

            <BottomNav tab={tab} onChange={go} onDebug={() => setDebug(true)} />
          </>
        )}
        {/* Mounted regardless of which branch above is showing — sign-in
            has to be reachable from Welcome too, for someone who already
            has trips on this Google account and wants them immediately
            rather than planning a new one first. */}
        {/* Every other top-level surface in this file is wrapped — these two
            were the exception, and it showed: a crash inside either one had
            nothing catching it, so it took down the entire React tree
            instead of just the sheet. That reads as a blank white screen
            with nothing recoverable, which is what actually got reported. */}
        <ErrorBoundary scope="account">
          <AccountSheet open={accountOpen} onClose={closeAccount} />
        </ErrorBoundary>
        <ErrorBoundary scope="join-welcome">
          <JoinWelcomeSheet />
        </ErrorBoundary>
        <ErrorBoundary scope="notifications">
          <NotificationsSheet />
        </ErrorBoundary>
      </div>
    </div>
  )
}
