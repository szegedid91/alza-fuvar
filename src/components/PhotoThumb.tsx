import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { signedUrl, thumbPath, isVideoPath } from '../lib/photos'

// Privát storage kép megjelenítése aláírt URL-lel.
// Először a kis bélyegképet ({id}_t.jpg) próbálja — ha nincs (régi fotó),
// a teljes képre vált. Ha a hívó már kötegelten aláírta az URL-t
// (signedUrls), src-ként átadhatja — ilyenkor nincs külön kérés képenként.
export default function PhotoThumb({ path, alt = '', src }: { path: string | null; alt?: string; src?: string }) {
  const [useFull, setUseFull] = useState(false)
  const want = path ? (useFull ? path : thumbPath(path)) : null
  const { data: fetched, isSuccess } = useQuery({
    queryKey: ['signed', want],
    enabled: !!want && src === undefined,
    staleTime: 50 * 60 * 1000,
    queryFn: () => signedUrl(want!),
  })
  // Régi fotónál nincs bélyegkép: az aláírás null → azonnal a teljes képre
  // váltunk (az <img onError> csak akkor futna, ha lenne mit betölteni).
  // Videó: a bélyegkép a felvétel egy képkockája; ha nincs, a teljes fájl nem kép — jelölő csempe látszik
  const video = isVideoPath(path)
  const [imgFailed, setImgFailed] = useState(false)
  useEffect(() => {
    if (isSuccess && fetched === null && !useFull && src === undefined && !video) setUseFull(true)
  }, [isSuccess, fetched, useFull, src, video])
  const url = src ?? fetched
  if (!path) return <div className="thumb thumb-empty"><span className="tiny">nincs kép</span></div>
  if (video && (imgFailed || (src === undefined && isSuccess && fetched === null))) {
    return <div className="thumb thumb-empty"><span className="small" style={{ textAlign: 'center', fontWeight: 700 }}>▶ videó</span></div>
  }
  // A teljes kép sem írható alá (a fájlt a kép-megőrzés már törölte): ne pörögjön örökké
  if (useFull && isSuccess && fetched === null && src === undefined) {
    return <div className="thumb thumb-empty"><span className="tiny muted" style={{ textAlign: 'center', padding: 4 }}>a kép már törölve (megőrzési idő)</span></div>
  }
  if (!url) return <div className="thumb thumb-empty"><div className="spinner" style={{ width: 20, height: 20 }} /></div>
  const img = (
    <img
      src={url}
      alt={alt}
      className="thumb"
      loading="lazy"
      // A bélyegkép hiányzik (régi fotó) → teljes kép. Videónál és átadott src-nél jelölő csempe / nincs mit tenni.
      onError={() => { if (video) setImgFailed(true); else if (src === undefined && !useFull) setUseFull(true) }}
    />
  )
  if (!video) return img
  return (
    <div style={{ position: 'relative' }}>
      {img}
      <span className="tiny" style={{ position: 'absolute', left: 6, bottom: 6, background: 'rgba(0,0,0,0.7)', color: '#fff', borderRadius: 4, padding: '1px 6px', fontWeight: 700 }}>▶ videó</span>
    </div>
  )
}
