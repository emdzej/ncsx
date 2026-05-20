import { readFileSync } from "node:fs";
import { parseIpo } from "@emdzej/inpax-parser";

const OP = {
  1:"LOAD",2:"PUSHREF",3:"LOADINOUTREF",4:"NOP",5:"MOVE",6:"PUSHR",
  7:"PUSHREFSTORE",8:"ALLOC",9:"ALU",10:"JMP",11:"JMPNZ",
  12:"CALL",13:"CALLE",14:"RET",15:"FRAME",16:"LOGTABLE",17:"PUSHIMM",
};

const path = process.argv[2];
const findFn = process.argv[3];
const fromPc = Number(process.argv[4] ?? 0);
const toPc = Number(process.argv[5] ?? 200);
const bytes = new Uint8Array(readFileSync(path));
const ipo = parseIpo(bytes);

console.log("globals:", ipo.globals.types.length, " constants:", ipo.constants.values.length);

for (const [, fn] of ipo.functions) {
  if (findFn && fn.header.name !== findFn) continue;
  console.log("\n--- " + fn.header.name + " (id=" + fn.header.blockId + ", instrs=" + fn.instructions.length + ") pc " + fromPc + ".." + Math.min(toPc, fn.instructions.length) + " ---");
  for (let pc = fromPc; pc < Math.min(toPc, fn.instructions.length); pc++) {
    const i = fn.instructions[pc];
    const opName = OP[i.opcode] || "?";
    const o1 = "0x" + i.operand1.toString(16);
    const o2 = "0x" + i.operand2.toString(16);
    let hint = "";
    if (i.opcode === 12) {
      hint = i.operand1 === 0x81 ? "sys " + o2 :
             i.operand1 === 0x80 ? "user fn " + o2 : o1 + " " + o2;
    } else if (i.opcode === 1) {
      const sc = ["?","Const","Local","Global","Screen","Menu","StateMachine"];
      const scName = sc[i.operand1] || "?";
      const cv = i.operand1 === 1 ? " = " + JSON.stringify(ipo.constants.values[i.operand2] && ipo.constants.values[i.operand2].value) : "";
      hint = scName + "[" + o2 + "]" + cv;
    } else if (i.opcode === 13) {
      hint = "import const=" + i.operand2 + " name=" + JSON.stringify(ipo.constants.values[i.operand2] && ipo.constants.values[i.operand2].value);
    }
    console.log("  pc=" + pc.toString().padStart(3) + " " + opName.padEnd(13) + " o1=" + o1.padStart(4) + " o2=" + o2.padStart(5) + "  " + hint);
  }
}
