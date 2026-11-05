// Riasztó hang + rezgés az appban, amíg le nem állítják.
// Három rövid, magas csipogás másfél másodpercenként (Web Audio), mellé rezgés (ahol a telefon
// engedi). A böngészők a hangot csak felhasználói érintés után indítják el — telepített appnál
// többnyire azonnal megy, különben az első érintésre szólal meg; a villogás addig is látszik.
export function startAlarm(): () => void {
  let stopped = false
  let ctx: AudioContext | null = null
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (AC) ctx = new AC()
  } catch { ctx = null }

  const beep = () => {
    if (!ctx || ctx.state !== 'running') return
    const t0 = ctx.currentTime
    for (let k = 0; k < 3; k++) {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'square'
      osc.frequency.value = k === 1 ? 1175 : 880
      const at = t0 + k * 0.26
      gain.gain.setValueAtTime(0.0001, at)
      gain.gain.exponentialRampToValueAtTime(0.5, at + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.2)
      osc.connect(gain); gain.connect(ctx.destination)
      osc.start(at); osc.stop(at + 0.22)
    }
  }
  const tick = () => {
    if (stopped) return
    if (ctx && ctx.state === 'suspended') void ctx.resume().catch(() => undefined)
    beep()
    // rezgés csak érintés után engedélyezett — előtte a böngésző tiltja (és minden próbálkozást naplóz)
    const touched = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation?.hasBeenActive ?? true
    if (touched) { try { navigator.vibrate?.([400, 150, 400, 150, 400]) } catch { /* nincs rezgés */ } }
  }
  // az első érintés feloldja a hangot, ha a böngésző addig némán tartotta
  const unlock = () => { if (ctx) void ctx.resume().then(beep).catch(() => undefined) }
  window.addEventListener('pointerdown', unlock)
  window.addEventListener('keydown', unlock)
  tick()
  const timer = window.setInterval(tick, 1500)

  return () => {
    stopped = true
    window.clearInterval(timer)
    window.removeEventListener('pointerdown', unlock)
    window.removeEventListener('keydown', unlock)
    try { navigator.vibrate?.(0) } catch { /* nincs rezgés */ }
    if (ctx) void ctx.close().catch(() => undefined)
  }
}
