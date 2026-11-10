// Munkatársi megjegyzések egy AlzaBoxhoz, vezetői jóváhagyással.
// A box „hol található” leírása az alza.hu-ról jön, a vezető saját megjegyzése a box adatlapján van;
// ez a harmadik réteg: amit a futárok tesznek hozzá a helyszínen szerzett tapasztalatból.
export type BoxNoteStatus = 'pending' | 'approved' | 'rejected'
export interface BoxNote { id: string; box_id: string; text: string; status: BoxNoteStatus; created_by: string; created_at: string; reviewed_at: string | null }

export const BOX_NOTE_MIN = 2
export const BOX_NOTE_MAX = 500

// A beírt szöveg tisztítva; null, ha nem küldhető be
export function cleanBoxNote(input: string): string | null {
  const t = input.replace(/\s+/g, ' ').trim()
  if (t.length < BOX_NOTE_MIN) return null
  return t.slice(0, BOX_NOTE_MAX)
}

// Mit lát a kártyán egy adott felhasználó: a jóváhagyottakat mindenki; a függőket a beküldő és a vezető;
// az elutasítottat csak a beküldő (hogy tudja, nem ment át)
export function visibleBoxNotes(notes: BoxNote[], me: string | null, isManager: boolean): { approved: BoxNote[]; pending: BoxNote[]; rejectedMine: BoxNote[] } {
  const byTime = [...notes].sort((a, b) => a.created_at.localeCompare(b.created_at))
  return {
    approved: byTime.filter((n) => n.status === 'approved'),
    pending: byTime.filter((n) => n.status === 'pending' && (isManager || n.created_by === me)),
    rejectedMine: byTime.filter((n) => n.status === 'rejected' && n.created_by === me),
  }
}
