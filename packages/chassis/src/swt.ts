import { parseDatenFile, type DatenFile } from '@emdzej/ncsx-daten';
import type { ChassisSource } from './source.js';

/**
 * `SWT_EINTRAG` lookup table — one of `SWTASW##.DAT`, `SWTFSW##.DAT`, `SWTPSW##.DAT`.
 *
 * Each entry pairs a u16 KEYID with a string KEYWORD. The KEYID is what the predicate
 * evaluator's `S<id-lo><id-hi>` opcode references (packed as `(word_index, bit_index)` —
 * see [`../../../docs/daten-format.md`](../../../docs/daten-format.md)).
 */
export interface SwtTable {
  /** KEYWORD → KEYID (e.g. `"COUP" → 0x0016`). */
  byKeyword: Map<string, number>;
  /** KEYID → KEYWORD. */
  byKeyId: Map<number, string>;
  /** Source filename (handy for diagnostics). */
  source: string;
}

const SWT_BLOCK = 'SWT_EINTRAG';

/**
 * Build an `SwtTable` from an already-parsed `DatenFile`.
 */
export function indexSwt(file: DatenFile, source: string): SwtTable {
  const byKeyword = new Map<string, number>();
  const byKeyId = new Map<number, string>();
  const block = file.blocks.find((b) => b.name === SWT_BLOCK);
  if (block) {
    for (const row of block.rows) {
      const id = row.KEYID;
      const kw = row.KEYWORD;
      if (typeof id === 'number' && typeof kw === 'string') {
        byKeyword.set(kw, id);
        byKeyId.set(id, kw);
      }
    }
  }
  return { byKeyword, byKeyId, source };
}

/**
 * Find the chassis's SWT lookup file by extension. NCSEXPER ships them as `SWT<KIND><NN>.DAT`
 * where `<KIND>` is one of `ASW`/`FSW`/`PSW` and `<NN>` is a 2-digit chassis revision.
 * Case-insensitive on disk.
 */
async function findSwtFile(
  source: ChassisSource,
  chassisDir: string,
  kind: 'ASW' | 'FSW' | 'PSW',
): Promise<string | undefined> {
  const entries = await source.list(chassisDir).catch(() => [] as string[]);
  const re = new RegExp(`^SWT${kind}[0-9A-Fa-f]{2}\\.dat$`, 'i');
  for (const entry of entries) {
    if (re.test(entry)) return `${chassisDir}/${entry}`;
  }
  return undefined;
}

/**
 * Locate and load one SWT file from a chassis directory. Returns `undefined` if no matching
 * file is present (caller decides whether to warn).
 */
export async function loadSwtFile(
  source: ChassisSource,
  chassisDir: string,
  kind: 'ASW' | 'FSW' | 'PSW',
): Promise<SwtTable | undefined> {
  const path = await findSwtFile(source, chassisDir, kind);
  if (!path) return undefined;
  const bytes = await source.read(path);
  const file = parseDatenFile(bytes);
  return indexSwt(file, path);
}
