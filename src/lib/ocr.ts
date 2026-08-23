import { supabase } from './supabase'

export interface OcrParsed {
  location?: string | null
  date?: string | null
  amount?: number | null
  liters?: number | null
}

export interface OcrResult {
  text: string
  parsed: OcrParsed
  error?: string
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

// Tankolós blokk OCR-je a Supabase Edge Function-ön keresztül.
export async function ocrFuelReceipt(blob: Blob): Promise<OcrResult> {
  try {
    const imageBase64 = await blobToBase64(blob)
    const { data, error } = await supabase.functions.invoke('ocr-fuel', { body: { imageBase64 } })
    if (error) return { text: '', parsed: {}, error: error.message }
    // Váratlan/üres válasz ne dobjon TypeError-t a hívóban
    const r = data as Partial<OcrResult> | null
    return { text: r?.text ?? '', parsed: r?.parsed ?? {}, error: r?.error }
  } catch (e) {
    return { text: '', parsed: {}, error: e instanceof Error ? e.message : 'OCR hiba' }
  }
}
