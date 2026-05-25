import { TraceError, type TraceOverlay, type TraceOverlayUnresolved } from './types.js';

/**
 * One FSW group parsed from an FSW/PSW trace file: the function keyword and the list of
 * PSW keywords that were ticked under it.
 */
export interface FswPswSelection {
  fswKeyword: string;
  pswKeywords: string[];
}

const FUNCTION_LINE = /^([^\s]+)$/;
const PARAMETER_LINE = /^\s+([^\s]+)$/;

/**
 * Parse the text body of an `FSW_PSW.TRC` / `FSW_PSW.MAN` file. Lines are either:
 *
 *   - an FSW keyword with no leading whitespace (starts a new function); or
 *   - a tab/space-indented PSW keyword (appended to the current function).
 *
 * Blank lines are tolerated. Unindented lines that begin a new function are not required
 * to have any PSWs (an empty function selection round-trips, same as NCS Expert).
 *
 * Matches `NcsDummy/Classes/FswPswNettodatas/FswPswNettodataListReader.cs:81-101`.
 */
export function parseFswPswTrace(text: string): FswPswSelection[] {
  const selections: FswPswSelection[] = [];
  let current: FswPswSelection | null = null;

  for (const rawLine of text.split(/\r?\n/)) {
    if (rawLine.trim() === '') continue;
    const paramMatch = PARAMETER_LINE.exec(rawLine);
    if (paramMatch) {
      if (!current) {
        throw new TraceError(
          `parameter "${paramMatch[1]}" before any function keyword`,
        );
      }
      current.pswKeywords.push(paramMatch[1]!);
      continue;
    }
    const fnMatch = FUNCTION_LINE.exec(rawLine);
    if (fnMatch) {
      current = { fswKeyword: fnMatch[1]!, pswKeywords: [] };
      selections.push(current);
      continue;
    }
    throw new TraceError(`malformed FSW/PSW line: ${JSON.stringify(rawLine)}`);
  }

  return selections;
}

/**
 * Apply parsed FSW/PSW selections onto an overlay. For each selection:
 *
 *   1. Look up the function by FSW keyword (linear scan — catalogues are small).
 *   2. For each PSW keyword, set `selected=true` on the matching parameter.
 *   3. If the FSW keyword isn't in the catalog, append a `TraceOverlayUnresolved` item so
 *      the UI can surface it.
 *
 * Mutates `overlay` in place and returns it for chaining. Strict mode throws on any
 * unresolved keyword (mirrors NCS Dummy's `strictFswPswTraceFileReading`).
 */
export function applyFswPswTrace(
  overlay: TraceOverlay,
  selections: FswPswSelection[],
  options: { strict?: boolean } = {},
): TraceOverlay {
  const strict = options.strict ?? false;

  for (const sel of selections) {
    const fn = overlay.items.find(
      (it) => it.kind === 'function' && it.fswKeyword === sel.fswKeyword,
    );
    if (!fn || fn.kind !== 'function') {
      if (strict) {
        throw new TraceError(
          `unresolved function keyword "${sel.fswKeyword}" — chassis / module mismatch?`,
        );
      }
      const unresolved: TraceOverlayUnresolved = {
        kind: 'unresolved',
        fswKeyword: sel.fswKeyword,
        parameterKeywords: [...sel.pswKeywords],
      };
      overlay.items.push(unresolved);
      continue;
    }
    for (const pswKw of sel.pswKeywords) {
      const param = fn.parameters.find((p) => p.pswKeyword === pswKw);
      if (!param) {
        if (strict) {
          throw new TraceError(
            `unresolved parameter keyword "${pswKw}" in function "${sel.fswKeyword}"`,
          );
        }
        continue;
      }
      param.selected = true;
    }
  }

  return overlay;
}

/**
 * Serialise an overlay to FSW/PSW text. Only emits functions with at least one selected
 * parameter (and unresolved keywords from a prior read pass). PSW lines use a single
 * leading TAB and are sorted by encounter order within their function.
 *
 * Matches `NcsDummy/Classes/TraceFunctions/FswPswTraceFunctionListWriter.cs`.
 */
export function writeFswPswTrace(overlay: TraceOverlay): string {
  const selections: FswPswSelection[] = [];

  // NCS Dummy sorts functions by FSW id before writing. We do the same.
  const functionItems = overlay.items
    .filter((it) => it.kind === 'function')
    .filter((it) => it.kind === 'function' && it.parameters.some((p) => p.selected))
    .sort((a, b) => {
      if (a.kind !== 'function' || b.kind !== 'function') return 0;
      return a.fsw - b.fsw;
    });

  for (const item of functionItems) {
    if (item.kind !== 'function') continue;
    const pswKeywords: string[] = [];
    const seen = new Set<string>();
    for (const p of item.parameters) {
      if (!p.selected) continue;
      if (seen.has(p.pswKeyword)) continue;
      seen.add(p.pswKeyword);
      pswKeywords.push(p.pswKeyword);
    }
    selections.push({ fswKeyword: item.fswKeyword, pswKeywords });
  }

  // Then unresolved keywords (NCS Dummy `FixUnresolved` puts them last by default; we
  // emit them after the resolved set to preserve the user's intent).
  for (const item of overlay.items) {
    if (item.kind !== 'unresolved') continue;
    selections.push({ fswKeyword: item.fswKeyword, pswKeywords: [...item.parameterKeywords] });
  }

  return writeFswPswSelections(selections);
}

/** Options for `writeFswPswSelections`. */
export interface WriteFswPswOptions {
  /**
   * Line separator. Defaults to `'\n'` (matches `writeFswPswTrace` output).
   * Pass `'\r\n'` for NCSEXPER / NCSdummy compatibility — NCSEXPER's text-mode
   * `CStdioFile` writes `\r\n`, and that's what files dropped into `WORK/` look like.
   */
  lineEnding?: '\n' | '\r\n';
  /**
   * Sort FSW entries alphabetically before writing. NCSdummy's `WriteList`
   * sorts by `Identifier` (the FSW keyword) — pass `true` for parity. Default
   * `false` preserves caller-supplied order.
   */
  sort?: boolean;
}

/**
 * Serialise a list of `FswPswSelection`s to the canonical text format:
 *
 *   <fsw_keyword><lineEnding>
 *   \t<psw_keyword><lineEnding>
 *   …
 *
 * The primitive writer both `writeFswPswTrace` (TraceOverlay-driven) and
 * callers writing bare MAN files (CLI patch conversion, web app's
 * `buildFswPswMan`) consume — keep them in sync by routing through here.
 *
 * Returns the empty string when `selections` is empty (no trailing newline).
 */
export function writeFswPswSelections(
  selections: readonly FswPswSelection[],
  opts: WriteFswPswOptions = {},
): string {
  const lineEnding = opts.lineEnding ?? '\n';
  const ordered = opts.sort
    ? [...selections].sort((a, b) => a.fswKeyword.localeCompare(b.fswKeyword))
    : selections;
  if (ordered.length === 0) return '';
  const lines: string[] = [];
  for (const sel of ordered) {
    lines.push(sel.fswKeyword);
    for (const psw of sel.pswKeywords) lines.push(`\t${psw}`);
  }
  return lines.join(lineEnding) + lineEnding;
}
