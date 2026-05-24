import type { DatenFile } from '@emdzej/ncsx-daten'

/**
 * Build the netto-slot array that NCSEXPER's IPO `Cod` handler reads
 * for `ZCS_SCHREIBEN` (and `ZCS_LOESCHEN`). Without this, the IPO's
 * `CDHGetApiJobData` loop sees an empty slot table, skips `C_S_AUFTRAG`
 * entirely, and the eventual `C_CHECKSUM` verify call goes out with a
 * malformed buffer → the ECU responds `8022A0…` (`A0` = "parameter
 * rejected by ECU") and `JOB_STATUS=ERROR_ECU_PARAMETER`.
 *
 * ## Architecture note — direct vs generic path
 *
 * This helper goes directly from `(gm, sa, vn)` strings → byte slots
 * without involving `buildFunctionList` / `flattenSlots`. That's
 * intentional: the ZCS layout (4-1-8-1-5-1 bytes for body+check) is a
 * fixed BMW convention shared by every ZCS-master ECU, not described
 * by per-FSW PARZUWEISUNG rows in a way the generic netto-flattener
 * can encode. The CABD's PARZUWEISUNG_DIR rows for the ZCS range
 * tag each nibble as a separate FSW (`GM_NIBBLE_HI` / `GM_NIBBLE_LO`
 * / etc.) — a generic encoder would need a custom path to fold
 * hex-string user input into those nibbles anyway, which is what
 * this file does.
 *
 * The generic path — `buildFunctionList(cabd, …)` →
 * `flattenSlots(functionList, netto, { codingOnly: true })` — is
 * what `processWriteCoding` uses for `SG_CODIEREN`. A future
 * refactor could re-express ZCS write as "build a 20-byte synthetic
 * netto, splice it at the ZCS base addr into a larger netto, run
 * the generic flattener filtered to the ZCS range". That'd give
 * symmetry across all write flows at the cost of one extra
 * indirection on every ZCS dispatch. For now we keep ZCS as a
 * narrow direct path; if "write only ECU sub-region X" lands as a
 * general feature later, the generic path is its right home.
 *
 * ## Layout (per CABD `CODIERDATENBLOCK.BEZEICHNUNG="ZCS"`)
 *
 * The CABD declares the ZCS region as a 20-byte block at a per-ECU
 * base address. The byte layout inside that block is dictated by the
 * `PARZUWEISUNG_DIR` rows that fall in the same range:
 *
 *   ```
 *   +-------+-------+--------------------+--------+
 *   | bytes | size  | content            | EINHEIT |
 *   +-------+-------+--------------------+--------+
 *   |  0-3  | 4 B   | GM body (hex)      | 'h'     |
 *   |   4   | 1 B   | GM check (ASCII)   | 'a'     |
 *   |  5-12 | 8 B   | SA body (hex)      | 'h'     |
 *   |  13   | 1 B   | SA check (ASCII)   | 'a'     |
 *   | 14-18 | 5 B   | VN body (hex)      | 'h'     |
 *   |  19   | 1 B   | VN check (ASCII)   | 'a'     |
 *   +-------+-------+--------------------+--------+
 *   ```
 *
 * Each "hex" byte holds two nibbles — high nibble = first hex char,
 * low nibble = second. So GM body `"61630000"` packs into bytes
 * `[0x61, 0x63, 0x00, 0x00]`. The check characters are stored as
 * raw ASCII bytes (e.g. `'P'` = `0x50`).
 *
 * The base address (`WORTADR`) varies per CABD. We pull it from the
 * `CODIERDATENBLOCK` row tagged `BEZEICHNUNG = "ZCS"` rather than
 * hardcoding it.
 *
 * ## Inputs
 *
 * `appliedGm` / `appliedSa` / `appliedVn` are the full body+check
 * strings from `formatGm` / `formatSa` / `formatVn` — 9 / 17 / 11
 * chars. Bodies are hex (case-insensitive); checks are single chars.
 */
export interface ZcsSlot {
  addr: number
  value: number
}

export type ZcsSlotBuildResult =
  | { ok: true; slots: ZcsSlot[]; zcsBase: number }
  | { ok: false; error: string }

/** Total byte layout of the ZCS block — sums to 20. */
const ZCS_LAYOUT = {
  gmBodyBytes: 4,
  gmCheckBytes: 1,
  saBodyBytes: 8,
  saCheckBytes: 1,
  vnBodyBytes: 5,
  vnCheckBytes: 1,
} as const
const ZCS_TOTAL_BYTES =
  ZCS_LAYOUT.gmBodyBytes +
  ZCS_LAYOUT.gmCheckBytes +
  ZCS_LAYOUT.saBodyBytes +
  ZCS_LAYOUT.saCheckBytes +
  ZCS_LAYOUT.vnBodyBytes +
  ZCS_LAYOUT.vnCheckBytes

