import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { signedUrl, thumbPath } from '../lib/photos'

// Privát storage kép megjelenítése aláírt URL-lel.
// Először a kis bélyegképet ({id}_t.jpg) próbálja — ha nincs (régi fotó),
// a teljes képre vált. Ha a hívó már kötegelten aláírta az URL-t
// (signedUrls), src-ként átadhatja — ilyenkor nincs külön kérés képenként.
export default function PhotoThumb({ path, alt = '', src }: { path: string | null; alt?: string; src?: string }) {
  const [useFull, setUseFull] = useState(false)
  const want = path ? (useFull ? path : thumbPath(path)) : null
  const { data: fetched } = useQuery({
    queryKey: ['signed', want],
    enabled: !!want && src === undefined,
    staleTime: 50 * 60 * 1000,
    queryFn: () => signedUrl(want!),
  })
  const url = src ?? fetched
  if (!path) return <div className="thumb thumb-empty"><span className="tiny">nincs kép</span></div>
  if (!url) return <div className="thumb thumb-empty"><div className="spinner" style={{ width: 20, height: 20 }} /></div>
  return (
    <img
      src={url}
      alt={alt}
      className="thumb"
      loading="lazy"
      // A bélyegkép hiányzik (régi fotó) → teljes kép. Átadott src-nél nincs mit tenni.
      onError={() => { if (src === undefined && !useFull) setUseFull(true) }}
    />
  )
}
