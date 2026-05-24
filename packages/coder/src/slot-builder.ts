import { encodeField, type CabdRule, type Einheit, type Operation } from '@emdzej/ncsx-cabd'
import type {
  FunctionItem,
  FunctionList,
  FunctionListItem,
  PropertyItem,
} from '@emdzej/ncsx-function-list'

/**
 * Generic FSW-value → slot-table primitive.
 *
 * The shared abstraction that underpins every write flow we care
 * about:
 *
 *   - `FGNR_SCHREIBEN` — set `FAHRGESTELL_NR[1..18]` to the chars of
 *     `formatFahrgestellNr(vin)`, build slots for the 5-byte
 *     Fahrgestell_Nr block (or whatever subset the CABD maps).
 *   - `FA_WRITE`       — set the FA-coded FSWs from a tokenised FA
 *     string (each FA token → one or more FSW-value pairs).
 *   - `ZCS_SCHREIBEN`  — could be re-implemented here (currently
 *     uses its own zcs-slots.ts; ZCS's fixed 4-1-8-1-5-1 layout
 *     doesn't really benefit from the generic path).
 *   - Apply defaults   — feed `ANLIEFERZUSTAND` bytes through the
 *     CABD's inverse-encoding to recover the canonical FSW values,
 *     then run them through this same primitive.
 *   - .ncsxpatch apply — map each patch entry to its FSW value.
 *
 * Inputs are FSW keywords (e.g. `"FAHRGESTELL_NR[11]"`,
 * `"SCHEINWERFER_RA"`) mapped to values. The primitive handles
 * type-coercion based on each FSW's EINHEIT and the encoding
 * pipeline via `@emdzej/ncsx-cabd`'s `encodeField`.
 *
 * Output is the netto byte buffer with the encoded values plus a
 * slot-table summarising which addresses were touched — caller
 * passes those into `cabi.setNettoSlots()` before
 * `runCabimain("FGNR_SCHREIBEN")` (or any other write job).
 */

/** A single netto-slot — what `CabiProvider.setNettoSlots()` consumes. */
export interface NettoSlot {
  addr: number
  value: number
}

export interface BuildSlotsOptions {
  /**
   * FSW keyword → value to write. Value type depends on the FSW's
   * underlying shape:
   *   - `PropertyItem` (EINHEIT='a' / 'h' / 'A' / 'd' / 'b'): pass a
   *     string. For 'a' (ASCII byte) the string should be exactly
   *     1 char; we forward `charCodeAt(0)`. For 'h' / 'A' / 'd' /
   *     'b' the string is parsed numerically.
   *   - `FunctionItem` (enumerated PSWs): pass the PSW keyword
   *     (e.g. `"aktiv"`); we look up its `Parameter.data` and OR
   *     the bytes into the netto.
   *
   * Numbers may also be passed directly; they're used as-is via
   * `encodeField`'s numeric input.
   */
  values: ReadonlyMap<string, string | number>

  /**
   * Starting netto buffer. Typical source: a fresh
   * `CODIERDATEN_LESEN` of the ECU, so unchanged bytes round-trip
   * to the same on-wire values. When omitted, starts from a
   * zero-filled buffer sized to the CABD's coding region.
   */
  initialNetto?: Uint8Array
}

export interface BuildSlotsResult {
  /** Slot list to feed into `setNettoSlots`. Sorted by address. */
  slots: NettoSlot[]
  /** The full netto (mutated). Useful for diagnostics + diff display. */
  netto: Uint8Array
  /** Which keywords landed cleanly, with the addresses they touched. */
  applied: Array<{ keyword: string; addresses: number[] }>
  /** Which keywords couldn't be encoded, with the reason. */
  skipped: Array<{ keyword: string; reason: string }>
}

