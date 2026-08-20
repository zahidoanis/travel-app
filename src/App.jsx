import { useState } from 'react'
import BottomNav from './components/BottomNav'
import Onboarding from './screens/Onboarding'
import Home from './screens/Home'
import MapScreen from './screens/MapScreen'
import Chat from './screens/Chat'
import Gallery from './screens/Gallery'
import Finance from './screens/Finance'

export default function App() {
  // Onboarding owns the screen until it hands off to the dashboard.
  const [onboarded, setOnboarded] = useState(false)
  const [tab, setTab] = useState('home')

  return (
    <div className="shell">
      <div className="phone" dir="rtl">
        {!onboarded ? (
          <Onboarding onDone={() => setOnboarded(true)} />
        ) : (
          <>
            {tab === 'home' && (
              <Home onStartRoute={() => setTab('map')} onOpenChat={() => setTab('chat')} />
            )}
            {tab === 'map' && <MapScreen />}
            {tab === 'chat' && <Chat />}
            {tab === 'gallery' && <Gallery />}
            {tab === 'finance' && <Finance />}

            <BottomNav tab={tab} onChange={setTab} />
          </>
        )}
      </div>
    </div>
  )
}
