/**
 * FSW_PSW.TRC / .MAN writers — both files share the same plain-text
 * format, only the filter differs:
 *
 *   <FSW keyword>\r\n
 *   \t<PSW keyword>\r\n
 *
 * **TRC** (NCSEXPER's `coapiTraceFswPsw`, ghidra FUN_004285c0): full
 * snapshot of currently-active FSW/PSW pairs from the netto. Always
 * iterates every FSW the SG defines.
 *
 * **MAN** (NCSdummy's `FswPswTraceFunctionListWriter`, decompiled at
 * `ncsdummy-src/.../FswPswTraceFunctionListWriter.cs`): only the
 * **user's pending edits**. NCSEXPER reads MAN files via
 * `[FSWPSW].FswPswLeseDatei` (parser at FUN_00429e50) and applies
 * them as edits on top of the in-memory FSW/PSW table before
 * `SG_CODIEREN` runs — so users can stage changes here and let
 * NCSEXPER do the writing.
 *
 * CRLF line endings match both NCSEXPER's `sprintf("%s\n", …)` in
 * text-mode `CStdioFile` and .NET's `StreamWriter.WriteLine`.
 */

import { decodeCurrentPsw, type FunctionList, type FunctionItem } from "@emdzej/ncsx-function-list";
import { writeFswPswSelections, type FswPswSelection } from "@emdzej/ncsx-trace";

export interface ParseFswPswManResult {
  /**
   * FSW id → PSW id pairs successfully resolved against the FunctionList.
   * Same shape the FunctionTree's `targets` state uses, so callers can
   * merge or replace directly.
   */
  targets: Record<number, number>;
  /**
   * Resolution failures the caller should surface to the user: unknown
   * FSW keywords (probably from a different chassis / CABD variant),
   * unknown PSW values within a known FSW, or pairs with no PSW line.
   * Order-preserved so the message reads top-to-bottom of the input.
   */
  warnings: string[];
}

/**
 * Parse the FSW_PSW.MAN format produced by NCSEXPER (and
 * `buildFswPswMan` above) into a `targets` map the FunctionTree can
 * apply as staged edits. Mirrors NCSEXPER's
 * `[FSWPSW].FswPswLeseDatei` flow — read MAN file, look each pair up
 * in the loaded CABD, stage as a pending edit.
 *
 * Tolerates LF or CRLF line endings, blank lines, and the writer's
 * `FSW_<id>` / `PSW_<id>` numeric fallback for entries whose keyword
 * wasn't available at write time.
 *
 * Pairs that don't resolve (unknown FSW, unknown PSW) are returned in
 * `warnings` instead of throwing — the user almost always still wants
 * the recognised pairs applied.
 */
export function parseFswPswMan(text: string, list: FunctionList): ParseFswPswManResult {
  const fnByKeyword = new Map<string, FunctionItem>();
  const fnByFsw = new Map<number, FunctionItem>();
  for (const it of list.items) {
    if (it.kind !== "function") continue;
    if (it.fswKeyword) fnByKeyword.set(it.fswKeyword, it);
    fnByFsw.set(it.fsw, it);
  }

  const resolveFn = (token: string): FunctionItem | undefined => {
    const hit = fnByKeyword.get(token);
    if (hit) return hit;
    if (token.startsWith("FSW_")) {
      const n = Number(token.slice(4));
      if (Number.isFinite(n)) return fnByFsw.get(n);
    }
    return undefined;
  };
  const resolvePsw = (fn: FunctionItem, token: string) => {
    const byKw = fn.parameters.find((p) => p.pswKeyword === token);
    if (byKw) return byKw;
    if (token.startsWith("PSW_")) {
      const n = Number(token.slice(4));
      if (Number.isFinite(n)) return fn.parameters.find((p) => p.psw === n);
    }
    return undefined;
  };

  const targets: Record<number, number> = {};
  const warnings: string[] = [];
  const lines = text.replace(/\r\n?/g, "\n").split("\n");

  // FSW lines are flush-left; PSW lines are indented (tab or spaces).
  // Walk the file and pair each FSW with the next indented line.
  let i = 0;
  while (i < lines.length) {
    const raw = lines[i]!;
    const trimmed = raw.trim();
    if (trimmed === "" || /^[ \t]/.test(raw)) {
      // Skip blanks and dangling indented lines (a PSW with no FSW).
      i++;
      continue;
    }
    // Found an FSW. Look ahead for the matching PSW.
    let pswToken: string | undefined;
    let j = i + 1;
    while (j < lines.length) {
      const next = lines[j]!;
      if (next.trim() === "") {
        j++;
        continue;
      }
      if (/^[ \t]/.test(next)) {
        pswToken = next.trim();
        break;
      }
      // Hit another flush-left line — current FSW has no PSW.
      break;
    }
    if (pswToken === undefined) {
      warnings.push(`Line ${i + 1}: FSW "${trimmed}" has no PSW line`);
      i++;
      continue;
    }
    const fn = resolveFn(trimmed);
    if (!fn) {
      warnings.push(`Line ${i + 1}: unknown FSW "${trimmed}"`);
      i = j + 1;
      continue;
    }
    const param = resolvePsw(fn, pswToken);
    if (!param) {
      warnings.push(`Line ${j + 1}: "${trimmed}" has no PSW "${pswToken}"`);
      i = j + 1;
      continue;
    }
    targets[fn.fsw] = param.psw;
    i = j + 1;
  }
  return { targets, warnings };
}

