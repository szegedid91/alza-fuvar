import { supabase } from './supabase'

const BUCKET = 'photos'

// SHA-256 hash a fotó-hitelességhez (hex string)
export async function sha256Hex(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer()
  const digest = await crypto.subtle.digest('SHA-256', buf)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

// Hitelesség-bizonyíték rögzítése: a feltöltött fotó hash-e + ki/mikor.
// Utólagos csere/manipuláció így kimutatható (admin Képek oldal ellenőrzi).
export async function recordPhotoProof(workspaceId: string, storagePath: string, blob: Blob): Promise<void> {
  const sha256 = await sha256Hex(blob)
  const { data: u } = await supabase.auth.getUser()
  const { error } = await supabase.from('photo_proofs').upsert(
    { workspace_id: workspaceId, storage_path: storagePath, sha256, user_id: u.user?.id ?? null },
    { onConflict: 'storage_path' },
  )
  if (error) throw error
}

// Feltölti a blobot a workspace-scoped útvonalra, visszaadja a storage path-t.
// path: {workspace_id}/{folder}/{id}.jpg
export async function uploadPhoto(
  workspaceId: string,
  folder: string,
  id: string,
  blob: Blob,
): Promise<string> {
  const path = `${workspaceId}/${folder}/${id}.jpg`
  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, {
    contentType: blob.type || 'image/jpeg',
    upsert: true,
  })
  if (error) throw error
  return path
}

// Aláírt URL a privát képhez (megjelenítéshez)
export async function signedUrl(path: string, expiresIn = 3600): Promise<string | null> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, expiresIn)
  if (error) {
    console.error('Aláírt URL hiba:', error.message)
    return null
  }
  return data.signedUrl
}

// Több path aláírt URL-je egyszerre
export async function signedUrls(paths: string[], expiresIn = 3600): Promise<Record<string, string>> {
  const valid = paths.filter(Boolean)
  if (valid.length === 0) return {}
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrls(valid, expiresIn)
  if (error) {
    console.error('Aláírt URL-ek hiba:', error.message)
    return {}
  }
  const map: Record<string, string> = {}
  for (const item of data ?? []) {
    if (item.signedUrl && item.path) map[item.path] = item.signedUrl
  }
  return map
}
