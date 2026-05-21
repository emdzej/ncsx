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
  const blob = new Blob([text], { type: "text/plain;charset=windows-1252" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename ?? (kind === "trc" ? "FSW_PSW.TRC" : "FSW_PSW.MAN");
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Release the URL after the click handler unwinds — Safari needs
  // the next macrotask.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

