import { useEffect, useRef, useState } from 'react'
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
import Reservations from './screens/Reservations'
import Restaurants from './screens/Restaurants'
import Arrival from './screens/Arrival'
import Hotels from './screens/Hotels'
import Summary from './screens/Summary'
import { TripProvider, useTrip } from './TripProvider'
import { PARTY_COLORS } from './data'
import AccountSheet from './components/AccountSheet'
import JoinWelcomeSheet from './components/JoinWelcomeSheet'
import NotificationsSheet from './components/NotificationsSheet'
import LegalLinks from './components/LegalLinks'
import Legal from './screens/Legal'
import { useLegalRoute } from './legal/route'
import { ConfirmProvider, ConfirmHost } from './components/Confirm'
import { historySettled } from './components/Sheet'
import Snack from './components/Snack'
import { initTelemetry, breadcrumb, attachSink } from './lib/telemetry'
import { hasFirebase } from './lib/firebase'
import { pushDiagnostics } from './lib/db'
import { initials } from './lib/text'
import { t, dir } from './i18n'

initTelemetry()

export default function App() {
  const legalDoc = useLegalRoute()

  // Someone who lands straight on a legal page gets that page and nothing
  // else: no Firebase connection, no anonymous account minted for a person
  // who only came to read the privacy policy. The app proper starts the
  // first time the address leaves the legal pages — and from then on stays
  // mounted underneath them, so opening the terms from inside a trip and
  // coming back loses nothing that was on screen.
  const [booted, setBooted] = useState(legalDoc === null)
  useEffect(() => {
    if (legalDoc === null) setBooted(true)
  }, [legalDoc])

  // Mirror the crash log to Firestore once a project is configured. Tied to
  // the same moment for the same reason: the sink connects to Firebase.
  useEffect(() => {
    if (booted && hasFirebase) attachSink(pushDiagnostics)
  }, [booted])

  return (
    <>
      {booted && (
        <div style={{ display: legalDoc ? 'none' : 'contents' }}>
          <ConfirmProvider>
            <TripProvider>
              <Shell />
            </TripProvider>
          </ConfirmProvider>
        </div>
      )}
      {legalDoc && <Legal doc={legalDoc} />}
    </>
  )
}

/** Moves keyboard focus past the navigation, to the first control on screen. */
function skipToMain(e) {
  e.preventDefault()
  // Only the screen on show: the others are kept mounted but hidden.
  const shown = [...(document.getElementById('main')?.children ?? [])].find((el) => el.style.display !== 'none')
  shown?.querySelector('button, a[href], input, select, textarea, [tabindex]')?.focus()
}

