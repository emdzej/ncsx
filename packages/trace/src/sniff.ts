import type { TraceFormat } from './types.js';

const FSW_LINE = /^[^\s]+$/;
const NETTODATA_LINE =
  /^(B|M) [0-9A-Fa-f]{8},[0-9A-Fa-f]{4},([0-9A-Fa-f]{4}(,[0-9A-Fa-f]{4}){0,7}|[0-9A-Fa-f]{2}(,[0-9A-Fa-f]{2}){0,15})$/;

/**
 * Detect whether a trace file is FSW/PSW or Nettodata. Mirrors NCS Dummy's
 * `FswPswNettodataListReader.IsFswPswOrNettodata`. Returns `null` when the file is empty
 * or all-blank.
 */
export function sniffTraceFormat(text: string): TraceFormat | null {
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '') continue;
    if (NETTODATA_LINE.test(raw)) return 'nettodata';
    if (FSW_LINE.test(raw)) return 'fsw-psw';
    return null;
  }
  return null;
}
