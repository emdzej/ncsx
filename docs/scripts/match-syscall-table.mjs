import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parseIpo } from "@emdzej/inpax-parser";

const OP = { LOAD:1, PUSHREF:2, LOADINOUTREF:3, MOVE:5, PUSHR:6, PUSHREFSTORE:7,
             ALLOC:8, CALL:12, CALLE:13, RET:14, FRAME:15, LOGTABLE:16, PUSHIMM:17 };

// Push event: kind = "val" (LOAD/PUSHIMM = value-by-type) or "ref" (PUSHREF*).
// `valueType` for val pushes: from the parsed const-pool entry or local slot.
function analyzeFile(ipo, addCall) {
  const constTypes = ipo.constants.values.map(c => c.type);
  const globalTypes = ipo.globals.types;
  for (const [, fn] of ipo.functions) {
    const instrs = fn.instructions;
    // Track local slot types as we go. fn params land at index 0+, allocs add.
    // We don't statically know param types — record what we can.
    const localTypes = new Map(); // local index -> last known type
    let frameAt = -1, pushes = [];
    let complex = false;
    for (let pc = 0; pc < instrs.length; pc++) {
      const i = instrs[pc];
      if (i.opcode === OP.FRAME) {
        frameAt = pc; pushes = []; complex = false; continue;
      }
      if (i.opcode === OP.ALLOC) {
        // typeMarker -> rough type letter
        const m = { 0x50: 'B', 0x51: 'i', 0x52: 'b', 0x53: 's', 0x54: 'l', 0x55: 'r' }[i.operand1] ?? '?';
        // ALLOC pushes a local onto stack — we track its type at the position it lands.
        // (We don't know its index exactly without simulating; just note we did one.)
        if (frameAt >= 0) complex = true;
        continue;
      }
      if (frameAt < 0) continue;
      if (i.opcode === OP.LOAD || i.opcode === OP.PUSHIMM) {
        let t = '?';
        if (i.opcode === OP.LOAD) {
          if (i.operand1 === 1) { // const scope
            const ct = constTypes[i.operand2];
            if (ct === 3) t = 'i'; else if (ct === 6) t = 's'; else if (ct === 4) t = 'l'; else if (ct === 5) t = 'r';
          } else if (i.operand1 === 3) { // global
            const gt = globalTypes[i.operand2];
            if (gt === 3) t = 'i'; else if (gt === 6) t = 's'; else if (gt === 4) t = 'l'; else if (gt === 5) t = 'r';
          }
        } else if (i.opcode === OP.PUSHIMM) {
          const m = { 0x50: 'B', 0x51: 'i', 0x52: 'b', 0x53: 's', 0x54: 'l', 0x55: 'r' }[i.operand1] ?? '?';
          t = m;
        }
        pushes.push({ k: 'v', t });
      } else if (i.opcode === OP.PUSHREF || i.opcode === OP.LOADINOUTREF || i.opcode === OP.PUSHR) {
        pushes.push({ k: 'r', t: '?' });
      } else if (i.opcode === OP.CALL) {
        if (i.operand1 === 0x81 && !complex) {
          const slot = i.operand2;
          addCall(slot, pushes, fn.header.name);
        }
        frameAt = -1;
      } else if (i.opcode === OP.JMP || i.opcode === OP.JMPNZ || i.opcode === OP.RET || i.opcode === OP.CALLE) {
        complex = true;
      } else if (i.opcode === OP.MOVE || i.opcode === OP.PUSHREFSTORE) {
        complex = true;
      }
    }
  }
}

function gatherSignatures(files) {
  const slots = new Map(); // slot -> Map<sigKey, count>
  const fnByCaller = new Map(); // slot -> Set<callerFnName>
  let calls = 0, parsed = 0, errored = 0;
  for (const f of files) {
    try {
      const ipo = parseIpo(new Uint8Array(readFileSync(f)));
      parsed++;
      analyzeFile(ipo, (slot, pushes, callerName) => {
        const ins = pushes.filter(p => p.k === 'v').length;
        const refs = pushes.filter(p => p.k === 'r').length;
        // Build a typed signature with positional types.
        const sig = pushes.map(p => p.k === 'r' ? 'R' : p.t).join('');
        const key = `${ins},${refs},${sig}`;
        let b = slots.get(slot);
        if (!b) { b = new Map(); slots.set(slot, b); }
        b.set(key, (b.get(key) ?? 0) + 1);
        let s = fnByCaller.get(slot);
        if (!s) { s = new Set(); fnByCaller.set(slot, s); }
        if (s.size < 8) s.add(callerName);
        calls++;
      });
    } catch { errored++; }
  }
  return { slots, fnByCaller, parsed, errored, calls };
}

