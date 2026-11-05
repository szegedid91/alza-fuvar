// A box-megálló fotóinak szabályai (Box-lap).
export const MAX_STOP_PHOTOS = 12 // ennyi új fotó készíthető egy megállóhoz egy menetben
export const AI_MAX_PHOTOS = 8 // ennyi (a legfrissebb) képet kap meg a kiolvasó — a szerver is ennyit fogad

// A kiolvasónak küldött képek: előbb a korábban feltöltöttek (időrendben), utánuk a most
// készültek — így ha több van a keretnél, a LEGFRISSEBBEK maradnak. Egy kép csak egyszer megy.
export function aiPhotoPaths(sessionPaths: string[], savedPaths: string[], max = AI_MAX_PHOTOS): string[] {
  const out: string[] = []
  for (const p of savedPaths) if (p && !sessionPaths.includes(p) && !out.includes(p)) out.push(p)
  for (const p of sessionPaths) if (p && !out.includes(p)) out.push(p)
  return out.slice(-max)
}

// Az új fotó helyének felirata (az első a kijelző, a többi sorszámot kap)
export function photoLabel(index: number): string {
  return index === 0 ? 'Kijelző' : `${index + 1}. fotó`
}