/**
 * Produce the TRC text — snapshot of currently-active FSW/PSWs.
 * Returns an empty string when the netto is missing or no FSW has
 * an active PSW.
 *
 * Text shape comes from `@emdzej/ncsx-trace`'s `writeFswPswSelections`
 * so the TRC/MAN/CLI writers all share one formatter.
 */
export function buildFswPswTrc(
  list: FunctionList,
  netto: Uint8Array,
): string {
  const selections: FswPswSelection[] = [];
  for (const item of list.items) {
    if (item.kind !== "function") continue;
    const active = decodeCurrentPsw(item, netto);
    if (!active) continue;
    const fswKw = item.fswKeyword || `FSW_${item.fsw}`;
    const pswKw = active.pswKeyword || `PSW_${active.psw}`;
    selections.push({ fswKeyword: fswKw, pswKeywords: [pswKw] });
  }
  return writeFswPswSelections(selections, { lineEnding: "\r\n" });
}

/**
 * Produce the MAN text — only the user's pending edits, keyed by
 * the staged target PSW (NOT the current netto value). Mirrors
 * NCSdummy's `WriteList` (filters to `ContainsChecked` items,
 * orders by `Identifier`). When NCSEXPER reads this back it'll
 * apply each pair as a `coapiChangeFswPsw(FSW, PSW)` call before
 * `SG_CODIEREN`.
 *
 * `targets` is the FunctionTree's `Record<fsw_id, target_psw_id>`
 * — same shape the FunctionTree's "pending edits" map already
 * tracks. Items not present in `targets` are omitted.
 */
export function buildFswPswMan(
  list: FunctionList,
  targets: Record<number, number>,
): string {
  // Index by FSW id once so we can resolve keywords without rescanning.
  const fnByFsw = new Map<number, FunctionItem>();
  for (const it of list.items) {
    if (it.kind === "function") fnByFsw.set(it.fsw, it);
  }
  const selections: FswPswSelection[] = [];
  for (const [fswStr, pswId] of Object.entries(targets)) {
    const fswNum = Number(fswStr);
    const item = fnByFsw.get(fswNum);
    if (!item) continue;
    const param = item.parameters.find((p) => p.psw === pswId);
    if (!param) continue;
    selections.push({
      fswKeyword: item.fswKeyword || `FSW_${fswNum}`,
      pswKeywords: [param.pswKeyword || `PSW_${pswId}`],
    });
  }
  // NCSdummy sorts FSW keywords alphabetically (`orderby item.Identifier`);
  // CRLF line endings match its `StreamWriter.WriteLine` output.
  return writeFswPswSelections(selections, { lineEnding: "\r\n", sort: true });
}

/**
 * Browser download trigger — creates a transient Blob URL and
 * clicks an anchor. `kind` selects between the TRC (snapshot) and
 * MAN (pending edits) writers and picks the matching default
 * filename NCSEXPER expects (`WORK/FSW_PSW.TRC` / `WORK/FSW_PSW.MAN`).
 */