/**
 * Build slots from a FunctionList + a map of FSW-keyword → value.
 *
 * The FunctionList comes from `buildFunctionList(cabd, …)` in
 * `@emdzej/ncsx-function-list`. We need it (not just the raw CABD)
 * because:
 *   - It pre-resolves FSW IDs → keyword strings via SWT.
 *   - It unifies `PARZUWEISUNG_FSW` and `PARZUWEISUNG_DIR` into one
 *     iterable list — the caller doesn't have to know which block
 *     a given FSW lives in.
 *   - It pre-parses OPERATION/EINHEIT/MASKE for the cabd-encoder
 *     consumption.
 */
export function buildSlotsFromValues(
  functionList: FunctionList,
  opts: BuildSlotsOptions,
): BuildSlotsResult {
  const byKeyword = indexItemsByKeyword(functionList)
  const nettoSize = computeNettoSize(functionList)
  const netto =
    opts.initialNetto && opts.initialNetto.length >= nettoSize
      ? Uint8Array.from(opts.initialNetto)
      : padTo(opts.initialNetto, nettoSize)

  const touchedAddrs = new Set<number>()
  const applied: BuildSlotsResult['applied'] = []
  const skipped: BuildSlotsResult['skipped'] = []

  for (const [keyword, value] of opts.values) {
    const item = byKeyword.get(keyword)
    if (!item) {
      skipped.push({ keyword, reason: `FSW keyword not in CABD` })
      continue
    }
    try {
      const addresses = applyOne(item, value, netto)
      for (const addr of addresses) touchedAddrs.add(addr)
      applied.push({ keyword, addresses })
    } catch (err) {
      skipped.push({
        keyword,
        reason: err instanceof Error ? err.message : String(err),
      })
    }
  }

  const slots: NettoSlot[] = [...touchedAddrs]
    .sort((a, b) => a - b)
    .map((addr) => ({ addr, value: netto[addr]! }))

  return { slots, netto, applied, skipped }
}

// ──────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────

function indexItemsByKeyword(list: FunctionList): Map<string, PropertyItem | FunctionItem> {
  const out = new Map<string, PropertyItem | FunctionItem>()
  for (const item of list.items) {
    if (item.kind === 'property' || item.kind === 'function') {
      if (item.fswKeyword) out.set(item.fswKeyword, item)
    }
  }
  return out
}

/**
 * Apply a single (keyword, value) edit into the netto. Returns the
 * list of addresses touched (so the caller can dedupe across edits
 * that target overlapping bytes — e.g. high/low nibbles of the same
 * byte).
 */
function applyOne(
  item: PropertyItem | FunctionItem,
  value: string | number,
  netto: Uint8Array,
): number[] {
  if (item.kind === 'property') {
    return applyProperty(item, value, netto)
  }
  return applyFunction(item, value, netto)
}

function applyProperty(item: PropertyItem, value: string | number, netto: Uint8Array): number[] {
  const numeric = coercePropertyValue(value, item.unit)
  const rule = propertyToRule(item)
  encodeField(rule, numeric, netto)
  return range(item.address, item.length)
}

function applyFunction(item: FunctionItem, value: string | number, netto: Uint8Array): number[] {
  if (typeof value !== 'string') {
    throw new Error(
      `FunctionItem "${item.fswKeyword}" expects a PSW keyword string, got ${typeof value}`,
    )
  }
  const param = item.parameters.find((p) => p.pswKeyword === value)
  if (!param) {
    const known = item.parameters.map((p) => p.pswKeyword).filter(Boolean).join(', ') || '(none)'
    throw new Error(
      `unknown PSW "${value}" for FSW "${item.fswKeyword}" — known PSWs: ${known}`,
    )
  }
  // The Parameter.data bytes are already MASKE-aligned for the
  // FSW's slot — OR them into the netto positions covered by the
  // item's mask. Same semantics as encodeField's final write step.
  for (let i = 0; i < item.length; i++) {
    const mask = item.mask[i]! & 0xff
    const src = param.data[i] ?? 0
    netto[item.address + i] = (netto[item.address + i]! & ~mask) | (src & mask)
  }
  return range(item.address, item.length)
}

