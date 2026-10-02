import { LegalLink } from '../legal/parts'
import { t } from '../i18n'

/**
 * The one sentence that turns "used the site" into "agreed to the terms":
 * shown at every way in — starting a trip, signing in with Google, joining
 * someone else's trip by link — so nobody gets inside without having been
 * pointed at the terms and the privacy policy first.
 */
export default function ConsentNote({ className = '', style }) {
  return (
    <p className={`tiny consent-note ${className}`} style={style}>
      {t('בהמשך אתם מאשרים את')}{' '}
      <LegalLink doc="terms">{t('תנאי השימוש')}</LegalLink>{' '}
      {t('ואת')}{' '}
      <LegalLink doc="privacy">{t('מדיניות הפרטיות')}</LegalLink>.
    </p>
  )
}
