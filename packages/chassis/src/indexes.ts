import type { DatenFile } from '@emdzej/ncsx-daten';
import type { AtRecord, SgfamRow, ZstFile, ZstRecord } from '@emdzej/ncsx-text-tables';

/**
 * SGFAM rows keyed by logical SG short-name (`EWS`, `KMB`, `MK60`, …).
 */
export function indexSgfam(rows: readonly SgfamRow[]): Map<string, SgfamRow> {
  const out = new Map<string, SgfamRow>();
  for (const row of rows) out.set(row.sgName, row);
  return out;
}

/**
 * ZST records by SA code, and by FSW keyword.
 */
export interface ZstIndex {
  file: ZstFile;
  /** Multiple rows can share a SA code (e.g. variants like `;0662 V0301`/`;0662 N0301`). */
  bySaCode: Map<string, ZstRecord[]>;
  /** Multiple rows can share an FSW (e.g. same keyword in different SA variants). */
  byFsw: Map<string, ZstRecord[]>;
}

export function indexZst(file: ZstFile): ZstIndex {
  const bySaCode = new Map<string, ZstRecord[]>();
  const byFsw = new Map<string, ZstRecord[]>();
  for (const rec of file.records) {
    if (rec.saCode) {
      const list = bySaCode.get(rec.saCode);
      if (list) list.push(rec);
      else bySaCode.set(rec.saCode, [rec]);
    }
    if (rec.fsw) {
      const list = byFsw.get(rec.fsw);
      if (list) list.push(rec);
      else byFsw.set(rec.fsw, [rec]);
    }
  }
  return { file, bySaCode, byFsw };
}

/**
 * AT records by FA code (e.g. `502`).
 */
export function indexAt(records: readonly AtRecord[]): Map<string, AtRecord> {
  const out = new Map<string, AtRecord>();
  for (const rec of records) out.set(rec.code, rec);
  return out;
}

/**
 * SGFAM rows whose `fa`/`zcs` flag is set. Use this to discover which SG on the chassis
 * carries the vehicle-identity payload (FA-master) or ZCS payload (ZCS-master) without
 * hardcoding a per-chassis table — NCSEXPER itself reads the same flags out of SGFAM.
 *
 * Most chassis have exactly one FA-master, but pre-FA chassis (E36/E38/E39/E46/E53) have
 * several ZCS-masters working together. Callers should be prepared for `[]` (warn — no
 * row carries the flag) or `[row, row, …]`.
 */
export function findSgsByFlag(
  sgfam: Map<string, SgfamRow>,
  flag: 'fa' | 'zcs',
): SgfamRow[] {
  const out: SgfamRow[] = [];
  for (const row of sgfam.values()) {
    if (row[flag] === 1) out.push(row);
  }
  return out;
}

/**
 * One MASKE row out of `<BR>ZCSUT.000` — a valid (GM, SA, VN) triplet for a
 * particular SG and coding-index group. GM is a string with optional `?`
 * wildcards (e.g. `6638????`), SA / VN are fixed-width hex (16 / 10 chars,
 * uppercase) decoded from the raw bytes in the file.
 */
export interface ZcsutMask {
  /** 8-char GM template; `?` characters mean "any digit". */
  gm: string;
  /** 16-hex-char SA bit-set (8 bytes). */
  saHex: string;
  /** 10-hex-char VN scalar (5 bytes). */
  vnHex: string;
}

/**
 * One UMRECHNUNG row — conversion rule mapping an old (GM, SA, VN) triplet to
 * a new one. Used by NCSEXPER to migrate a coding when the SW upgrade changes
 * the canonical layout (e.g. an old `VNALT=0000000000` ECU gets re-coded to
 * `VNNEU=0004400000` once flashed). Pure metadata for the editor — the host
 * doesn't apply these; the IPO does, at write time.
 */
export interface ZcsutConversion {
  gmOld: string;
  saOldHex: string;
  vnOldHex: string;
  gmNew: string;
  saNewHex: string;
  vnNewHex: string;
}

/**
 * Per-coding-index group inside a SG's ZCSUT records. The group is rooted at
 * either a `NO_CODIERINDEX` wildcard (one group, applies to any coding index)
 * or one `ID_CODIERINDEX` row (carries the list of coding indices it covers).
 * `MASKE` + `UMRECHNUNG` rows that follow belong to the most recent group.
 */
export interface ZcsutGroup {
  /** `null` ≡ wildcard (`NO_CODIERINDEX = "**"`); otherwise the explicit coding-index list. */
  codingIndices: number[] | null;
  masks: ZcsutMask[];
  conversions: ZcsutConversion[];
}

/**
 * Per-SG ZCSUT record — one entry per SG that appears in the file, with the
 * groups in document order.
 */
export interface ZcsutEcuRecord {
  sgName: string;
  groups: ZcsutGroup[];
}

