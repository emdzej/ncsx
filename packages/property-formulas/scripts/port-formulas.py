"""Port NCS Dummy Formulas.cs → TS. Handles multi-line byte-array literals."""
import re, sys

SRC = open('/Users/mjaskols/Projects/my/ncsx-research/ncsdummy-src/NcsDummy/Classes/Formulas/Formulas.cs').read()

# Brace-balanced extraction of `switch (keyword) { ... }`.
m = re.search(r'switch \(keyword\)\s*\{', SRC)
start = m.end()
depth = 1; i = start; in_str = False; esc = False
while i < len(SRC) and depth > 0:
    ch = SRC[i]
    if esc: esc=False; i+=1; continue
    if ch=='\\' and in_str: esc=True; i+=1; continue
    if ch=='"': in_str=not in_str; i+=1; continue
    if not in_str:
        if ch=='{': depth+=1
        elif ch=='}':
            depth-=1
            if depth==0: break
    i+=1
body = SRC[start:i]

# Pre-process: collapse multi-line `new byte[N] { ... }` to single-line.
# Also `new byte[N]\n{` (C# allows brace on its own line).
def collapse_byte_arrays(s):
    # Walk through and rewrite each `new byte[\d*]` occurrence — find the matching `}`
    # and collapse to single line.
    out = []
    i = 0
    while i < len(s):
        m = re.search(r'new\s+byte\[\d*\]', s[i:])
        if not m:
            out.append(s[i:])
            break
        start_idx = i + m.start()
        end_decl = i + m.end()
        out.append(s[i:start_idx])
        # Skip whitespace/newlines after the declaration looking for `{`.
        j = end_decl
        while j < len(s) and s[j] in ' \t\r\n': j += 1
        if j >= len(s) or s[j] != '{':
            out.append(s[start_idx:j])
            i = j
            continue
        # Find matching `}` with brace tracking.
        depth = 1
        k = j + 1
        while k < len(s) and depth > 0:
            if s[k] == '{': depth += 1
            elif s[k] == '}':
                depth -= 1
                if depth == 0: break
            k += 1
        # Replace the whole `new byte[N] { ... }` block with single-line form.
        inner = s[j+1:k]
        # Normalize whitespace: collapse runs to single space, strip.
        inner = re.sub(r'\s+', ' ', inner).strip()
        out.append(f'new byte[] {{ {inner} }}')
        i = k + 1
    return ''.join(out)

body = collapse_byte_arrays(body)

# Now line-by-line case-splitting as before.
def line_open_close(line):
    o=c=0; in_s=False; e=False
    for ch in line:
        if e: e=False; continue
        if ch=='\\' and in_s: e=True; continue
        if ch=='"': in_s=not in_s; continue
        if in_s: continue
        if ch=='{': o+=1
        elif ch=='}': c+=1
    return o,c

lines = body.splitlines()
n = len(lines)
groups = []
i = 0
depth = 0
while i < n:
    stripped = lines[i].strip()
    m_case = re.match(r'^case\s+"([^"]+)"\s*:\s*$', stripped)
    if depth == 0 and m_case:
        keys = []
        while i < n:
            l2 = lines[i].strip()
            mc = re.match(r'^case\s+"([^"]+)"\s*:\s*$', l2)
            if not mc: break
            keys.append(mc.group(1)); i += 1
        body_lines = []
        while i < n:
            l2 = lines[i]
            o, c = line_open_close(l2)
            ls = l2.strip()
            if depth == 0:
                if re.match(r'^case\s+"[^"]+"\s*:\s*$', ls): break
                if ls.startswith('default:'): break
            body_lines.append(l2)
            depth += o - c
            i += 1
        groups.append((keys, body_lines))
        continue
    if depth == 0 and stripped.startswith('default:'): break
    o, c = line_open_close(lines[i])
    depth += o - c
    i += 1

def translate(c_lines):
    out = []
    for ln in c_lines:
        if ln.strip() == '':
            out.append(''); continue
        leading_m = re.match(r'^[\s]*', ln)
        leading = leading_m.group(0).replace('\t', '  ')
        r = ln[len(leading_m.group(0)):]

        r = re.sub(r'\bdata\b', 'ctx.data', r)
        r = re.sub(r'\bmask\b', 'ctx.mask', r)
        r = re.sub(r'\bchassis\b', 'ctx.chassis', r)
        r = re.sub(r'\bmodule\b', 'ctx.module', r)
        r = re.sub(r'\bcodingindex\b', 'ctx.codingIndex', r)

        r = r.replace('PrintNumber(', 'printNumber(')
        r = r.replace('GetFloat_0_128(', 'getFloat0_128(')
        r = r.replace('GetFloat_Neg128(', 'getFloatNeg128(')
        r = r.replace('GetFloat_Neg8(', 'getFloatNeg8(')
        r = r.replace('GetFloat(', 'getFloat(')
        r = r.replace('GetString(', 'getString(')
        r = r.replace('Reverse(', 'reverse(')
        r = r.replace('Invert(', 'invert(')
        r = r.replace('Math.Pow(', 'pow(')

        r = r.replace('.Length', '.length')

        r = re.sub(r'ctx\.data\s*==\s*null\s*\|\|\s*ctx\.data\.length\s*==\s*0',
                   'ctx.data.length === 0', r)

        r = re.sub(r'(?<![=!<>])==(?!=)', '===', r)
        r = re.sub(r'(?<![=!<>])!=(?!=)', '!==', r)

        r = re.sub(r'(\d)(f|F|d|D|m|M)\b', r'\1', r)
        r = re.sub(r'(\d\.\d+)(f|F|d|D|m|M)\b', r'\1', r)

        # Now that byte arrays are single-line, this regex catches them all.
        r = re.sub(r'new\s+byte\[\d*\]\s*\{\s*([^}]*)\s*\}', r'Uint8Array.from([\1])', r)
        r = re.sub(r'string\.IsNullOrEmpty\(([^)]+)\)', r'!\1', r)
        r = re.sub(r'\((?:int|byte|ushort|uint|float|double|short)\)', '', r)

        out.append(leading + r)
    return out

out = []
out.append('// AUTO-GENERATED from NCS Dummy Classes/Formulas/Formulas.cs.')
out.append('// 1055 case arms in the original switch → this dispatch table.')
out.append('//')
out.append("import type { Formula } from './types.js';")
out.append("import {")
out.append("  getFloat,")
out.append("  getFloat0_128,")
out.append("  getFloatNeg128,")
out.append("  getFloatNeg8,")
out.append("  getString,")
out.append("  invert,")
out.append("  pow,")
out.append("  printNumber,")
out.append("  reverse,")
out.append("} from './helpers.js';")
out.append('')
out.append("export const FORMULAS = new Map<string, Formula>();")
out.append('')
out.append("function reg(keys: string[], fn: Formula): void {")
out.append("  for (const k of keys) FORMULAS.set(k, fn);")
out.append("}")
out.append('')
out.append("// ── PORTED FORMULAS START ──")
out.append('')

for keys, body_lines in groups:
    keys_repr = ', '.join(f"'{k}'" for k in keys)
    out.append(f"reg([{keys_repr}], (ctx) => {{")
    for tl in translate(body_lines):
        out.append('  ' + tl if tl else '')
    out.append("});")
    out.append('')

out.append(f"// Generated {len(groups)} formula groups from {sum(len(k) for k, _ in groups)} case arms.")
print('\n'.join(out))
