// Empirical syscall-table inferrer for NCSEXPER's CABI runtime.
//
// Walks every IPO file in NCSEXPER/SGDAT whose function table contains
// `cabimain` (i.e. the script is compiled for NCSEXPER's CABI host),
// and for each `CALL sys N` it observes between a `FRAME` and the
// matching `CALL`, records the (in-args, out-refs) shape that was
// pushed. Aggregates per slot — gives a strong frequency signal for
// each slot's actual NCSEXPER signature.
//
// INPA-style IPOs (`inpainit`/`inpaexit` entry, ~880 files in NCSEXPER's
// SGDAT) are filtered out — their signatures don't match NCSEXPER's
// runtime because they're compiled against INPA.EXE's slot table. They
// physically ship in NCSEXPER's SGDAT because BMW's install bundles
// both apps' content together, but NCSEXPER's C++ entry-point lookup
// hardcodes "cabimain"/"cabiexit" (ghidra-verified in CDHIntInit at
// 0x004410f0 — no "inpainit" string exists in the binary).
//
// Run from apps/web/ so node resolves @emdzej/inpax-parser:
//   node ../../docs/scripts/infer-syscall-table.mjs /path/to/NCSEXPER/SGDAT

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parseIpo } from "@emdzej/inpax-parser";

const OP = { LOAD:1, PUSHREF:2, LOADINOUTREF:3, MOVE:5, PUSHR:6, PUSHREFSTORE:7,
             ALLOC:8, ALU:9, JMP:10, JMPNZ:11, CALL:12, CALLE:13, RET:14, FRAME:15,
             LOGTABLE:16, PUSHIMM:17 };

const dir = process.argv[2];
if (!dir) { console.error("usage: infer-syscall-table.mjs <SGDAT-dir>"); process.exit(2); }

function isCabi(ipo) {
  for (const [, fn] of ipo.functions) if (fn.header.name === "cabimain") return true;
  return false;
}

const slotSigs = new Map(); // slot -> Map<"in=N ref=M", count>
const slotSeenIn = new Map();
let ipos = 0, cabiIpos = 0, errored = 0, calls = 0;
for (const f of readdirSync(dir).filter(f => /\.ipo$/i.test(f))) {
  try {
    const ipo = parseIpo(new Uint8Array(readFileSync(join(dir, f))));
    ipos++;
    if (!isCabi(ipo)) continue;
    cabiIpos++;
    for (const [, fn] of ipo.functions) {
      let frameAt = -1, ins = 0, refs = 0, bad = false;
      for (let pc = 0; pc < fn.instructions.length; pc++) {
        const i = fn.instructions[pc];
        if (i.opcode === OP.FRAME) { frameAt = pc; ins = 0; refs = 0; bad = false; continue; }
        if (frameAt < 0) continue;
        if (i.opcode === OP.LOAD || i.opcode === OP.PUSHIMM) ins++;
        else if (i.opcode === OP.PUSHREF || i.opcode === OP.LOADINOUTREF || i.opcode === OP.PUSHR) refs++;
        else if (i.opcode === OP.CALL) {
          if (i.operand1 === 0x81 && !bad) {
            const slot = i.operand2;
            const key = `in=${ins} ref=${refs}`;
            let b = slotSigs.get(slot);
            if (!b) { b = new Map(); slotSigs.set(slot, b); }
            b.set(key, (b.get(key) ?? 0) + 1);
            let s = slotSeenIn.get(slot);
            if (!s) { s = new Set(); slotSeenIn.set(slot, s); }
            if (s.size < 6) s.add(fn.header.name);
            calls++;
          }
          frameAt = -1;
        } else { bad = true; }
      }
    }
  } catch { errored++; }
}

console.log(`# total IPOs: ${ipos}, CABI (cabimain): ${cabiIpos}, errored: ${errored}`);
console.log(`# CALL sys observed: ${calls}, distinct slots: ${slotSigs.size}\n`);
console.log("slot | dominant sig (count, %)              | callers (sample)");
console.log("-----+---------------------------------------+-----------------");
const slots = [...slotSigs.keys()].sort((a, b) => a - b);
for (const slot of slots) {
  const bucket = slotSigs.get(slot);
  const total = [...bucket.values()].reduce((a, b) => a + b, 0);
  const sorted = [...bucket.entries()].sort((a, b) => b[1] - a[1]);
  const [topKey, topCount] = sorted[0];
  const pct = ((topCount / total) * 100).toFixed(0);
  const others = sorted.slice(1, 3).filter(([,c]) => c >= 5).map(([s, c]) => `${s}@${c}`).join(", ");
  const sample = [...(slotSeenIn.get(slot) ?? [])].slice(0, 3).join(",");
  const otherStr = others ? `  others: ${others}` : "";
  console.log(`0x${slot.toString(16).padStart(2,'0')} | ${topKey.padEnd(15)} (${topCount.toString().padStart(5)}/${total.toString().padStart(5)} = ${pct.padStart(3)}%)${otherStr} | ${sample}`);
}