/**
 * Parsed ZCSUT index. `bySg` is the primary lookup the UI uses (give it an SG
 * name, get the valid GM/SA/VN options to surface as dropdowns); `file` is the
 * raw DatenFile in case a consumer wants to walk it differently.
 */
export interface ZcsutIndex {
  file: DatenFile;
  bySg: Map<string, ZcsutEcuRecord>;
}

/**
 * Index `<BR>ZCSUT.000` by SG. The DatenFile already has every row parsed and
 * tagged with its block (DATEINAME / SG / NO_* / ID_* / MASKE / UMRECHNUNG);
 * this walker just switches on SG rows to bucket the rest. Block layout for
 * the typical pre-FA chassis (E36/E38/E39/E46/E53):
 *
 *   SG               ; row carrying SGNAME — switches the current SG context
 *   NO_CODIERINDEX   ; CDNR="**" wildcard — opens a single all-codings group
 *     - or -
 *   ID_CODIERINDEX   ; CDNR=[7,48,…] explicit coding-index list — opens a
 *                    ;   per-coding-index group; multiple of these per SG
 *   MASKE            ; (GM, SA, VN) valid-template row; belongs to the most
 *                    ;   recent NO_/ID_CODIERINDEX group
 *   UMRECHNUNG       ; (GMALT, SAALT, VNALT, GMNEU, SANEU, VNNEU) conversion
 *                    ;   rule; same grouping as MASKE
 *
 * Hardware-NR / SW-NR / Versions-NR variants are declared in the header but
 * empty for every chassis in NCS-Expert's catalogue, so they're not indexed
 * here. If they ever appear we'd need to extend `ZcsutGroup` with the matching
 * variant slots.
 */
export function indexZcsut(file: DatenFile): ZcsutIndex {
  const bySg = new Map<string, ZcsutEcuRecord>();
  let currentEcu: ZcsutEcuRecord | undefined;
  let currentGroup: ZcsutGroup | undefined;

  for (const row of file.rowsInOrder) {
    switch (row.block.name) {
      case 'SG': {
        const sgName = stringValue(row.values.SGNAME);
        if (sgName === undefined) break;
        currentEcu = { sgName, groups: [] };
        currentGroup = undefined;
        bySg.set(sgName, currentEcu);
        break;
      }
      case 'NO_CODIERINDEX': {
        // CDNR scalar with "**" — wildcard group covering any coding index.
        if (!currentEcu) break;
        const group: ZcsutGroup = { codingIndices: null, masks: [], conversions: [] };
        currentEcu.groups.push(group);
        currentGroup = group;
        break;
      }
      case 'ID_CODIERINDEX': {
        // CDNR is a collection of int — coerce to number[].
        if (!currentEcu) break;
        const list = row.values.CDNR;
        const codingIndices = Array.isArray(list)
          ? list.map((n) => Number(n)).filter((n) => Number.isFinite(n))
          : [];
        const group: ZcsutGroup = { codingIndices, masks: [], conversions: [] };
        currentEcu.groups.push(group);
        currentGroup = group;
        break;
      }
      case 'MASKE': {
        if (!currentGroup) break;
        const mask = readMask(row.values);
        if (mask) currentGroup.masks.push(mask);
        break;
      }
      case 'UMRECHNUNG': {
        if (!currentGroup) break;
        const conv = readConversion(row.values);
        if (conv) currentGroup.conversions.push(conv);
        break;
      }
      // DATEINAME / BAUREIHE / NO_* HW/SW/VN variants — skip, not used yet.
    }
  }

  return { file, bySg };
}

function stringValue(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

function bytesToHex(v: unknown): string | undefined {
  if (v && typeof v === 'object' && 'bytes' in v) {
    const b = (v as { bytes: Uint8Array }).bytes;
    let s = '';
    for (const byte of b) s += byte.toString(16).padStart(2, '0').toUpperCase();
    return s;
  }
  return undefined;
}

function readMask(values: Record<string, unknown>): ZcsutMask | null {
  const gm = stringValue(values.GM);
  const saHex = bytesToHex(values.SA);
  const vnHex = bytesToHex(values.VN);
  if (gm === undefined || saHex === undefined || vnHex === undefined) return null;
  return { gm, saHex, vnHex };
}

function readConversion(values: Record<string, unknown>): ZcsutConversion | null {
  const gmOld = stringValue(values.GMALT);
  const saOldHex = bytesToHex(values.SAALT);
  const vnOldHex = bytesToHex(values.VNALT);
  const gmNew = stringValue(values.GMNEU);
  const saNewHex = bytesToHex(values.SANEU);
  const vnNewHex = bytesToHex(values.VNNEU);
  if (
    gmOld === undefined ||
    saOldHex === undefined ||
    vnOldHex === undefined ||
    gmNew === undefined ||
    saNewHex === undefined ||
    vnNewHex === undefined
  ) {
    return null;
  }
  return { gmOld, saOldHex, vnOldHex, gmNew, saNewHex, vnNewHex };
}
