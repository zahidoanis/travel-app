import { useRef, useState } from 'react'
import TopBar from '../components/TopBar'
import Sheet from '../components/Sheet'
import {
  Play, Music, Sliders, Video, Check, Sparkles, Plus, X, Images, WhatsApp, Info,
} from '../components/Icons'
import { useTrip } from '../TripProvider'
import { shareTrip } from '../lib/share'
import { breadcrumb, record } from '../lib/telemetry'

const MUSIC = ['אנרגטי', 'רגוע', 'אפי', 'לו-פיי']
const STYLES = ['קולנועי', 'ריל מהיר', 'וינטג׳ 8mm']

export default function Gallery() {
  const { trip, families } = useTrip()

  // Media the user actually added, held as object URLs for this session.
  const [items, setItems] = useState([])
  const [open, setOpen] = useState(false)
  const [music, setMusic] = useState(MUSIC[0])
  const [style, setStyle] = useState(STYLES[0])
  const [length, setLength] = useState(45)
  const fileRef = useRef(null)

  const pick = (event) => {
    const files = Array.from(event.target.files ?? [])
    if (files.length === 0) return

    breadcrumb('action', `${files.length} media files added`)
    setItems((list) => [
      ...files.map((f) => ({
        id: `${f.name}-${f.lastModified}`,
        name: f.name,
        url: URL.createObjectURL(f),
        video: f.type.startsWith('video/'),
        by: families[0]?.short ?? '?',
        color: families[0]?.color ?? 'var(--accent)',
      })),
      ...list,
    ])
    event.target.value = ''
  }

  const remove = (id) => {
    setItems((list) => {
      const gone = list.find((i) => i.id === id)
      if (gone) URL.revokeObjectURL(gone.url)
      return list.filter((i) => i.id !== id)
    })
  }

  /**
   * WhatsApp has no API for pulling a group's media — that would need the
   * Business API, which is neither free nor able to read personal chats. What
   * works is the other direction: export from WhatsApp, import here.
   */
  const importFromWhatsApp = () => {
    breadcrumb('action', 'whatsapp import opened')
    fileRef.current?.click()
  }

  return (
    <div className="screen">
      <TopBar />

      <div className="pad">
        <h1 className="h1" style={{ fontSize: 24 }}>הגלריה של הטיול</h1>
        <p className="tiny" style={{ marginTop: 4 }}>
          {trip ? `${trip.city} · ` : ''}
          <span className="num">{items.length}</span> פריטים
        </p>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/*,video/*"
        multiple
        onChange={pick}
        style={{ display: 'none' }}
      />

      <div className="pad" style={{ marginTop: 18 }}>
        <div className="row" style={{ gap: 10 }}>
          <button className="btn btn-primary grow" onClick={() => fileRef.current?.click()}>
            <Plus size={16} />
            הוסף תמונות וסרטונים
          </button>
          <button
            className="btn btn-ghost"
            style={{ color: '#128C7E' }}
            onClick={importFromWhatsApp}
            title="ייצוא מוואטסאפ ואז בחירת הקבצים"
          >
            <WhatsApp size={17} />
          </button>
        </div>

        <div className="card" style={{ marginTop: 14, background: 'var(--sunken)' }}>
          <div className="row" style={{ alignItems: 'flex-start', gap: 9 }}>
            <span style={{ color: 'var(--muted)' }}><Info size={15} /></span>
            <p className="tiny" style={{ margin: 0 }}>
              <strong>ייבוא מוואטסאפ:</strong> בקבוצה → תפריט → ייצוא צ׳אט → כולל מדיה.
              אחר כך בחרו כאן את הקבצים. אין דרך למשוך מדיה מקבוצה אוטומטית —
              WhatsApp לא מאפשר גישה לצ׳אטים פרטיים לשום אפליקציה.
            </p>
          </div>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="pad" style={{ marginTop: 22 }}>
          <div className="card" style={{ textAlign: 'center', padding: 34 }}>
            <span style={{ color: 'var(--muted-2)' }}><Images size={30} /></span>
            <p className="sub" style={{ marginTop: 12 }}>
              עדיין אין מדיה. הוסיפו תמונות מהטיול והסוכן יוכל להרכיב מהן סרטון סיכום.
            </p>
          </div>
        </div>
      ) : (
        <>
          <div className="pad" style={{ marginTop: 20 }}>
            <section className="recap-banner">
              <div className="grow" style={{ marginTop: 12 }}>
                <h2 className="h2" style={{ fontSize: 19 }}>צור סרטון סיכום</h2>
                <p className="tiny" style={{ marginTop: 5 }}>
                  מ-<span className="num">{items.length}</span> הפריטים שהוספתם
                </p>
              </div>
              <button className="play" onClick={() => setOpen(true)} aria-label="צור סרטון סיכום">
                <Play size={20} />
              </button>
            </section>
          </div>

          <div className="pad" style={{ marginTop: 18 }}>
            <div className="masonry">
              {items.map((it) => (
                <div key={it.id} className="photo">
                  {it.video ? (
                    <video src={it.url} className="media" muted playsInline preload="metadata" />
                  ) : (
                    <img src={it.url} alt={it.name} className="media" loading="lazy" />
                  )}
                  <span className="avatar-badge" style={{ background: it.color }}>{it.by}</span>
                  <button
                    className="photo-remove"
                    onClick={() => remove(it.id)}
                    aria-label={`הסר את ${it.name}`}
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      <Sheet open={open} title="סרטון סיכום" onClose={() => setOpen(false)}>
        <div className="card" style={{ background: 'var(--sunken)', marginBottom: 18 }}>
          <div className="row" style={{ alignItems: 'flex-start', gap: 9 }}>
            <span style={{ color: 'var(--amber)' }}><Info size={15} /></span>
            <p className="tiny" style={{ margin: 0 }}>
              עריכת וידאו אמיתית עדיין לא מחוברת. ההגדרות כאן נשמרות, אבל אף קובץ
              לא נוצר — לא אציג לך סרטון מזויף.
            </p>
          </div>
        </div>

        <label className="label"><Music size={13} /> מוזיקת רקע</label>
        <div className="pills" style={{ marginBottom: 20 }}>
          {MUSIC.map((m) => (
            <button key={m} className={`pill ${music === m ? 'on' : ''}`} onClick={() => setMusic(m)}>
              {m}
            </button>
          ))}
        </div>

        <label className="label"><Sliders size={13} /> אורך הסרטון</label>
        <input
          className="range" type="range" min="15" max="120" step="15"
          value={length}
          onChange={(e) => setLength(Number(e.target.value))}
          aria-label="אורך הסרטון בשניות"
        />
        <div className="between" style={{ marginTop: 8, marginBottom: 20 }}>
          <span className="tiny"><span className="num">15</span> שנ׳</span>
          <strong style={{ fontSize: 14, color: 'var(--accent)' }}>
            <span className="num">{length}</span> שניות
          </strong>
          <span className="tiny"><span className="num">120</span> שנ׳</span>
        </div>

        <label className="label"><Video size={13} /> סגנון עריכה</label>
        <div className="pills" style={{ marginBottom: 24 }}>
          {STYLES.map((s) => (
            <button key={s} className={`pill ${style === s ? 'on' : ''}`} onClick={() => setStyle(s)}>
              {s}
            </button>
          ))}
        </div>

        <button
          className="btn btn-ghost btn-block"
          onClick={() =>
            shareTrip(
              `סיכום הטיול שלנו${trip ? ` ב${trip.city}` : ''} — ${items.length} תמונות וסרטונים`,
              location.origin
            )
          }
        >
          <WhatsApp size={17} />
          שתף את הגלריה בוואטסאפ
        </button>
      </Sheet>
    </div>
  )
}