function parseHeader(path) {
  const text = readFileSync(path, "utf8").replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  const re = /\bextern\s+(\w+)\s*\(([^;]*)\)\s*;/g;
  const out = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    const name = m[1];
    const args = m[2].trim();
    let ins = 0, refs = 0;
    const types = [];
    if (args) {
      for (const p of args.split(",").map(s => s.trim()).filter(Boolean)) {
        const parts = p.split(/\s+/);
        const dir = parts[0].toLowerCase().replace(/:$/, "");
        const type = (parts[1] ?? "").toLowerCase().replace(/:$/, "");
        const tch = type.startsWith("string") ? 's' :
                    type.startsWith("int") ? 'i' :
                    type.startsWith("real") ? 'r' :
                    type.startsWith("long") ? 'l' :
                    type.startsWith("byte") ? 'b' :
                    type.startsWith("bool") ? 'B' :
                    type === 'menu' || type === 'screen' || type === 'statemachine' || type === 'state' ? 'i' : '?';
        if (dir === "in") { ins++; types.push(tch); }
        else { refs++; types.push('R'); }
      }
    }
    out.push({ name, ins, refs, sig: args, types: types.join('') });
  }
  return out;
}

const sgdat = "/Users/mjaskols/Downloads/inpa/NCSEXPER/SGDAT";
const allFiles = readdirSync(sgdat).filter(f => /\.ipo$/i.test(f)).map(f => join(sgdat, f));
const cabiFiles = allFiles.filter(f => /\/A_[^/]+\.ipo$/i.test(f));
const otherFiles = allFiles.filter(f => !/\/A_[^/]+\.ipo$/i.test(f));

console.log(`# total IPOs: ${allFiles.length}, A_*: ${cabiFiles.length}, other: ${otherFiles.length}\n`);

const cabi = parseHeader("/Users/mjaskols/Downloads/inpa/NCSEXPER/SGDAT/CABI.H");
const inpa = parseHeader("/Users/mjaskols/Downloads/inpa/NCSEXPER/SGDAT/Inpa.h");
console.log(`# cabi.h: ${cabi.length}, inpa.h: ${inpa.length}\n`);

function reportTable(label, group, headerDecls) {
  const { slots, fnByCaller, parsed, errored, calls } = gatherSignatures(group);
  console.log(`\n========== ${label} ==========`);
  console.log(`# parsed: ${parsed} (${errored} errored), sys calls: ${calls}, distinct slots: ${slots.size}`);

  // Build a header shape index keyed by typed signature.
  const byTypeSig = new Map(); // typedSig -> Set<name>
  const byCounts = new Map();  // `in,ref` -> Set<name>
  for (const d of headerDecls) {
    let s = byTypeSig.get(d.types); if (!s) { s = new Set(); byTypeSig.set(d.types, s); } s.add(d.name);
    const k = `${d.ins},${d.refs}`;
    let s2 = byCounts.get(k); if (!s2) { s2 = new Set(); byCounts.set(k, s2); } s2.add(d.name);
  }

  const unique = [], ambiguous = [], unmatched = [];
  for (const [slot, bucket] of [...slots].sort((a, b) => a[0] - b[0])) {
    const total = [...bucket.values()].reduce((a, b) => a + b, 0);
    const sorted = [...bucket.entries()].sort((a, b) => b[1] - a[1]);
    const [topKey, topCount] = sorted[0];
    if (total < 5 || topCount / total < 0.5) continue;
    const [ins, refs, typedSig] = topKey.split(',');
    const candidatesByType = [...(byTypeSig.get(typedSig) ?? new Set())];
    const candidatesByCount = [...(byCounts.get(`${ins},${refs}`) ?? new Set())];
    if (candidatesByType.length === 1) {
      unique.push({ slot, name: candidatesByType[0], samples: total, conf: topCount/total, typedSig });
    } else if (candidatesByType.length > 1) {
      ambiguous.push({ slot, typedSig, samples: total, candidates: candidatesByType });
    } else if (candidatesByCount.length === 1) {
      unique.push({ slot, name: candidatesByCount[0], samples: total, conf: topCount/total, typedSig, note: 'count-only' });
    } else if (candidatesByCount.length > 1) {
      ambiguous.push({ slot, typedSig, samples: total, candidates: candidatesByCount, note: 'count-only' });
    } else {
      unmatched.push({ slot, typedSig, samples: total });
    }
  }
  console.log(`# unique: ${unique.length}, ambiguous: ${ambiguous.length}, unmatched: ${unmatched.length}\n`);
  console.log("--- unique ---");
  for (const u of unique) console.log(`0x${u.slot.toString(16).padStart(2,'0')} = ${u.name.padEnd(28)} sig=${u.typedSig.padEnd(8)} (${u.samples} samples${u.note ? ", "+u.note : ""})`);
  console.log("\n--- ambiguous (sig matches multiple .h declarations) ---");
  for (const a of ambiguous) console.log(`0x${a.slot.toString(16).padStart(2,'0')} sig=${a.typedSig.padEnd(8)} (${a.samples} samples${a.note ? ", "+a.note : ""})  candidates: ${a.candidates.join(" | ")}`);
  console.log("\n--- unmatched ---");
  for (const u of unmatched) console.log(`0x${u.slot.toString(16).padStart(2,'0')} sig=${u.typedSig.padEnd(8)} (${u.samples} samples)`);
}

reportTable("CABI runtime (A_*.ipo)", cabiFiles, [...cabi, ...inpa]);
reportTable("INPA runtime (others)", otherFiles, [...inpa, ...cabi]);
