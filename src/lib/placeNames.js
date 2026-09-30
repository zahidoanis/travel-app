import { CITIES } from '../cities'
import { lang } from '../i18n'

/**
 * A trip's destination in the current UI language.
 *
 * The destination is stored in whichever language the trip was created in,
 * so a trip made in Hebrew showed "פריז" all over the English UI. The
 * curated city list carries both names; a destination not on it falls back
 * to its English name in English, and to what was typed in Hebrew.
 *
 * @param raw a stored trip document (destination, destinationEn, country)
 */
export function placeNames(raw) {
  const known = CITIES.find(
    (c) => c.en === raw?.destinationEn || c.he === raw?.destination || c.en === raw?.destination
  )
  const en = lang === 'en'
  return {
    city: known ? (en ? known.en : known.he) : en ? raw?.destinationEn ?? raw?.destination : raw?.destination,
    country: known ? (en ? known.countryEn : known.country) : raw?.country ?? '',
    cityEn: known?.en ?? raw?.destinationEn ?? raw?.destination,
  }
}
