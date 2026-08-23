import { supabase } from './supabase'

const VAPID_PUBLIC = import.meta.env.VITE_VAPID_PUBLIC_KEY as string

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const arr = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i)
  return arr
}

export function pushSupported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
}

export async function isPushSubscribed(): Promise<boolean> {
  if (!pushSupported()) return false
  const reg = await navigator.serviceWorker.ready
  const sub = await reg.pushManager.getSubscription()
  return !!sub
}

export async function subscribePush(userId: string): Promise<void> {
  if (!pushSupported()) throw new Error('Az eszköz nem támogatja az értesítéseket')
  if (!VAPID_PUBLIC) throw new Error('Hiányzó VAPID kulcs')
  const perm = await Notification.requestPermission()
  if (perm !== 'granted') throw new Error('Az értesítés engedélyezése elutasítva')
  const reg = await navigator.serviceWorker.ready
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC) as BufferSource,
  })
  const json = sub.toJSON() as { keys?: { p256dh: string; auth: string } }
  const { error } = await supabase.from('push_subscriptions').upsert(
    { user_id: userId, endpoint: sub.endpoint, p256dh: json.keys!.p256dh, auth: json.keys!.auth },
    { onConflict: 'endpoint' },
  )
  if (error) {
    // Ha a szerver nem tud a feliratkozásról, sosem érkezne értesítés — ne mutassunk sikeres állapotot
    await sub.unsubscribe().catch(() => undefined)
    throw new Error(`A feliratkozás mentése nem sikerült: ${error.message}`)
  }
}

export async function unsubscribePush(): Promise<void> {
  if (!pushSupported()) return
  const reg = await navigator.serviceWorker.ready
  const sub = await reg.pushManager.getSubscription()
  if (sub) {
    await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
    await sub.unsubscribe()
  }
}

// Push küldése (a send-push edge function-ön keresztül)
export async function sendPush(userIds: string[], title: string, body: string, url = '/'): Promise<void> {
  if (userIds.length === 0) return
  try {
    await supabase.functions.invoke('send-push', { body: { user_ids: userIds, title, body, url } })
  } catch (e) {
    console.error('Push küldési hiba:', e)
  }
}
