import { useEffect, useState } from 'react'
import { CATEGORIES } from '../data'
import { placePhoto } from '../lib/photos'

/** A tinted panel per category, used until a photo arrives or when none exists. */
const fallback = (cat) => {
  const c = CATEGORIES[cat]?.color ?? '#8A8A9E'
  return `linear-gradient(150deg, ${c}22, ${c}0A)`
}

/**
 * The photo for one stop. Renders the category tint immediately and swaps in
 * the real image once it loads, so a card never appears empty and never jumps
 * height — the box is sized by the caller, not by the image.
 */
export default function PlacePhoto({ name, cat, title, className = 'thumb', style }) {
  const [photo, setPhoto] = useState(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let cancelled = false
    setPhoto(null)
    setLoaded(false)

    placePhoto(name).then((hit) => {
      if (!cancelled) setPhoto(hit)
    })

    return () => { cancelled = true }
  }, [name])

  return (
    <div className={className} style={{ background: fallback(cat), ...style }}>
      {photo && (
        <img
          src={photo.url}
          alt=""
          aria-hidden="true"
          loading="lazy"
          className={`place-img ${loaded ? 'on' : ''}`}
          onLoad={() => setLoaded(true)}
          onError={() => setPhoto(null)}
        />
      )}
      {title && <span className="thumb-title">{title}</span>}
    </div>
  )
}
