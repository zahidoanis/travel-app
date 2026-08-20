import { Component } from 'react'
import { record, breadcrumb } from '../lib/telemetry'
import { AlertTriangle, RefreshCw } from './Icons'

/**
 * Catches render crashes so one broken screen doesn't blank the whole app.
 *
 * `scope` names the part being guarded, which lands in the log — "Finance
 * crashed" is a far more useful report than "something crashed".
 */
export default class ErrorBoundary extends Component {
  state = { error: null }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    record({
      kind: 'render',
      message: error?.message ?? 'React render error',
      stack: `${error?.stack ?? ''}\n--- component stack ---${info?.componentStack ?? ''}`,
      context: { scope: this.props.scope ?? 'app' },
    })
  }

  reset = () => {
    breadcrumb('action', `recovered from crash in ${this.props.scope ?? 'app'}`)
    this.setState({ error: null })
  }

  render() {
    if (!this.state.error) return this.props.children

    return (
      <div className="screen" style={{ display: 'grid', placeItems: 'center', padding: 28 }}>
        <div className="card" style={{ textAlign: 'center', maxWidth: 320 }}>
          <div
            style={{
              width: 46, height: 46, borderRadius: 14, margin: '0 auto 14px',
              display: 'grid', placeItems: 'center',
              background: 'rgba(251,113,133,0.14)', color: 'var(--rose)',
            }}
          >
            <AlertTriangle size={22} />
          </div>

          <h2 className="h2" style={{ marginBottom: 8 }}>משהו השתבש כאן</h2>
          <p className="sub" style={{ marginBottom: 6 }}>
            התקלה נרשמה ביומן האבחון ואפשר לתחקר אותה מאוחר יותר.
          </p>
          <p className="tiny" style={{ marginBottom: 18, direction: 'ltr', opacity: 0.7 }}>
            {this.state.error?.message}
          </p>

          <button className="btn btn-primary btn-block" onClick={this.reset}>
            <RefreshCw size={16} />
            נסה שוב
          </button>
        </div>
      </div>
    )
  }
}
