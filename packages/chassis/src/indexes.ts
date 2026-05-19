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
