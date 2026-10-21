import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useToday } from '../hooks/useToday'
import Icon from './Icon'
import Skeleton from './Skeleton'
import type { Car } from '../lib/checkin'
import type { Tables } from '../lib/database.types'

// A crew-oldalak előfeltétele: legyen mai becsekkolás (autó).
export default function RequireCheckin({
  children,
}: {
  children: (ctx: { car: Car; checkin: Tables<'check_ins'>; date: string }) => ReactNode
}) {
  const { data: today, isLoading, isFetching } = useToday()

  if (isLoading) return <Skeleton rows={4} />

  if (!today?.car || !today.checkin) {
    // A tárolt (lehet, hogy tegnapi/régi) cache "nincs becsekkolva"-t mutatna,
    // amíg a friss lekérdezés fut — addig inkább helyőrző, ne "csekkolj be" felszólítás
    if (isFetching) return <Skeleton rows={4} />
    return (
      <div className="empty">
        <span className="ico"><Icon name="qr-code" size={40} /></span>
        Előbb csekkolj be az autóra.
        <div style={{ marginTop: 16 }}>
          <Link to="/beolvasas" className="btn auto" style={{ textDecoration: 'none', display: 'inline-flex' }}><Icon name="qr-code" />QR beolvasása</Link>
        </div>
      </div>
    )
  }

  return <>{children({ car: today.car, checkin: today.checkin, date: today.date })}</>
}