/**
 * Coerce a user-supplied value (`string | number`) into the numeric
 * form `encodeField` expects, based on the item's EINHEIT.
 *
 *   - `'a'` ASCII byte: 1-char string → `charCodeAt(0)`. Numeric
 *     input also accepted (already a code-point).
 *   - `'h'` raw hex byte / `'A'` hex digit / `'d'` decimal:
 *     `parseInt` for strings.
 *   - `'b'` binary string: passed through as `parseInt(s, 2)`.
 *
 * Anything not recognisable throws — caller's `skipped` list
 * surfaces the issue.
 */
function coercePropertyValue(value: string | number, unit: string): number {
  if (typeof value === 'number') return value >>> 0
  const s = value.trim()
  switch (unit) {
    case 'a':
      if (s.length !== 1) {
        throw new Error(`EINHEIT='a' expects a 1-char string, got "${s}"`)
      }
      return s.charCodeAt(0) & 0xff
    case 'h':
      return Number.parseInt(s, 16) >>> 0
    case 'A':
      // Single hex digit → nibble value. encodeField's autoShift handles the placement.
      if (s.length !== 1) {
        throw new Error(`EINHEIT='A' expects a 1-char hex digit, got "${s}"`)
      }
      return Number.parseInt(s, 16) & 0xf
    case 'd':
      return Number.parseInt(s, 10) >>> 0
    case 'b':
      return Number.parseInt(s, 2) >>> 0
    default:
      throw new Error(`unsupported EINHEIT="${unit}"`)
  }
}

/**
 * Convert a FunctionList PropertyItem (the "rich tree" form) back
 * into a CabdRule (the "encodeField input" form). The two carry the
 * same information; the function-list builder already parsed the
 * raw bytes into structured fields, but encodeField wants the
 * Operation[] decoded from the per-op 5-byte Uint8Array entries.
 */
function propertyToRule(item: PropertyItem): CabdRule {
  const operations: Operation[] = []
  for (const opBytes of item.operations) {
    const opChar = String.fromCharCode(opBytes[0] ?? 0)
    if (opChar === '!') {
      operations.push({ op: '!' })
      continue
    }
    if (isOperandOp(opChar)) {
      // u32 LE at bytes[1..5]
      const operand =
        (opBytes[1] ?? 0) |
        ((opBytes[2] ?? 0) << 8) |
        ((opBytes[3] ?? 0) << 16) |
        ((opBytes[4] ?? 0) << 24)
      operations.push({ op: opChar, operand: operand >>> 0 })
    }
    // Unknown op-chars silently skipped — encodeField would also
    // ignore them. Real-world CABDs only use the canonical set.
  }
  return {
    wortadr: item.address,
    byteadr: item.length,
    maske: Array.from(item.mask),
    einheit: (item.unit as Einheit) || 'h',
    operations,
  }
}

function isOperandOp(c: string): c is '&' | '*' | '+' | '-' | '/' | '>' | '^' | '|' {
  return c === '&' || c === '*' || c === '+' || c === '-' || c === '/' || c === '>' || c === '^' || c === '|'
}

/**
 * Find the smallest power-of-two netto size that fits every item's
 * `address + length`. Mirrors `computeNettoSize` in `rule.ts` but
 * operates over the FunctionList instead of a single block.
 */
function computeNettoSize(list: FunctionList): number {
  let max = 0
  for (const item of list.items) {
    if (!hasAddress(item)) continue
    const end = item.address + item.length
    if (end > max) max = end
  }
  return max
}

function hasAddress(item: FunctionListItem): item is PropertyItem | FunctionItem {
  return item.kind === 'property' || item.kind === 'function'
}

function range(start: number, length: number): number[] {
  const out: number[] = []
  for (let i = 0; i < length; i++) out.push(start + i)
  return out
}

function padTo(src: Uint8Array | undefined, minSize: number): Uint8Array {
  const out = new Uint8Array(Math.max(minSize, src?.length ?? 0))
  if (src) out.set(src)
  return out
}
