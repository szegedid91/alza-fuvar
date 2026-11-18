import { useEffect, useState } from 'react'

// Keskeny (telefonos) képernyő-e: ahol egy hétoszlopos rács már olvashatatlan, ott listás elrendezés kell
export function useNarrow(maxWidth = 640): boolean {
  const query = `(max-width: ${maxWidth}px)`
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia(query).matches)
  useEffect(() => {
    if (!window.matchMedia) return
    const mq = window.matchMedia(query)
    const on = () => setNarrow(mq.matches)
    on()
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [query])
  return narrow
}
