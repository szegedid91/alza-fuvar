import { Link } from 'react-router-dom'
import RequireCheckin from '../components/RequireCheckin'
import Icon from '../components/Icon'
import { CleaningCard } from './Inspection'

// Takarítás önálló belépési pontja (kezdőlapi gyorslink). Ugyanaz a kártya,
// mint az autó-ellenőrzés alján — a mai autóhoz kötve.
export default function Cleaning() {
  return (
    <div className="stack">
      <h2>Takarítás</h2>
      <RequireCheckin>
        {({ car, date }) => (
          <>
            <CleaningCard car={car} date={date} />
            <Link to="/ellenorzes" className="tiny muted row" style={{ gap: 6, justifyContent: 'center', textDecoration: 'none' }}>
              <Icon name="camera" size={14} />Ellenőrző fotókat az Autó-ellenőrzés oldalon készíthetsz
            </Link>
          </>
        )}
      </RequireCheckin>
    </div>
  )
}
