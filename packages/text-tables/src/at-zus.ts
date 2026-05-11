import { parseAt, type AtFile } from './at.js';

/**
 * `<BR>AT.ZUS` is the "Zusatz" companion to `<BR>AT.000` — same lexical conventions, same
 * record grammar, mostly carries change-log entries and additional flag definitions. We re-use
 * the AT parser verbatim; downstream code can treat ZUS records the same as AT records.
 */
export function parseAtZus(content: string): AtFile {
  return parseAt(content);
}
