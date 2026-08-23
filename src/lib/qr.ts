import QRCode from 'qrcode'

// Az autó QR tartalma: "alza-car:{qr_token}" — így egyértelmű, mit olvasunk.
export const CAR_QR_PREFIX = 'alza-car:'

export function carQrPayload(token: string): string {
  return CAR_QR_PREFIX + token
}

export function parseCarQr(text: string): string | null {
  const t = text.trim()
  if (t.startsWith(CAR_QR_PREFIX)) return t.slice(CAR_QR_PREFIX.length)
  // tűrjük a puszta tokent is
  if (/^[a-f0-9]{16,}$/i.test(t)) return t
  return null
}

export async function qrDataUrl(text: string): Promise<string> {
  return QRCode.toDataURL(text, { width: 512, margin: 1, errorCorrectionLevel: 'M' })
}
