import { Component, type ErrorInfo, type ReactNode } from 'react'
import { reportClientError } from '../lib/errorReport'

// Renderelési hiba esetén nem fehér képernyő, hanem kiút: újratöltés, vagy a
// helyi gyorsítótár törlése + újratöltés. (Telepített iOS-appban nincs címsor
// és nincs "frissítés" gomb — enélkül csak az újratelepítés segítene.)
// FONTOS: az offline sort (IndexedDB, benne rögzített pénz/fotó) NEM töröljük.
interface State { error: Error | null }

export default class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    void reportClientError(error.message, `${error.stack ?? ''}\n--- component stack ---${info.componentStack ?? ''}`)
  }

  private reload = () => window.location.reload()

  private clearAndReload = () => {
    try { localStorage.removeItem('alza-query-cache') } catch { /* privát mód */ }
    window.location.href = '/'
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="center-screen">
        <div className="card stack" style={{ maxWidth: 380 }}>
          <div style={{ fontSize: 40 }}>😵</div>
          <div className="card-title">Valami elromlott</div>
          <p className="small muted">
            Az app egy váratlan hibába futott. A hibát rögzítettük; a rögzített adataid (offline sor) megmaradnak.
          </p>
          <details className="tiny muted" style={{ textAlign: 'left' }}>
            <summary>Részletek</summary>
            <pre style={{ whiteSpace: 'pre-wrap', margin: '6px 0 0' }}>{this.state.error.message}</pre>
          </details>
          <button className="btn" onClick={this.reload}>🔄 Újratöltés</button>
          <button className="btn ghost sm" onClick={this.clearAndReload}>Helyi gyorsítótár törlése és újratöltés</button>
        </div>
      </div>
    )
  }
}
