import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useWorkspace } from '../context/WorkspaceContext'
import { useToday } from '../hooks/useToday'
import { useCars } from '../hooks/useCars'
import { useCarCategories } from '../hooks/useCarCategories'
import { groupByCategory } from '../lib/calendar'
import { submitNow } from '../lib/outbox'
import { resolveNames } from '../lib/names'
import { carIssueStatusLabel, formatDateTime, isCrewRole, todayISO } from '../lib/labels'
import PhotoSlot, { type CapturedPhoto } from '../components/PhotoSlot'
import PhotoThumb from '../components/PhotoThumb'
import ConfirmButton from '../components/ConfirmButton'
import Icon from '../components/Icon'
import { toast } from '../lib/toast'
import type { Enums, Tables } from '../lib/database.types'

type Issue = Tables<'car_issues'>

export default function CarIssues() {
  const { profile } = useAuth()
  const { currentWorkspaceId, currentWorkspace } = useWorkspace()
  const { data: today } = useToday()
  const qc = useQueryClient()
  const isCrew = isCrewRole(profile?.role)
  const isManagerOrAdmin = profile?.role === 'manager' || profile?.role === 'admin'

  const [carId, setCarId] = useState('')
  // Vezetői lista-szűrő: alapból a még nem megoldott hibák
  const [statusFilter, setStatusFilter] = useState<'active' | 'resolved' | 'all'>('active')
  const [note, setNote] = useState('')
  const [photo, setPhoto] = useState<CapturedPhoto | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const { data: cars } = useCars()
  const { data: categories } = useCarCategories()

  const { data: issues } = useQuery({
    queryKey: ['car-issues', currentWorkspaceId, profile?.id, todayISO()],
    enabled: !!currentWorkspaceId,
    queryFn: async () => {
      const { data } = await supabase
        .from('car_issues')
        .select('*, car:cars(plate)')
        .eq('workspace_id', currentWorkspaceId!)
        .order('created_at', { ascending: false })
        .limit(40)
      const rows = (data ?? []) as unknown as (Issue & { car: { plate: string } | null })[]
      const names = await resolveNames(rows.map((r) => r.user_id))
      return rows.map((r) => ({ ...r, _name: names[r.user_id] ?? null }))
    },
  })

  const setStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: Enums<'car_issue_status'> }) => {
      const { error } = await supabase.from('car_issues').update({
        status,
        resolved_by: status === 'resolved' ? profile!.id : null,
        resolved_at: status === 'resolved' ? new Date().toISOString() : null,
      }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['car-issues'] }),
    onError: (e) => setMsg('Hiba: az állapot mentése nem sikerült — ' + (e instanceof Error ? e.message : 'ismeretlen hiba')),
  })

  // Alapértelmezett autó: amire ma be van csekkolva
  const effectiveCarId = carId || today?.car?.id || ''
  // Ha MÁSIK autóra jelent hibát, mint amin ma ül, rákérdezünk — a gyakori
  // tévesztés az, hogy a tegnapi/másik autó marad kiválasztva
  const otherCar = !!today?.car && !!effectiveCarId && effectiveCarId !== today.car.id
  const otherPlate = otherCar ? (cars?.find((c) => c.id === effectiveCarId)?.plate ?? '?') : ''

  async function submit() {
    if (!currentWorkspaceId || !profile || !effectiveCarId || !note.trim()) return
    setBusy(true); setMsg(null)
    try {
      const id = crypto.randomUUID()
      await submitNow({
        id, table: 'car_issues', op: 'insert', label: 'Autó-hiba bejelentés',
        values: {
          id, workspace_id: currentWorkspaceId, car_id: effectiveCarId,
          user_id: profile.id, note: note.trim(),
        },
        ...(photo ? { photo: { workspaceId: currentWorkspaceId, folder: 'issues', id, column: 'photo_path', blob: photo.blob } } : {}),
      })
      // a választó visszaáll a mai autóra — a következő bejelentés ne a másik autón ragadjon
      setNote(''); setPhoto(null); setCarId(''); toast.success('Hiba bejelentve — a menedzser látja és követi.')
      await qc.invalidateQueries({ queryKey: ['car-issues'] })
    } catch (e) {
      setMsg('Hiba: ' + (e instanceof Error ? e.message : 'ismeretlen'))
    } finally {
      setBusy(false)
    }
  }

  const statusBadge = (s: Enums<'car_issue_status'>) =>
    s === 'open' ? 'danger' : s === 'in_progress' ? 'warning' : 'success'
  const statusColor = (s: Enums<'car_issue_status'>) =>
    s === 'open' ? 'var(--danger)' : s === 'in_progress' ? 'var(--warning)' : undefined

  const activeCount = (issues ?? []).filter((i) => i.status !== 'resolved').length
  const resolvedCount = (issues ?? []).length - activeCount
  // Crew csak a sajátját (mai) látja — ott nincs szűrő; vezetőnél a nyitottak elöl
  const shown = !isManagerOrAdmin ? (issues ?? []) : (issues ?? [])
    .filter((i) => statusFilter === 'all' ? true : statusFilter === 'resolved' ? i.status === 'resolved' : i.status !== 'resolved')
    .slice()
    .sort((a, b) => (a.status === 'resolved' ? 1 : 0) - (b.status === 'resolved' ? 1 : 0))

  return (
    <div className="stack">
      <h2>Autó-hibák — {currentWorkspace?.name}</h2>

      {isCrew && (
        <div className="card stack primary">
          <div className="card-title" style={{ margin: 0 }}><Icon name="wrench" />Hiba bejelentése</div>
          <p className="tiny muted" style={{ margin: 0 }}>A menedzser azonnal látja, és követi a javítást — a fotó segít, de nem kötelező.</p>
          <div className="field">
            <label>Autó</label>
            <select className="select" value={effectiveCarId} onChange={(e) => setCarId(e.target.value)}>
              <option value="">— válassz —</option>
              {groupByCategory(cars ?? [], categories).map((g) => (
                <optgroup key={g.name} label={g.name}>
                  {g.cars.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.plate}{c.label ? ` · ${c.label}` : ''}{today?.car?.id === c.id ? ' — mai autóm' : ''}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            {!today?.car && <div className="tiny muted" style={{ marginTop: 4 }}>Nincs mai becsekkolás — válaszd ki, melyik autóról van szó.</div>}
          </div>
          <div className="field">
            <label>Mi a probléma? *</label>
            <textarea className="textarea" value={note} onChange={(e) => setNote(e.target.value)}
              placeholder="pl. bal első gumi ereszt, fék nyikorog…" />
          </div>
          <div className="field">
            <label>Fotó (opcionális)</label>
            <div style={{ width: 160 }}>
              <PhotoSlot label="Fotó készítése" photo={photo} onCapture={setPhoto} />
            </div>
          </div>
          {msg && <div className={`alert ${msg.startsWith('Hiba:') ? 'error' : 'success'}`}>{msg}</div>}
          {otherCar && (
            <div className="alert error" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span>
                Ma a(z) <strong>{today!.car!.plate}</strong> autót használod, de a hibát a(z) <strong>{otherPlate}</strong> autóra adod le.
                Biztos arra jelented?
              </span>
              <button className="btn ghost sm" type="button" onClick={() => setCarId(today!.car!.id)}>
                ← Inkább a mai autómra ({today!.car!.plate})
              </button>
            </div>
          )}
          {otherCar ? (
            <ConfirmButton
              className="btn"
              confirmLabel={`Igen, a(z) ${otherPlate} autóra jelentem`}
              disabled={!effectiveCarId || !note.trim() || busy}
              onConfirm={() => void submit()}
            >
              {busy ? 'Mentés…' : 'Bejelentés másik autóra'}
            </ConfirmButton>
          ) : (
            <button className="btn" disabled={!effectiveCarId || !note.trim() || busy} onClick={() => void submit()}>
              <Icon name="send" />{busy ? 'Mentés…' : 'Bejelentés'}
            </button>
          )}
          {(!effectiveCarId || !note.trim()) && !busy && (
            <div className="tiny muted" style={{ textAlign: 'center' }}>
              {!effectiveCarId ? 'Előbb válaszd ki az autót.' : 'Írd le röviden a problémát.'}
            </div>
          )}
        </div>
      )}

      <div className="between">
        <div className="card-title" style={{ margin: 0 }}>
          <Icon name="wrench" />{isCrew && !isManagerOrAdmin ? 'Mai bejelentéseim' : 'Bejelentések'}
        </div>
        {isCrew && !isManagerOrAdmin && (
          <span className="tiny muted">Csak a mai saját bejelentéseid</span>
        )}
      </div>

      {isManagerOrAdmin && (issues?.length ?? 0) > 0 && (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          {([['active', `Nyitott · ${activeCount}`], ['resolved', `Megoldva · ${resolvedCount}`], ['all', `Mind · ${issues!.length}`]] as const).map(([key, label]) => (
            <button key={key} type="button" className={`badge ${statusFilter === key ? 'primary' : ''}`}
              style={{ cursor: 'pointer', font: 'inherit', fontSize: 12, fontWeight: 700, minHeight: 32 }}
              onClick={() => setStatusFilter(key)}>{label}</button>
          ))}
        </div>
      )}

      {shown.length === 0 && (
        <div className="empty">
          <span className="ico"><Icon name={statusFilter === 'active' && isManagerOrAdmin ? 'check-circle' : 'wrench'} size={40} /></span>
          {isCrew && !isManagerOrAdmin
            ? 'Ma még nem jelentettél be hibát.'
            : statusFilter === 'active' ? 'Nincs nyitott hiba — minden rendben.' : 'Nincs bejelentett hiba.'}
        </div>
      )}

      {shown.map((i) => (
        <div key={i.id} className="card stack" style={{ borderColor: statusColor(i.status) }}>
          <div className="between">
            <div className="row" style={{ gap: 8 }}>
              <span className="badge num">{i.car?.plate ?? '?'}</span>
              <span className={`badge ${statusBadge(i.status)}`}>{carIssueStatusLabel[i.status]}</span>
            </div>
            <span className="tiny muted">{formatDateTime(i.created_at)}</span>
          </div>
          <div className="small">{i.note}</div>
          <div className="tiny muted">Bejelentette: {i._name ?? 'Ismeretlen'}</div>
          {i.photo_path && <div style={{ maxWidth: 120 }}><PhotoThumb path={i.photo_path} /></div>}
          {isManagerOrAdmin && i.status !== 'resolved' && (
            <div className="btn-grid">
              {i.status === 'open' && (
                <button className="btn secondary sm" disabled={setStatus.isPending}
                  onClick={() => setStatus.mutate({ id: i.id, status: 'in_progress' })}>Folyamatban</button>
              )}
              <button className="btn sm" disabled={setStatus.isPending}
                onClick={() => setStatus.mutate({ id: i.id, status: 'resolved' })}><Icon name="check" />Megoldva</button>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
