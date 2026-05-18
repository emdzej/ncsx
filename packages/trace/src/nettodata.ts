import { TraceError, type TraceOverlay, type TraceOverlayItem } from './types.js';

/**
 * One parsed entry from a Nettodata trace. `blockAddress` is the packed
 * `(block << 8) + (isWord ? addr/2 : addr)` value emitted by NCSEXPER; reverse it via
 * `unpackBlockAddress` if you need the raw `(block, address)` pair.
 */
export interface NettodataEntry {
  blockAddress: number;
  mask: number;
  data: number;
  isWord: boolean;
}

const RECORD_RE =
  /^(?<type>B|M) (?<addr>[0-9A-Fa-f]{8}),(?<len>[0-9A-Fa-f]{4}),(?<data>(?:[0-9A-Fa-f]{2}(?:,[0-9A-Fa-f]{2}){0,15}|[0-9A-Fa-f]{4}(?:,[0-9A-Fa-f]{4}){0,7}))$/;

/**
 * Parse a `NETTODAT.TRC` / `NETTODAT.MAN` text into a flat list of `NettodataEntry`s.
 *
 * `B` records expand into N consecutive entries with `mask=0xFF/0xFFFF`. `M` records
 * carry one entry with their explicit mask. Lines are validated with NCS Dummy's regex
 * grammar (`Classes/FswPswNettodatas/FswPswNettodataListReader.cs:105-117`).
 *
 * Detects byte vs word mode from the first record's data-token width. Subsequent records
 * must match (mixing 2-hex and 4-hex tokens within one file is a hard error).
 */
export function parseNettodataTrace(text: string): NettodataEntry[] {
  const entries: NettodataEntry[] = [];
  let isWord: boolean | undefined;

  for (const rawLine of text.split(/\r?\n/)) {
    if (rawLine.trim() === '') continue;
    const m = RECORD_RE.exec(rawLine);
    if (!m) {
      throw new TraceError(`malformed Nettodata line: ${JSON.stringify(rawLine)}`);
    }
    const type = m.groups!['type'] as 'B' | 'M';
    const blockAddress = Number.parseInt(m.groups!['addr']!, 16);
    const count = Number.parseInt(m.groups!['len']!, 16);
    const tokens = m.groups!['data']!.split(',');

    const lineIsWord = (tokens[0]!.length === 4);
    if (isWord === undefined) isWord = lineIsWord;
    if (lineIsWord !== isWord) {
      throw new TraceError('Nettodata trace mixes byte and word records');
    }

    if (type === 'B') {
      if (tokens.length !== count) {
        throw new TraceError(`B record length ${count} ≠ ${tokens.length} tokens`);
      }
      const fullMask = isWord ? 0xffff : 0xff;
      for (let i = 0; i < tokens.length; i++) {
        entries.push({
          blockAddress: blockAddress + i,
          mask: fullMask,
          data: Number.parseInt(tokens[i]!, 16),
          isWord,
        });
      }
    } else {
      // M: pairs of (mask, data); count is number of (mask, data) pairs.
      if (tokens.length !== count * 2) {
        throw new TraceError(`M record length ${count} ≠ ${tokens.length / 2} pairs`);
      }
      for (let i = 0; i < tokens.length; i += 2) {
        entries.push({
          blockAddress: blockAddress + i / 2,
          mask: Number.parseInt(tokens[i]!, 16),
          data: Number.parseInt(tokens[i + 1]!, 16),
          isWord,
        });
      }
    }
  }

  return entries;
}

/**
 * Apply Nettodata entries onto an overlay. For each function / property / unoccupied
 * item, extract the bytes covering `(block, address, length)` under the item's mask. If
 * those bytes match a known PSW for a function, select it; otherwise stash them in
 * `custom` (or `data` for property / unoccupied).
 *
 * Strict mode throws on any address that doesn't fit a catalog item. Default is lenient
 * (matches NCS Dummy's `strictNettodataTraceFileReading=false`).
 */
export function applyNettodataTrace(
  overlay: TraceOverlay,
  entries: NettodataEntry[],
  options: { strict?: boolean } = {},
): TraceOverlay {
  const strict = options.strict ?? false;
  const isWord = overlay.isWord;
  if (entries.length > 0 && entries[0]!.isWord !== isWord) {
    throw new TraceError(
      `Nettodata trace is ${entries[0]!.isWord ? 'word' : 'byte'} mode but module expects ${isWord ? 'word' : 'byte'} mode`,
    );
  }

  // Index: blockAddress -> entry. Multiple entries for the same address would be a parse
  // error (we don't merge here); for lookup purposes we keep the first.
  const byAddr = new Map<number, NettodataEntry>();
  for (const e of entries) {
    if (!byAddr.has(e.blockAddress)) byAddr.set(e.blockAddress, e);
  }

  const resolved = new Set<number>();

  for (const item of overlay.items) {
    if (item.kind === 'group' || item.kind === 'unresolved') continue;

    const bytes = extractBytes(item, byAddr, resolved, isWord);
    if (!bytes) continue;

    if (item.kind === 'function') {
      const match = item.parameters.find((p) => bytesEqual(p.data, bytes));
      if (match) {
        match.selected = true;
      } else {
        item.custom = bytes;
      }
    } else if (item.kind === 'property') {
      item.data = bytes;
    } else if (item.kind === 'unoccupied') {
      item.data = bytes;
    }
  }

  if (strict) {
    for (const e of entries) {
      if (!resolved.has(e.blockAddress)) {
        throw new TraceError(
          `Nettodata entry at blockAddress 0x${e.blockAddress.toString(16)} is not covered by any catalog item`,
        );
      }
    }
  }

  return overlay;
}

