import { useState } from 'react'
import TopBar from '../components/TopBar'
import Sheet from '../components/Sheet'
import { Play, Music, Sliders, Video, Check, Sparkles } from '../components/Icons'
import { PHOTOS } from '../data'

const MUSIC = ['אנרגטי', 'רגוע', 'אפי', 'לו-פיי']
const STYLES = ['קולנועי', 'ריל מהיר', 'וינטג׳ 8mm']

/** Masonry heights, cycled — stands in for real photo aspect ratios. */
const HEIGHTS = [176, 132, 148, 196, 140, 168]

export default function Gallery() {
  const [open, setOpen] = useState(false)
  const [music, setMusic] = useState(MUSIC[0])
  const [style, setStyle] = useState(STYLES[0])
  const [length, setLength] = useState(45)
  const [rendering, setRendering] = useState(false)
  const [done, setDone] = useState(false)

  const generate = () => {
    setRendering(true)
    setDone(false)
    setTimeout(() => {
      setRendering(false)
      setDone(true)
    }, 1800)
  }

  return (
    <div className="screen">
      <TopBar />

      <div className="pad">
        <section className="recap-banner">
          <div className="recap-strip">TRIPAI · DAILY RECAP</div>
          <div className="grow" style={{ marginTop: 12 }}>
            <h2 className="h2" style={{ fontSize: 19 }}>צור סרטון סיכום יומי</h2>
            <p className="tiny" style={{ marginTop: 5 }}>
              AI יחבר את הרגעים הטובים ביותר
            </p>
          </div>
          <button className="play" onClick={() => setOpen(true)} aria-label="צור סרטון סיכום">
            <Play size={20} />
          </button>
        </section>
      </div>

      <div className="pad between" style={{ marginTop: 20, marginBottom: 12 }}>
        <span className="tiny">גלריית קבוצה · סונכרן מ-WhatsApp</span>
        <span className="badge badge-solid">
          <span className="num">42</span> תמונות חדשות
        </span>
      </div>

      <div className="pad">
        <div className="masonry">
          {PHOTOS.map((p, i) => (
            <button key={p.id} className="photo" aria-label={`תמונה מאת ${p.by.name}`}>
              <span style={{ display: 'block', height: HEIGHTS[i % HEIGHTS.length], background: p.grad }} />
              <span className="avatar-badge" style={{ background: p.by.color }} title={p.by.name}>
                {p.by.short}
              </span>
            </button>
          ))}
        </div>
      </div>

      <Sheet open={open} title="התאמת סרטון הסיכום" onClose={() => setOpen(false)}>
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
          className="range"
          type="range"
          min="15"
          max="120"
          step="15"
          value={length}
          onChange={(e) => setLength(Number(e.target.value))}
          aria-label="אורך הסרטון בשניות"
        />
        <div className="between" style={{ marginTop: 8, marginBottom: 20 }}>
          <span className="tiny"><span className="num">15</span> שנ׳</span>
          <strong style={{ fontSize: 14, color: 'var(--lav)' }}>
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

        <button className="btn btn-primary btn-block" onClick={generate} disabled={rendering}>
          {rendering ? (
            <>
              <span className="typing"><i /><i /><i /></span>
              מייצר סרטון...
            </>
          ) : done ? (
            <><Check size={17} /> הסרטון מוכן!</>
          ) : (
            <><Sparkles size={17} /> צור סרטון</>
          )}
        </button>

        {done && (
          <p className="tiny" style={{ textAlign: 'center', marginTop: 12 }}>
            סרטון <span className="num">{length}</span> שניות בסגנון {style} · מוזיקה {music}
          </p>
        )}
      </Sheet>
    </div>
  )
}
