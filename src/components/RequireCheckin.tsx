import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useToday } from '../hooks/useToday'
import type { Car } from '../lib/checkin'
import type { Tables } from '../lib/database.types'

// A crew-oldalak előfeltétele: legyen mai becsekkolás (autó).
export default function RequireCheckin({
  children,
}: {
  children: (ctx: { car: Car; checkin: Tables<'check_ins'>; date: string }) => ReactNode
}) {
  const { data: today, isLoading } = useToday()

  if (isLoading) return <div className="card"><div className="spinner" /></div>

  if (!today?.car || !today.checkin) {
    return (
      <div className="empty">
        <span className="ico">📷</span>
        Előbb csekkolj be az autóra.
        <div style={{ marginTop: 16 }}>
          <Link to="/beolvasas" className="btn auto" style={{ textDecoration: 'none', display: 'inline-flex' }}>QR beolvasása</Link>
        </div>
      </div>
    )
  }

  return <>{children({ car: today.car, checkin: today.checkin, date: today.date })}</>
}
