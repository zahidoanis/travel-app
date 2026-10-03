import Sheet from './Sheet'
import { ArrowLeft, MapPin, Calendar, Sparkles, Users, Utensils, Plane, Bed } from './Icons'
import { TRAVEL_STYLES, CUISINES } from '../data'
import { SECTION_LABELS } from '../screens/Onboarding'
import { placeNames } from '../lib/placeNames'
import { t, tn, locale } from '../i18n'

/**
 * "What do you want to change?" — every part of the trip, with what it is
 * set to now, each opening the editor right at that part.
 *
 * Editing used to open the full questionnaire at its first question every
 * time, so changing the hotel meant starting from the destination.
 */
const ICONS = { where: MapPin, when: Calendar, style: Sparkles, who: Users, food: Utensils, flight: Plane, stay: Bed }

const shortDate = (iso) =>
  iso ? new Date(`${iso}T12:00:00`).toLocaleDateString(locale, { day: 'numeric', month: 'short' }) : ''

function summary(id, p) {
  const none = t('לא הוזן')
  switch (id) {
    case 'where': return placeNames(p).city || none
    case 'when': return p.from && p.to ? `${shortDate(p.from)} – ${shortDate(p.to)}` : none
    case 'style': return TRAVEL_STYLES.filter((s) => p.styles?.includes(s.id)).map((s) => s.title).join(' · ') || none
    case 'who': {
      const parties = p.parties ?? []
      const people = parties.reduce((n, f) => n + (f.members?.length ?? 0), 0)
      const travellers = `${people} ${tn(people, 'נוסע', 'נוסעים')}`
      return parties.length > 1 ? `${parties.length} ${t('משפחות')} · ${travellers}` : travellers
    }
    case 'food': return CUISINES.filter((c) => p.cuisines?.includes(c.id)).map((c) => c.label).join(' · ') || none
    case 'flight': return [p.flight?.airline, p.flight?.number].filter(Boolean).join(' ') || none
    case 'stay': return (p.stays ?? []).map((s) => s.name).join(' · ') || none
    default: return ''
  }
}

export default function EditTripSheet({ open, profile, onClose, onPick }) {
  if (!profile) return null
  return (
    <Sheet open={open} title={t('מה לערוך?')} onClose={onClose}>
      <div className="col" style={{ gap: 6 }}>
        {Object.entries(SECTION_LABELS).map(([id, label]) => {
          const Icon = ICONS[id]
          return (
            <button key={id} className="edit-row" onClick={() => onPick(id)}>
              <span className="edit-row-icon"><Icon size={16} /></span>
              <span className="grow col" style={{ gap: 1, minWidth: 0 }}>
                <strong>{label}</strong>
                <span className="tiny edit-row-value">{summary(id, profile)}</span>
              </span>
              <ArrowLeft size={16} />
            </button>
          )
        })}
      </div>
    </Sheet>
  )
}
