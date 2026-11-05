#!/bin/sh
# AlzaBox-jegyzék napi frissítése — 1. lépés: egyszer használható jegy kérése a helyi kulccsal,
# és a böngészőben futtatandó gyűjtő kód kiírása (a jeggyel együtt).
# Használat: sh scripts/box-sync.sh   → a kimenetét kell az alza.hu fülön lefuttatni.
#            sh scripts/box-sync.sh log "szöveg"   → sikertelen futás naplózása
# A tartós kulcs (.env.local: BOX_SYNC_KEY) nem íródik ki, és nem kerül a weboldal kontextusába.
set -eu
cd "$(dirname "$0")/.."
EP="https://jmhqsfeqfghzxsyqjgjd.supabase.co/functions/v1/box-sync"
KEY=$(grep '^BOX_SYNC_KEY=' .env.local 2>/dev/null | head -1 | cut -d= -f2- | tr -d '\r\n' || true)
if [ -z "$KEY" ]; then echo "HIBA: nincs BOX_SYNC_KEY a .env.local fájlban" >&2; exit 1; fi
RESP=$(curl -sS -m 30 -X POST "$EP" -H 'content-type: application/json' -H "x-box-sync-key: $KEY" -d '{"action":"ticket"}')
TICKET=$(printf '%s' "$RESP" | sed -n 's/.*"ticket":"\([a-f0-9]\{32,\}\)".*/\1/p')
if [ -z "$TICKET" ]; then echo "HIBA: nem kaptam jegyet a szervertől: $RESP" >&2; exit 1; fi
# „log” mód: sikertelen futás jelzése az appnak (pl. az alza.hu ellenőrző oldalt mutatott)
#   sh scripts/box-sync.sh log "mi történt"
if [ "${1:-}" = "log" ]; then
  NOTE=$(printf '%s' "${2:-ismeretlen hiba}" | tr -d '"\\' | cut -c1-250)
  curl -sS -m 30 -X POST "$EP" -H 'content-type: application/json' -H "x-box-sync-ticket: $TICKET" -d "{\"action\":\"log\",\"note\":\"$NOTE\"}"
  echo
  exit 0
fi
sed "s/__TICKET__/$TICKET/" scripts/alza-box-crawl.js
