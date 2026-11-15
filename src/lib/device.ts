// Készülék-felismerés: telefonon / tableten a külső appok (WhatsApp, Waze, Google Maps) közvetlenül,
// a saját sémájukkal indulnak — új böngészőlap nélkül.
const UA = () => (typeof navigator !== 'undefined' ? navigator.userAgent : '')
const TOUCH = () => (typeof navigator !== 'undefined' ? navigator.maxTouchPoints ?? 0 : 0)

// iPhone / iPad (az iPad „asztali” módban Macintosh-nak mondja magát, de érintőképernyős)
export function isIOS(ua: string = UA(), touchPoints: number = TOUCH()): boolean {
  return /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && touchPoints > 1)
}

// Telefon-e (Android / iPhone / iPad)
export function isPhone(ua: string = UA(), touchPoints: number = TOUCH()): boolean {
  return /Android/i.test(ua) || isIOS(ua, touchPoints)
}
