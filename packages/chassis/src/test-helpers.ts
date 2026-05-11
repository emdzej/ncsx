import { xorFoldCrc } from '@emdzej/ncsx-daten';

/**
 * Build a single DATEN frame `[size, type_lo, type_hi, …payload, crc]` with a correct CRC.
 * Lifted from `packages/daten/src/reader.test.ts` for reuse in chassis-loader tests.
 */
export function frame(type: number, payload: ArrayLike<number>): Uint8Array {
  const size = payload.length;
  const head = Uint8Array.from([size, type & 0xff, (type >> 8) & 0xff, ...Array.from(payload)]);
  const crc = xorFoldCrc(head);
  return Uint8Array.from([...head, crc]);
}

export function concat(...parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

const ascii = (s: string): number[] => Array.from(s, (c) => c.charCodeAt(0));

/**
 * Build a minimal BR_REF.DAT with one `BR_ZEILE` block listing the given codes and an empty
 * `BR_ERSATZ` block. Each `BR_ZEILE` row has a single `S` field — enough to exercise the
 * `resolveChassisCode` lookup.
 */
export function buildBrRef(
  zeile: readonly string[],
  ersatz: ReadonlyArray<readonly [string, string]> = [],
): Uint8Array {
  const parts: Uint8Array[] = [];
  // sig 1
  parts.push(frame(0x0100, [0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x63]));
  // sig 2
  parts.push(frame(0x0200, [0x02]));
  // block id 0x0001 BR_ZEILE format "S" names "CODE"
  parts.push(frame(0x0300, [0x01, 0x00, ...ascii('BR_ZEILE'), 0x00]));
  parts.push(frame(0x0400, [...ascii('S'), 0x00]));
  parts.push(frame(0x0500, [...ascii('CODE'), 0x00]));
  // block id 0x0002 BR_ERSATZ format "SS" names "FROM,TO"
  parts.push(frame(0x0300, [0x02, 0x00, ...ascii('BR_ERSATZ'), 0x00]));
  parts.push(frame(0x0400, [...ascii('SS'), 0x00]));
  parts.push(frame(0x0500, [...ascii('FROM,TO'), 0x00]));
  // divider
  parts.push(frame(0xff00, []));
  // BR_ZEILE rows
  for (const code of zeile) parts.push(frame(0x0001, [...ascii(code), 0x00]));
  // BR_ERSATZ rows
  for (const [from, to] of ersatz) {
    parts.push(frame(0x0002, [...ascii(from), 0x00, ...ascii(to), 0x00]));
  }
  return concat(...parts);
}

/**
 * Build a minimal `<BR>DST.000` containing a single empty SGZEILE-like block (just enough
 * for the loader to accept the file as present).
 */
export function buildDst(): Uint8Array {
  return concat(
    frame(0x0100, [0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x63]),
    frame(0x0200, [0x02]),
    frame(0x0300, [0x01, 0x00, ...ascii('SGZEILE'), 0x00]),
    frame(0x0400, [...ascii('S'), 0x00]),
    frame(0x0500, [...ascii('NAME'), 0x00]),
    frame(0xff00, []),
  );
}
