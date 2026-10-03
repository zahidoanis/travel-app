import { useEffect, useState } from 'react'
import TopBar from '../components/TopBar'
import Days from './Days'
import MapScreen from './MapScreen'
import { MapIcon, ListIcon } from '../components/Icons'
import { t } from '../i18n'

const WIDE = '(min-width: 1024px)'

function useWide() {
  const [wide, setWide] = useState(() => typeof matchMedia !== 'undefined' && matchMedia(WIDE).matches)
  useEffect(() => {
    const mq = matchMedia(WIDE)
    const on = () => setWide(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return wide
}

/**
 * The itinerary, in one tab instead of three ("home", "map" and "route"
 * all used to open some view of the same stops).
 *
 *   phone   — the list or the map, with a floating pill to switch
 *   desktop — both at once: the list beside the map, a tap on a stop in
 *             either one focusing it in the other
 */
export default function Route({ view = 'list', onViewChange }) {
  const wide = useWide()
  const [focusId, setFocusId] = useState(null)
  // Bumped to ask the list to scroll to (and focus) its "add a stop" form —
  // the map's + button, which used to do nothing at all.
  const [addSignal, setAddSignal] = useState(0)

  if (wide) {
    return (
      <div className="route-wide">
        <TopBar />
        <div className="route-split">
          <div className="route-list">
            <Days embedded focusId={focusId} onFocusStop={setFocusId} addSignal={addSignal} />
          </div>
          <div className="route-map">
            <MapScreen
              embedded
              focusId={focusId}
              onFocusStop={setFocusId}
              onAddStop={() => setAddSignal((n) => n + 1)}
            />
          </div>
        </div>
      </div>
    )
  }

  if (view === 'map') {
    return (
      <MapScreen
        onAddStop={() => { onViewChange('list'); setAddSignal((n) => n + 1) }}
        switcher={
          <button className="view-switch on-map" onClick={() => onViewChange('list')}>
            <ListIcon size={16} /> {t('רשימה')}
          </button>
        }
      />
    )
  }

  return (
    <Days
      addSignal={addSignal}
      switcher={
        <button className="view-switch" onClick={() => { setAddSignal(0); onViewChange('map') }}>
          <MapIcon size={16} /> {t('מפה')}
        </button>
      }
    />
  )
}
