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
 */
export function buildFswPswTrc(
  list: FunctionList,
  netto: Uint8Array,
): string {
  const lines: string[] = [];
  for (const item of list.items) {
    if (item.kind !== "function") continue;
    const active = decodeCurrentPsw(item, netto);
    if (!active) continue;
    const fswKw = item.fswKeyword || `FSW_${item.fsw}`;
    const pswKw = active.pswKeyword || `PSW_${active.psw}`;
    lines.push(`${fswKw}\r\n\t${pswKw}\r\n`);
  }
  return lines.join("");
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
  const pairs: Array<{ fsw: string; psw: string }> = [];
  for (const [fswStr, pswId] of Object.entries(targets)) {
    const fswNum = Number(fswStr);
    const item = fnByFsw.get(fswNum);
    if (!item) continue;
    const param = item.parameters.find((p) => p.psw === pswId);
    if (!param) continue;
    pairs.push({
      fsw: item.fswKeyword || `FSW_${fswNum}`,
      psw: param.pswKeyword || `PSW_${pswId}`,
    });
  }
  // NCSdummy sorts FSW keywords alphabetically (`orderby item.Identifier`).
  pairs.sort((a, b) => a.fsw.localeCompare(b.fsw));
  return pairs.map((p) => `${p.fsw}\r\n\t${p.psw}\r\n`).join("");
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
 * coded bytes. Format matches NCSEXPER's `coapiTraceNettoData`:
 *
 *   B <addr_8>,<count_4>,<word_4>,<word_4>,...\r\n
 *
 * where `count` is the number of 4-char hex word groups on the line
 * (each group = 2 sequential bytes at byte_addr, byte_addr+1) and
 * the address is the byte address of the first word in the line.
 * Lines are 8 words (16 bytes) wide at most; the final line of a
 * contiguous run is shorter when the run isn't a multiple of 16.
 *
 * Only addresses present in `codingAddresses` get dumped — uncoded
 * filler is skipped, matching NCSEXPER's slot-table-driven write.
 * If a contiguous run starts at an odd byte address, we still emit
 * a B line (NCSEXPER does too — see `B 0000002B,0001,0121` in the
 * reference dump).
 */
export function buildNettodatTrc(
  netto: Uint8Array,
  codingAddresses: Set<number>,
): string {
  const addrs = [...codingAddresses].sort((a, b) => a - b);
  if (addrs.length === 0) return "";
  const lines: string[] = [];
  // Walk contiguous runs.
  let runStart = addrs[0]!;
  let runEnd = runStart;
  const flush = (start: number, endExclusive: number): void => {
    for (let chunkStart = start; chunkStart < endExclusive; chunkStart += 16) {
      const chunkEnd = Math.min(chunkStart + 16, endExclusive);
      const wordCount = Math.ceil((chunkEnd - chunkStart) / 2);
      const words: string[] = [];
      for (let i = 0; i < wordCount; i++) {
        const hi = netto[chunkStart + i * 2] ?? 0;
        const lo = netto[chunkStart + i * 2 + 1] ?? 0;
        words.push(
          ((hi << 8) | lo).toString(16).toUpperCase().padStart(4, "0"),
        );
      }
      const addrStr = chunkStart
        .toString(16)
        .toUpperCase()
        .padStart(8, "0");
      const countStr = wordCount.toString(16).toUpperCase().padStart(4, "0");
      lines.push(`B ${addrStr},${countStr},${words.join(",")}\r\n`);
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
  filename = "NETTODAT.TRC",
): void {
  download(buildNettodatTrc(netto, codingAddresses), filename);
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

