import { LegalLink } from '../legal/parts'
import { t } from '../i18n'

/**
 * The three legal documents in a row — the footer every entry point shares,
 * so the terms, the privacy policy and the accessibility statement are one
 * tap away from the welcome screen, the account sheet and the desktop rail.
 */
export default function LegalLinks({ className = '' }) {
  return (
    <nav className={`legal-links ${className}`} aria-label={t('מסמכים משפטיים')}>
      <LegalLink doc="terms">{t('תנאי שימוש')}</LegalLink>
      <LegalLink doc="privacy">{t('מדיניות פרטיות')}</LegalLink>
      <LegalLink doc="accessibility">{t('הצהרת נגישות')}</LegalLink>
    </nav>
  )
}
