import { useQuery } from '@tanstack/react-query'
import { signedUrl } from '../lib/photos'

// Privát storage kép megjelenítése aláírt URL-lel.
// Ha a hívó már kötegelten aláírta az URL-t (signedUrls), src-ként átadhatja —
// ilyenkor nincs külön kérés képenként.
export default function PhotoThumb({ path, alt = '', src }: { path: string | null; alt?: string; src?: string }) {
  const { data: fetched } = useQuery({
    queryKey: ['signed', path],
    enabled: !!path && src === undefined,
    staleTime: 50 * 60 * 1000,
    queryFn: () => signedUrl(path!),
  })
  const url = src ?? fetched
  if (!path) return <div className="thumb thumb-empty"><span className="tiny">nincs kép</span></div>
  if (!url) return <div className="thumb thumb-empty"><div className="spinner" style={{ width: 20, height: 20 }} /></div>
  return <img src={url} alt={alt} className="thumb" />
}
