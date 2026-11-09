import { APP_NAME } from './brand'
// A meghívó email szövege (tárgy + törzs) — ugyanez megy ki a szerverről (manage-invite) és
// a leveleződ-fallbackból (mailto), hogy a munkatárs mindkét esetben ugyanazt kapja.
export interface InviteMailInput {
  name: string | null // a meghívott neve
  inviter: string | null // aki meghív
  workspace: string | null
  link: string
  expiresAt: string | null // ISO
}

export const INVITE_MAIL_SUBJECT = `Meghívó az ${APP_NAME} appba`

export function inviteMailText(i: InviteMailInput): string {
  const until = i.expiresAt ? new Date(i.expiresAt).toLocaleDateString('hu-HU', { year: 'numeric', month: '2-digit', day: '2-digit' }) : null
  return [
    `Szia${i.name?.trim() ? ` ${i.name.trim()}` : ''}!`,
    '',
    `${i.inviter?.trim() || 'A vezetőd'} meghívott az ${APP_NAME} appba${i.workspace?.trim() ? ` (${i.workspace.trim()})` : ''}.`,
    'A regisztrációhoz nyisd meg ezt a linket a telefonodon:',
    i.link,
    '',
    'A linken a telefonszámodat és egy jelszót kell megadnod, utána már be is léphetsz.',
    until ? `A meghívó ${until}-ig érvényes.` : '',
    '',
    'Ha nem te vagy a címzett, hagyd figyelmen kívül ezt a levelet.',
  ].filter((l, idx, arr) => !(l === '' && arr[idx - 1] === '')).join('\n')
}

// mailto: link a leveleződhöz (ha az app maga nem tud emailt küldeni)
export function inviteMailto(to: string, i: InviteMailInput): string {
  return `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(INVITE_MAIL_SUBJECT)}&body=${encodeURIComponent(inviteMailText(i))}`
}