/** Convert one hex digit ('0'–'9' / 'A'–'F' / 'a'–'f') to its 0..15 value. */
function hexNibble(c: string): number {
  const code = c.charCodeAt(0)
  if (code >= 0x30 && code <= 0x39) return code - 0x30
  if (code >= 0x41 && code <= 0x46) return code - 0x37
  if (code >= 0x61 && code <= 0x66) return code - 0x57
  throw new Error(`hexNibble: not a hex digit: ${JSON.stringify(c)}`)
}

/** Pack two hex chars into one byte (high nibble + low nibble). */
function packPair(hi: string, lo: string): number {
  return (hexNibble(hi) << 4) | hexNibble(lo)
}

/** Pack a hex string into a byte array. Length must be even. */
function packHexBody(hex: string, expectedBytes: number): number[] {
  if (hex.length !== expectedBytes * 2) {
    throw new Error(
      `packHexBody: expected ${expectedBytes * 2} hex chars, got ${hex.length} ("${hex}")`,
    )
  }
  const out: number[] = []
  for (let i = 0; i < hex.length; i += 2) {
    out.push(packPair(hex[i]!, hex[i + 1]!))
  }
  return out
}

/**
 * Find the CABD's `CODIERDATENBLOCK` row tagged as the ZCS region.
 * Returns the byte address (WORTADR) where the 20-byte ZCS block
 * begins, or null when the CABD has no ZCS block (FA-master ECUs
 * don't ship one).
 */
export function findZcsBaseAddr(cabd: DatenFile): number | null {
  for (const row of cabd.rowsInOrder) {
    if (row.block.name !== 'CODIERDATENBLOCK') continue
    if (row.values.BEZEICHNUNG !== 'ZCS') continue
    const wortadr = row.values.WORTADR
    const byteadr = row.values.BYTEADR
    if (typeof wortadr !== 'number') continue
    if (typeof byteadr === 'number' && byteadr !== ZCS_TOTAL_BYTES) {
      // The CABD declared a ZCS block of a different size — log-worthy
      // but not fatal; we still try the canonical layout. If the
      // builder produces wrong bytes the SGBD will reject at write
      // time and the user sees the error, which is more useful than
      // silently doing nothing.
    }
    return wortadr
  }
  return null
}

/**
 * Build the slot array for `ZCS_SCHREIBEN`. Caller must have already
 * computed the check digits (via `formatGm` / `formatSa` / `formatVn`
 * from `@emdzej/ncsx-identity`).
 */
export function buildZcsSlots(
  cabd: DatenFile,
  appliedGm: string,
  appliedSa: string,
  appliedVn: string,
): ZcsSlotBuildResult {
  const zcsBase = findZcsBaseAddr(cabd)
  if (zcsBase === null) {
    return {
      ok: false,
      error:
        'CABD has no CODIERDATENBLOCK with BEZEICHNUNG="ZCS" — this ECU has no ZCS region to write',
    }
  }
  const gm = appliedGm.toUpperCase()
  const sa = appliedSa.toUpperCase()
  const vn = appliedVn.toUpperCase()
  if (gm.length !== ZCS_LAYOUT.gmBodyBytes * 2 + 1) {
    return { ok: false, error: `GM must be 9 chars (body+check), got ${gm.length}` }
  }
  if (sa.length !== ZCS_LAYOUT.saBodyBytes * 2 + 1) {
    return { ok: false, error: `SA must be 17 chars (body+check), got ${sa.length}` }
  }
  if (vn.length !== ZCS_LAYOUT.vnBodyBytes * 2 + 1) {
    return { ok: false, error: `VN must be 11 chars (body+check), got ${vn.length}` }
  }

  let gmBytes: number[]
  let saBytes: number[]
  let vnBytes: number[]
  try {
    gmBytes = packHexBody(gm.slice(0, -1), ZCS_LAYOUT.gmBodyBytes)
    saBytes = packHexBody(sa.slice(0, -1), ZCS_LAYOUT.saBodyBytes)
    vnBytes = packHexBody(vn.slice(0, -1), ZCS_LAYOUT.vnBodyBytes)
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }

  // ASCII check chars — appended as raw bytes at the slot positions.
  // The CABD declares these as EINHEIT='a' (raw ASCII byte) with
  // MASKE=0xff, so the SGBD stores the char's code-point verbatim.
  const gmCheck = gm.charCodeAt(gm.length - 1)
  const saCheck = sa.charCodeAt(sa.length - 1)
  const vnCheck = vn.charCodeAt(vn.length - 1)

  // Assemble in document order so the resulting slot array reads
  // top-to-bottom as the ZCS region itself.
  const region: number[] = [
    ...gmBytes,
    gmCheck,
    ...saBytes,
    saCheck,
    ...vnBytes,
    vnCheck,
  ]
  if (region.length !== ZCS_TOTAL_BYTES) {
    return {
      ok: false,
      error: `internal: assembled ${region.length} bytes, expected ${ZCS_TOTAL_BYTES}`,
    }
  }

  const slots: ZcsSlot[] = region.map((value, offset) => ({
    addr: zcsBase + offset,
    value,
  }))
  return { ok: true, slots, zcsBase }
}