export function downloadFswPsw(
  kind: "trc" | "man",
  list: FunctionList,
  arg: Uint8Array | Record<number, number>,
  filename?: string,
): void {
  const text =
    kind === "trc"
      ? buildFswPswTrc(list, arg as Uint8Array)
      : buildFswPswMan(list, arg as Record<number, number>);
  download(text, filename ?? (kind === "trc" ? "FSW_PSW.TRC" : "FSW_PSW.MAN"));
}

/**
 * Produce NETTODAT.TRC text — line-per-contiguous-run dump of the
 * coded bytes. Format matches NCSEXPER's `coapiTraceNettoData`
 * (FUN_004248f0):
 *
 *   B <addr_8>,<count_4>,<record_hex>,<record_hex>,...\n
 *
 * where:
 *
 * - `addr` is the **word address** of the first record on the line —
 *   i.e. `byte_addr / wortBreite`. Byte address `0x56` on a WB=2
 *   chassis appears as `0000002B`. Reference: `B 0000002B,0001,0121`
 *   in the user's NCS trace.
 * - `count` is the number of records (not bytes) on the line.
 * - each `record_hex` is `wortBreite` bytes concatenated as `%02X`,
 *   no separator within a record.
 * - `wortBreite` records per chunk = `0x10 / wortBreite`, i.e. 16
 *   bytes per line at most (8 records for WB=2, 16 for WB=1).
 * - line terminator is `\n` (single LF), not `\r\n`.
 *
 * Only addresses present in `codingAddresses` get dumped — uncoded
 * filler is skipped, matching NCSEXPER's slot-table-driven write.
 * Contiguous runs starting at non-word-aligned byte addresses are
 * preserved verbatim (NCSEXPER's slot table can carry partial-byte
 * records on byte-mode chassis).
 */
export function buildNettodatTrc(
  netto: Uint8Array,
  codingAddresses: Set<number>,
  wortBreite: 1 | 2 = 2,
): string {
  const addrs = [...codingAddresses].sort((a, b) => a - b);
  if (addrs.length === 0) return "";
  const lines: string[] = [];
  const recordsPerLine = 16 / wortBreite;
  let runStart = addrs[0]!;
  let runEnd = runStart;
  const flush = (start: number, endExclusive: number): void => {
    const bytesPerLine = recordsPerLine * wortBreite;
    for (
      let chunkStart = start;
      chunkStart < endExclusive;
      chunkStart += bytesPerLine
    ) {
      const chunkEnd = Math.min(chunkStart + bytesPerLine, endExclusive);
      const recordCount = Math.ceil((chunkEnd - chunkStart) / wortBreite);
      const records: string[] = [];
      for (let i = 0; i < recordCount; i++) {
        let hex = "";
        for (let b = 0; b < wortBreite; b++) {
          const byte = netto[chunkStart + i * wortBreite + b] ?? 0;
          hex += byte.toString(16).toUpperCase().padStart(2, "0");
        }
        records.push(hex);
      }
      const wordAddr = (chunkStart / wortBreite) | 0;
      const addrStr = wordAddr.toString(16).toUpperCase().padStart(8, "0");
      const countStr = recordCount.toString(16).toUpperCase().padStart(4, "0");
      lines.push(`B ${addrStr},${countStr},${records.join(",")}\n`);
    }
  };
  for (let i = 1; i < addrs.length; i++) {
    const addr = addrs[i]!;
    if (addr === runEnd + 1) {
      runEnd = addr;
    } else {
      flush(runStart, runEnd + 1);
      runStart = addr;
      runEnd = addr;
    }
  }
  flush(runStart, runEnd + 1);
  return lines.join("");
}

export function downloadNettodatTrc(
  netto: Uint8Array,
  codingAddresses: Set<number>,
  wortBreite: 1 | 2 = 2,
  filename = "NETTODAT.TRC",
): void {
  download(buildNettodatTrc(netto, codingAddresses, wortBreite), filename);
}

function download(text: string, filename: string): void {
  const blob = new Blob([text], { type: "text/plain;charset=windows-1252" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Release the URL after the click handler unwinds — Safari needs
  // the next macrotask.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

