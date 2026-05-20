import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parseIpo } from "@emdzej/inpax-parser";

// Opcodes
const OP = { LOAD:1, PUSHREF:2, LOADINOUTREF:3, MOVE:5, PUSHR:6, PUSHREFSTORE:7,
             ALLOC:8, CALL:12, CALLE:13, RET:14, FRAME:15, LOGTABLE:16, PUSHIMM:17 };

const dir = process.argv[2];
if (!dir) { console.error("usage: infer-syscall-table.mjs <SGDAT-dir>"); process.exit(2); }

// slot -> Map<signature-key, count>
const slotSigs = new Map();
// slot -> Set of (containing function names) for debugging
const slotSeenIn = new Map();
let ipoCount = 0, callCount = 0, errCount = 0;

function record(slot, sig, fnName) {
  let bucket = slotSigs.get(slot);
  if (!bucket) { bucket = new Map(); slotSigs.set(slot, bucket); }
  bucket.set(sig, (bucket.get(sig) ?? 0) + 1);
  let seen = slotSeenIn.get(slot);
  if (!seen) { seen = new Set(); slotSeenIn.set(slot, seen); }
  if (seen.size < 5) seen.add(fnName);
}

function analyzeFunction(fn) {
  // Walk linearly. Detect FRAME → ... → CALL sys N patterns.
  // Between FRAME and CALL, count LOAD (value-push, types from ValueType) and
  // PUSHREF (reference-push). Anything else (ALU, MOVE, JMP, etc.) marks a
  // complex flow we can't trivially analyse — skip those samples.
  const instrs = fn.instructions;
  let frameAt = -1, valArgs = 0, refArgs = 0, complex = false;
  for (let pc = 0; pc < instrs.length; pc++) {
    const i = instrs[pc];
    if (i.opcode === OP.FRAME) {
      frameAt = pc; valArgs = 0; refArgs = 0; complex = false;
      continue;
    }
    if (frameAt < 0) continue;
    if (i.opcode === OP.LOAD || i.opcode === OP.PUSHIMM) {
      valArgs++;
    } else if (i.opcode === OP.PUSHREF || i.opcode === OP.LOADINOUTREF || i.opcode === OP.PUSHR) {
      refArgs++;
    } else if (i.opcode === OP.CALL) {
      // Only sys calls (operand1=0x81). User calls (0x80) are user functions.
      if (i.operand1 === 0x81 && !complex) {
        const slot = i.operand2;
        const sig = `in=${valArgs} ref=${refArgs}`;
        record(slot, sig, fn.header.name);
        callCount++;
      }
      frameAt = -1;
    } else if (i.opcode === OP.JMP || i.opcode === OP.JMPNZ || i.opcode === OP.RET || i.opcode === OP.CALLE) {
      // Control-flow disturbance between FRAME and CALL — discard the sample.
      complex = true;
    } else if (i.opcode === OP.ALLOC || i.opcode === OP.MOVE || i.opcode === OP.PUSHREFSTORE) {
      // Allocs / moves change stack in non-arg ways → discard.
      complex = true;
    }
  }
}

const files = readdirSync(dir).filter(f => /\.ipo$/i.test(f));
for (const f of files) {
  try {
    const bytes = new Uint8Array(readFileSync(join(dir, f)));
    const ipo = parseIpo(bytes);
    ipoCount++;
    for (const [, fn] of ipo.functions) analyzeFunction(fn);
  } catch (e) {
    errCount++;
  }
}

console.log(`# ipos parsed: ${ipoCount}, errored: ${errCount}, sys calls observed: ${callCount}`);
console.log(`# slots seen: ${slotSigs.size}\n`);

const slots = [...slotSigs.keys()].sort((a, b) => a - b);
console.log("slot | dominant sig (count, % of slot)               | seen-in (sample)");
console.log("-----+------------------------------------------------+-----------------");
for (const slot of slots) {
  const bucket = slotSigs.get(slot);
  const total = [...bucket.values()].reduce((a, b) => a + b, 0);
  const sorted = [...bucket.entries()].sort((a, b) => b[1] - a[1]);
  const [topSig, topCount] = sorted[0];
  const pct = ((topCount / total) * 100).toFixed(0);
  const others = sorted.slice(1, 3).map(([s, c]) => `${s}@${c}`).join(", ");
  const sample = [...(slotSeenIn.get(slot) ?? [])].slice(0, 3).join(",");
  console.log(`0x${slot.toString(16).padStart(2,'0')} | ${topSig.padEnd(14)} (${topCount}/${total}=${pct.padStart(3)}%)${others ? " others: " + others : ""} | ${sample}`);
}