function extractBytes(
  item: Exclude<TraceOverlayItem, { kind: 'group' } | { kind: 'unresolved' }>,
  byAddr: Map<number, NettodataEntry>,
  resolved: Set<number>,
  isWord: boolean,
): Uint8Array | null {
  const out = new Uint8Array(item.length);
  let anyResolved = false;
  for (let i = 0; i < item.length; i++) {
    const byteAddr = item.address + i;
    const blockAddr = (item.block << 8) + (isWord ? Math.floor(byteAddr / 2) : byteAddr);
    const entry = byAddr.get(blockAddr);
    const maskByte = item.mask[i % item.mask.length]!;
    if (!entry) {
      // No data at this address: bail out unless we'd just have all-zero, which we treat
      // as "not present" (matches NCS Dummy's behaviour for empty `GetBytes` returns).
      if (i === 0) return null;
      // Partial coverage — keep what we have, zero the rest. NCS Dummy treats this as an
      // error; we use zero-fill so the UI can still render.
      continue;
    }
    if (isWord) {
      // Even byteAddr = high byte of the word, odd = low byte. (NCS Dummy's `lowByte =
      // address % 2 != 0`.)
      const isLow = (byteAddr & 1) !== 0;
      const fullByte = isLow ? entry.data & 0xff : (entry.data >> 8) & 0xff;
      out[i] = fullByte & maskByte;
    } else {
      out[i] = entry.data & maskByte;
    }
    resolved.add(blockAddr);
    anyResolved = true;
  }
  return anyResolved ? out : null;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Inverse of NCSEXPER's `BlockAddress` packing — gives back `(block, byteAddress)`. */
export function unpackBlockAddress(
  blockAddress: number,
  isWord: boolean,
): { block: number; address: number } {
  const block = blockAddress >>> 8;
  const lower = blockAddress & 0xff;
  return { block, address: isWord ? lower * 2 : lower };
}

interface AccumEntry {
  data: number;
  mask: number;
}

/**
 * Serialise an overlay to Nettodata text. Algorithm mirrors NCS Dummy's
 * `NettodataTraceFunctionListWriter.WriteList` (see `docs/ncsdummy-analysis.md` §2.2):
 *
 *   1. Walk every item; for each "checked" / data-bearing one, AND its bytes with the
 *      mask and accumulate into a `blockAddress → {data, mask}` map.
 *   2. Sort by blockAddress.
 *   3. Coalesce fully-masked consecutive runs into `B` records (max 16 byte / 8 word);
 *      anything with a partial mask emits one `M` record on its own.
 */
export function writeNettodataTrace(overlay: TraceOverlay): string {
  const isWord = overlay.isWord;
  const accum = new Map<number, AccumEntry>();

  const merge = (blockAddress: number, data: number, mask: number): void => {
    const existing = accum.get(blockAddress);
    if (existing) {
      existing.data |= data & mask;
      existing.mask |= mask;
    } else {
      accum.set(blockAddress, { data: data & mask, mask });
    }
  };

  for (const item of overlay.items) {
    let bytes: Uint8Array | null = null;
    if (item.kind === 'function') {
      if (item.custom) {
        bytes = item.custom;
      } else {
        const selected = item.parameters.find((p) => p.selected);
        if (selected) bytes = selected.data;
      }
    } else if (item.kind === 'property') {
      bytes = item.data;
    } else if (item.kind === 'unoccupied') {
      bytes = item.data;
    } else {
      continue;
    }
    if (!bytes || bytes.length !== item.length) continue;

    for (let i = 0; i < item.length; i++) {
      const byteAddr = item.address + i;
      const blockAddr = (item.block << 8) + (isWord ? Math.floor(byteAddr / 2) : byteAddr);
      const maskByte = item.mask[i % item.mask.length]!;
      const dataByte = bytes[i]! & maskByte;
      if (isWord) {
        const isLow = (byteAddr & 1) !== 0;
        if (isLow) {
          merge(blockAddr, dataByte, maskByte);
        } else {
          merge(blockAddr, dataByte << 8, maskByte << 8);
        }
      } else {
        merge(blockAddr, dataByte, maskByte);
      }
    }
  }

  const sorted = [...accum.entries()].sort((a, b) => a[0] - b[0]);
  const lines: string[] = [];
  const fullMask = isWord ? 0xffff : 0xff;
  const maxRunLen = isWord ? 8 : 16;
  let runStart = 0;
  let runData: number[] = [];

  const flushRun = (): void => {
    if (runData.length === 0) return;
    lines.push(formatB(runStart, runData, isWord));
    runData = [];
  };

  for (const [blockAddr, { data, mask }] of sorted) {
    if (mask === fullMask) {
      if (runData.length > 0 && runStart + runData.length !== blockAddr) {
        flushRun();
      }
      if (runData.length === 0) runStart = blockAddr;
      runData.push(data);
      if (runData.length >= maxRunLen) flushRun();
    } else {
      flushRun();
      lines.push(formatM(blockAddr, mask, data, isWord));
    }
  }
  flushRun();

  return lines.length > 0 ? lines.join('\n') + '\n' : '';
}

function hex(n: number, width: number): string {
  return n.toString(16).toUpperCase().padStart(width, '0');
}

function formatB(addr: number, data: number[], isWord: boolean): string {
  const tokenWidth = isWord ? 4 : 2;
  const tokens = data.map((d) => hex(d, tokenWidth)).join(',');
  return `B ${hex(addr, 8)},${hex(data.length, 4)},${tokens}`;
}

function formatM(addr: number, mask: number, data: number, isWord: boolean): string {
  const tokenWidth = isWord ? 4 : 2;
  return `M ${hex(addr, 8)},${hex(1, 4)},${hex(mask, tokenWidth)},${hex(data, tokenWidth)}`;
}
