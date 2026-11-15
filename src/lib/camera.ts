// A kamera-kép megnyitása EGY helyen. Élesben ez a telefon kamerája; a gépi tesztmódban
// (csak localhoston, fejlesztői szerveren) álkamera, hogy a fotós lépések telefon nélkül is végigmenjenek.
import { TEST_MODE, fakeCameraStream, getUseRealCamera } from './testMode'

export async function getCameraStream(constraints: MediaStreamConstraints): Promise<MediaStream> {
  if (import.meta.env.DEV && TEST_MODE) {
    if (!getUseRealCamera() || !navigator.mediaDevices?.getUserMedia) return fakeCameraStream()
    try { return await navigator.mediaDevices.getUserMedia(constraints) } catch { return fakeCameraStream() }
  }
  return navigator.mediaDevices.getUserMedia(constraints)
}