function Shell() {
  const {
    isReal, completeOnboarding, loading, user, syncState, skipWelcome,
    accountOpen, openAccount, closeAccount,
    profile, saveTripEdit, editStep, closeEdit,
  } = useTrip()
  // The trip as the editor opened on it — what saving compares against, to
  // write only what was changed there (see saveTripEdit).
  const editBase = useRef(null)
  const [tab, setTab] = useState('home')
  // The trip editor covers the whole screen, so Back should leave the
  // editor, not the screen behind it — same reasoning as Sheet.jsx. Opening
  // it adds a history entry; Back closes it; closing it any other way (save,
  // the X) takes the entry off again.
  useEffect(() => {
    if (!editStep) return
    let popped = false
    let live = true
    const onPop = (e) => {
      if (e.state?.edit) return
      popped = true
      closeEdit()
    }
    // After any sheet that closed to open the editor has taken its own
    // entry off (see historySettled in Sheet.jsx).
    historySettled().then(() => {
      if (!live) return
      history.pushState({ ...history.state, edit: true }, '')
      window.addEventListener('popstate', onPop)
    })
    return () => {
      live = false
      editBase.current = null
      window.removeEventListener('popstate', onPop)
      if (!popped && history.state?.edit) history.back()
    }
    // Only opening and closing matter, not moving between sections.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Boolean(editStep)])

  // Every tab opened so far — those are the screens kept alive (see below).
  const [visited, setVisited] = useState(() => new Set(['home']))
  useEffect(() => {
    setVisited((v) => (v.has(tab) ? v : new Set(v).add(tab)))
  }, [tab])
  const [started, setStarted] = useState(false)
  const [saveError, setSaveError] = useState(null)
  useEffect(() => {
    if (!saveError) return
    const timer = setTimeout(() => setSaveError(null), 5000)
    return () => clearTimeout(timer)
  }, [saveError])

  const go = (next) => {
    if (next === tab) return
    breadcrumb('nav', `tab -> ${next}`)
    setTab(next)
    // Without this, switching screens never touched the browser's own
    // history — so the very first "back" press had nothing of the app's
    // own to land on and left the site entirely, from anywhere inside it.
    history.pushState({ tab: next }, '', location.pathname)
  }

  // The reverse direction: back/forward moving through the history entries
  // go() just started creating. No entry (the page's original load) means
  // home, same as the tab this component itself starts on.
  useEffect(() => {
    const onPop = (e) => {
      setTab(e.state?.tab ?? 'home')
      if (!e.state?.started) setStarted(false)
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  // `profile === null` means the load is still in flight. Rendering the tabs
  // then handed every screen a null trip and they crashed on trip.city — which
  // is why the first load showed the error boundary and a retry looked fine:
  // by the second attempt anonymous auth was cached and the profile arrived
  // sooner. Wait for it instead.
  if (loading) {
    return (
      <div className="shell">
        <div className="app" dir={dir}>
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
      departTime: profile.departTime ?? '',
      returnTime: profile.returnTime ?? '',
      styles: profile.styles ?? [],
      parties: profile.parties?.length ? profile.parties : [
        { id: 'p1', name: '', members: [{ name: '', age: '' }], color: PARTY_COLORS[0] },
      ],
      cuisines: profile.cuisines ?? ['local'],
      flight: profile.flight ?? { airline: '', number: '', arrivalAirport: '', date: '' },
      stays: profile.stays ?? [],
    }
    editBase.current ??= editInitial
    const saveEdit = async (answers) => {
      const ok = await saveTripEdit(editBase.current, answers)
      if (ok === null) return // backed out at a confirm: keep editing
      if (ok) closeEdit()
      else setSaveError(t('השמירה נכשלה. בדוק חיבור לאינטרנט ונסה שוב.'))
    }

    return (
      <div className="shell">
        <div className="app" dir={dir}>
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
          {/* The editor's confirms and messages — these were only drawn
              behind it, on the main screen. */}
          <ConfirmHost />
          <Snack />
        </div>
      </div>
    )
  }

  const onboarding = !isReal

  const screenFor = (id) => {
    switch (id) {
      case 'home':
        return (
          <Home
            onStartRoute={() => go('map')}
            onOpenChat={() => go('chat')}
            onOpenDays={() => go('days')}
            onOpenFood={() => go('food')}
            onOpenArrival={() => go('arrival')}
            onOpenHotels={() => go('hotels')}
            onOpenSummary={() => go('summary')}
          />
        )
      case 'map': return <MapScreen />
      case 'chat': return <Chat />
      case 'finance': return <Finance />
      case 'days': return <Days />
      case 'reservations': return <Reservations />
      case 'food': return <Restaurants />
      case 'arrival': return <Arrival />
      case 'hotels': return <Hotels />
      case 'summary': return <Summary />
      default: return null
    }
  }

  return (
    <div className="shell">
      <div className="app" dir={dir}>
        {/* skipWelcome means this is a returning user planning a second
            trip, not a first visit — the marketing screen would be noise. */}
        {onboarding && !started && !skipWelcome ? (
          <ErrorBoundary scope="welcome">
            <Welcome
              onStart={() => {
                // Back from the first question returns here, not off the site.
                history.pushState({ ...history.state, started: true, onboardingStep: 0 }, '')
                setStarted(true)
              }}
              onSignIn={openAccount}
            />
          </ErrorBoundary>
        ) : onboarding ? (
          <ErrorBoundary scope="onboarding">
            <div className="onboarding">
              <Onboarding onDone={completeOnboarding} />
            </div>
          </ErrorBoundary>
        ) : (
          <>
            <a className="skip-link" href="#main" onClick={skipToMain}>{t('דלג לתוכן הראשי')}</a>
            <aside className="rail" aria-label={t('ניווט ראשי')}>
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
                <span>{user && !user.anonymous ? (user.name?.split(' ')[0] || t('החשבון')) : t('שמור טיול')}</span>
              </button>
              <LegalLinks className="rail-legal" />
            </aside>

            {/* A screen, once opened, stays mounted and is only hidden when
                another tab is showing. Switching tabs used to unmount the
                screen being left, so coming back refetched everything on it —
                the weather, exchange rates, AI suggestions — and dropped the
                scroll position. Data still updates live underneath (it comes
                from TripProvider), so a kept screen is never stale. */}
            <main className="stage" id="main">
              {[...visited].map((id) => (
                <div key={id} style={{ display: id === tab ? 'contents' : 'none' }}>
                  <ErrorBoundary scope={id}>
                    {screenFor(id)}
                  </ErrorBoundary>
                </div>
              ))}
            </main>

            <BottomNav tab={tab} onChange={go} />
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
        {/* Last, so it opens above whichever sheet asked the question. */}
        <ConfirmHost />
        <Snack />
      </div>
    </div>
  )
}
