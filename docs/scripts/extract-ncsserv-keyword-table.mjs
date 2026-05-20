// Extract the CABI syscall name → slot ID table from a Softing NCS-Server
// binary (typically `ncsserv.exe` from the Ediabas 6.4.3 CABI_CFG/CABI_RUN
// archives — 16-bit NE-format, vintage 1996-2002).
//
// The runtime stores its syscall keyword table as a packed null-separated
// string array in `.data`, in slot-ID order. We anchor on the first known
// entry (`settimer`) and read off names sequentially until we hit a
// non-identifier byte.
//
// Why this works: `ncsserv.exe` is the 16-bit predecessor to NCSEXPER.EXE's
// embedded interpreter — same Softing v1.x bytecode VM, same CABI syscall
// numbering. The 16-bit binary is small (~800KB) and stores its keyword
// table inline as cleartext strings, unlike NCSEXPER.EXE's 32-bit MFC port
// where the table is heap-allocated at runtime. Extracting from
// ncsserv.exe gives us the canonical CABI table for free.
//
// The output has been cross-validated against the 334k empirical CALL sys
// observations from the 915 CABI A_*.ipo files in NCSEXPER/SGDAT — 68/68
// observed slots match the CABI.H declaration shape for the name at that
// slot, zero mismatches.
//
// Usage:
//   node extract-ncsserv-keyword-table.mjs [path/to/ncsserv.exe]
//
// Default path: /tmp/cabi-extract/cabi/bin/ncsserv.exe (matches the
// extraction location used during development). The Ediabas 6.4.3 archive
// containing ncsserv.exe is at /Ediabas-6.4.3-full/Archive/CABI_RUN.LZH —
// extract with `lha xq CABI_RUN.LZH`.

import { readFileSync } from "node:fs";

const path = process.argv[2] ?? "/tmp/cabi-extract/cabi/bin/ncsserv.exe";
const buf = readFileSync(path);
const start = buf.indexOf("settimer\0");
if (start < 0) throw new Error("`settimer` anchor not found — wrong binary?");
console.log(`# source: ${path}`);
console.log(`# table starts at file offset 0x${start.toString(16)} (${start})`);

let id = 0;
let pos = start;
const names = [];
while (pos < buf.length) {
  const end = buf.indexOf(0, pos);
  if (end < 0) break;
  const len = end - pos;
  if (len === 0) { pos = end + 1; continue; }
  if (len > 40) break;
  const name = buf.slice(pos, end).toString("ascii");
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) break;
  names.push(name);
  console.log(`0x${id.toString(16).padStart(2, "0")}  ${name}`);
  id++;
  pos = end + 1;
}
console.log(`# total ${id} entries`);
