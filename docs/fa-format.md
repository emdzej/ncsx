# FA (Fahrzeugauftrag) wire format, AT dictionary, and write paths

What a BMW FA actually looks like end-to-end: the human-friendly chip
list the user edits, the marker-classified string on the wire, the
typed struct FA.PRG decodes it into, and which `<BR>AT.000` slice
serves as the dictionary for each constituent.

Empirical evidence is from E46 (`E46AT.000`, `A_AKMB46.ipo`,
`A_LSZ.ipo`, `A_GM5.ipo`, real bench-ECU traces). Other chassis
families differ in marker assignments and dictionary coverage — call
out the deltas when you see them.

## 1. The wire string — what's in `FA_STREAM`

A read FA, as it comes back from FA.PRG's `FA_STREAM2STRUCT` job in
the `STANDARD_FA` result field:

```
E46_#0303*BW32%0A08&N6TT|7531125|7529012$205$210$226 … $880
```

Each constituent is introduced by a single **marker char** that
classifies it. The marker is the *only* signal that says "this token
is a paint code, not an SA". The AT category does **not** tell you —
multiple AT categories map to the same marker, and the same code
shape can appear under different markers on different chassis.

| Marker | Constituent | Example | FA_STREAM2STRUCT field |
|--------|-------------|---------|------------------------|
| `_`    | Baureihe / chassis (terminator after `BR`) | `E46_` | `BR` |
| `#`    | C_DATE — production-update revision (Stand) | `#0303` | `C_DATE` |
| `*`    | C_TYP — model variant code | `*BW32` | `C_TYP` |
| `%`    | LACK — paint code | `%0A08` | `LACK` |
| `&`    | POLSTER — upholstery code | `&N6TT` | `POLSTER` |
| `\|`   | ZUSBAU_n — sales/build order numbers (multi) | `\|7531125\|7529012` | `ZUSBAU_1`/`ZUSBAU_2`/… |
| `$`    | SA_n — special equipment (multi) | `$205$210` | `SA_1`/`SA_2`/… |

Other markers observed in `tokenize.ts` and in `convertFzgAuftragString`
(`FUN_00450180`) but not seen in E46 sample data: `+`, `-`. Treat as
"reserved — pass through verbatim" until a chassis shows them in use.

### 1.1 `#` is the exception: marker is part of the token

`tokenizeFa` strips `_ $ & % | * + -` from token starts but
**preserves** `#`. Reason: AT records key date codes by their `#`-
prefixed form (`Z #0303` — the file literally stores `#0303` as the
code, not `0303`). Keeping the `#` in the token makes the AT lookup
work without a special case.

Practical consequence for any FA emitter: when you're rebuilding the
wire string, `#`-prefixed tokens emit *bare* (the `#` is both the
separator and the start-of-name). Prepending another marker yields
`$#0303` — FA.PRG rejects that with `ERROR_SA` because the `$` says
"SA code" but `#0303` isn't one.

### 1.2 The `BR` prefix is sometimes doubled in raw IPO output

`FAHRZEUGAUFTRAG` (raw binary from `C_FA_LESEN`) sometimes encodes
the chassis code twice: once as the `BR` field, once again as the
first `$`-marked token. FA.PRG's `STANDARD_FA` reconstruction drops
the duplicate. If you ever read FA via a path that bypasses
`FA_STREAM2STRUCT`, expect to see `E46_$E46$BW32…` and de-duplicate
yourself.

## 2. Decoded struct — `FA_STREAM2STRUCT` result

The FA.PRG meta-SGBD has a `FA_STREAM2STRUCT` job (callable via
`apiJob("FA", "FA_STREAM2STRUCT", "1;<binary FA bytes>", "")`) that
takes the binary `FAHRZEUGAUFTRAG` from a target SGBD and returns:

```
VERSION       = "02"
BR            = "E46_"
C_DATE        = "0303"
C_TYP         = "BW32"
LACK          = "0A08"
POLSTER       = "N6TT"
ZUSBAU_1      = "7531125"
ZUSBAU_2      = "7529012"
SA_1          = "205"
SA_2          = "210"
…
SA_36         = "880"
SA_ANZ        = 36
E_WORT_ANZ    = 0     // count of "E-Wort" (extra textual blocks)
HO_WORT_ANZ   = 0     // count of "HO-Wort" (high-order textual blocks)
ZUSBAU_ANZ    = 2
STANDARD_FA   = "E46_#0303*BW32%0A08&N6TT|7531125|7529012$205$210…$880"
JOB_STATUS    = "OKAY"
```

The inverse — `FA_STREAM_FOR_ECU` — takes a `STANDARD_FA`-shaped
string and produces the binary `FAHRZEUGAUFTRAG` that gets fed into
the target SGBD's `C_FA_AUFTRAG`. Failure modes:

- `ERROR_SA` — invalid SA token, double markers, or unknown SA code
- `ERROR_UNKNOWN_CONSTIT` — a token's marker doesn't match its value
  (e.g. `$BW32` says "SA code" but FA.PRG knows BW32 isn't one)

Both errors come up routinely when an FA editor flattens all markers
to `$` on rebuild. Don't do that. The FA editor in `apps/web` parses
into the typed struct on open and re-emits with per-slot markers.

## 3. AT.000 dictionary mapping per slot

`<BR>AT.000` is the **only chassis-shipped FA-token dictionary**. Each
record is `<category> <code> [FSW tokens] [// comment]` where
category is a single letter. Empirical breakdown for E46 (`E46AT.000`,
N=1 file, 684 records):

```
W numeric  419   SA codes (3-4 digit)
W alpha    208   mix: C_TYP codes + alpha SAs + POLSTER codes
H alpha     17   retrofit / dealer-installable variants
K alpha     11   retrofit special (Nokia, MAYDAY, LED retrofits…)
E alpha     10   "Entfällt" / placeholder
A alpha     10   ?
Z alpha      4   C_DATE (date-revision markers — `#`-prefixed)
K numeric    2
H numeric    2
E numeric    1
Z numeric    0
```

### 3.1 Slot → AT category mapping

| Slot | Dictionary in AT? | How to filter |
|------|-------------------|---------------|
| `BR` | n/a — chassis code, locked from FA | — |
| `C_DATE` | **Yes** — Z + `#`-prefix | `rec.category === "Z" && code.startsWith("#")` |
| `C_TYP`  | **Yes** — W + type-shape | `rec.category === "W" && /^[A-Z]{2}[A-Z0-9]{2}$/.test(code)` (BW32, EP31, BL91, AT11) |
| `LACK`   | **No** — paint codes aren't in AT | freehand text input |
| `POLSTER` | **No** — upholstery codes aren't in AT | freehand text input |
| `ZUSBAU_*` | **No** — 7-digit BMW order #s | freehand text input |
| `SA_*` | **Yes** — W minus type-shape | `rec.category === "W" && !TYP_RE.test(code) && !code.startsWith("#")` |

### 3.2 Why the type-shape heuristic works (and its limits)

C_TYP codes describe whole-vehicle variants (`E46 CABR M54B25 RL
DSC3…`) and share the 2-letter + 2-alphanumeric pattern. Counter-
examples to watch:

- Alpha-W codes like `1CA`, `L7BA`, `N6SW` are **not** type-shape
  (they start with a digit, or are 4 chars but not 2+2) — they land
  in the SA picker. Correct: `1CA` is a real SA, `L7BA` is a
  packaging code, `N6SW` happened to be a `POLSTER` value in another
  E46 sample but has no LACK/POLSTER entry in AT itself.
- `XA1`/`XB1`/`XC1` (special edition codes) are 3-char W and land in
  the SA picker. Correct — they ride the `$` marker on the wire.

If a chassis ships a C_TYP code that doesn't match `^[A-Z]{2}[A-Z0-9]{2}$`,
the heuristic misclassifies it as SA. Hasn't been observed on E46;
flag it when it bites.

### 3.3 The marker is set by SLOT, not by AT category

This is the critical invariant. The same code can legitimately appear
under different markers in different chassis (and historically: `N6SW`
under `&` POLSTER in one E46 read, under `$` SA in another). The FA
editor must decide the marker by which slot the user added the token
to, *not* by looking up the token's AT category. If you ever find
yourself writing `markerByCategory[at.get(tok).category]`, stop —
that's the round-trip bug that produced `ERROR_UNKNOWN_CONSTIT` until
the structured editor landed.

## 4. Two write styles — slot-driven vs param-driven

IPOs that publish `FGNR_SCHREIBEN` / `FA_WRITE` / `ZCS_SCHREIBEN`
divide into two implementation styles. Detection is by string-
searching the IPO bytes for the jobname (the literal appears in any
IPO that dispatches it, regardless of style). The styles differ in
how the IPO produces the bytes the SGBD writes:

### 4.1 Slot-driven (KMB on E46, most "coding-master" ECUs)

The IPO reads CABD-declared `PARZUWEISUNG_FSW1` slot tables keyed by
`C_S_AUFTRAG` to find which bytes in the netto each FAHRGESTELL_NR /
SA / ZCS field touches. It then dispatches the universal
`C_S_AUFTRAG` write via `CDHapiJobData(sgbd, "C_S_AUFTRAG", bytes,
len, "")` with the rebuilt netto.

Concretely for FGNR on KMB:
1. `CDHGetSystemData("FAHRGESTELL_NR")` → 18-char VIN+check
2. CABD `PARZUWEISUNG_FSW1` lookup for `C_S_AUFTRAG=FGNR_SCHREIBEN`
   → 18 FSW slots `FAHRGESTELL_NR[1..18]`
3. Read current netto via `C_S_LESEN`
4. Patch the 18 slots into the netto buffer
5. `CDHapiJobData(C_KMB46, C_S_AUFTRAG, patchedBytes, len, "")`
6. ECU verifies (post-write read-back); mismatch → `ERROR_VERIFY`

Other slot-driven IPOs we've inspected: `A_AKMB46.ipo` references
`FAHRGESTELL_NR_PRUEFSUMME` and walks `C_S_AUFTRAG`-keyed slot tables
identically.

### 4.2 Param-driven (LSZ, GM5, EWS — many "secondary" ECUs)

The IPO doesn't touch the slot machinery. It reads the VIN from the
host-seeded variable and passes it directly to a per-ECU `C_FG_AUFTRAG`
(or equivalent) job as a positional string parameter:

1. `CDHGetSystemData("FAHRGESTELL_NR")` → 18-char VIN
2. Validate length / checksum (some SGBDs do `strlen == 18`)
3. `CDHapiJob(C_LSZA, C_FG_AUFTRAG, vin, "")`

If the host doesn't seed `FAHRGESTELL_NR` into the system-data store,
step 1 returns `""` and the IPO dispatches `C_FG_AUFTRAG` with an
empty para → `ERROR_NUMBER_ARGUMENT`. **The IPO is correct**; the
host just needs to seed the right channel.

### 4.3 Mixed: KMB also reads from system-data

Even slot-driven KMB calls `CDHGetSystemData("FAHRGESTELL_NR")` to
build the FAHRGESTELL_NR[1..18] slot values. Without the seed it
writes garbage (or stale netto bytes) → `ERROR_VERIFY` from the ECU.
So **the system-data seed is required for both styles**, not optional.

## 5. Host-side seed channels

Two parallel host-managed stores; IPOs disagree on which to use, so
seed both when starting an identity write.

| Store | Set via | Read via | Used by |
|-------|---------|----------|---------|
| **System-data** | `CDHSetSystemData(name, value)` (slot 0x2C) | `CDHGetSystemData(name)` (slot 0x2D) | LSZ/GM5/EWS for `FAHRGESTELL_NR`; KMB for slot-value build; most "canonical" identity writes |
| **CABD-par** | `CDHSetCabdPar(name, value)` | `CDHGetCabdPar(name)` | FA_STREAM read/write path; some legacy IPOs; survives `coapiResetCabdPars`-style mid-IPO resets only when explicitly preserved (`APPLIKATION` is the one key NCSEXPER restores) |

Empirical mapping (`apps/web/src/lib/runtime.svelte.ts`):

| Job | Seed channels |
|-----|---------------|
| `FGNR_SCHREIBEN` | `CDHSetCabdPar` + `CDHSetSystemData`, both `FAHRGESTELL_NR = formatFahrgestellNr(vin)` |
| `ZCS_SCHREIBEN`  | `CDHSetCabdPar` × 3 (`GM_SCHLUESSEL`, `SA_SCHLUESSEL`, `VN_SCHLUESSEL`) — KMB's IPO reads via cabd-par, no system-data variant observed |
| `FA_WRITE`       | `CDHSetCabdPar("FA_STREAM", ...)` — confirmed sufficient by bench testing |
| every job        | `CDHSetCabdPar("APPLIKATION", chassis.code)` and `CDHSetCabdPar("JOBNAME", jobName)` defensively |

When an identity-write job lands on a new ECU/chassis we haven't
tested, dual-channel seed (cabd-par **and** system-data) is the safe
default — see the FGNR work for the cautionary tale where seeding
only cabd-par silently failed on LSZ/GM5 (`ERROR_NUMBER_ARGUMENT`) and
corrupted writes on KMB (`ERROR_VERIFY`).

## 6. Multi-target write — discovering candidate ECUs

A given identity value (VIN, FA, ZCS) is typically stored across
multiple ECUs on a single chassis (KMB + LCM + IKE + EWS + LSZ + …).
BMW's convention is that they should agree; writing to one and not
the others leaves the car in a mixed state.

Discovery technique used by the FA / FGNR write dialogs:

1. Enumerate every `SgfamRow` on the chassis that has both `cabd` and
   `sgbd` populated (drops abstract rows like `_NO_CIRCUIT_`).
2. For each candidate, load `<basename>.IPO` bytes via
   `loadIpoBytes()` (cheap — file read + parse-free).
3. Byte-search for the jobname string (`FGNR_SCHREIBEN`,
   `FA_WRITE`, `ZCS_SCHREIBEN`). IPO bytecode stores string constants
   as null-terminated ASCII in a constants section, so a naive
   substring search catches every dispatcher.

This catches **both** slot-driven and param-driven IPOs uniformly —
a CABD-PARZUWEISUNG scan would miss LSZ-style param-driven writers
because their CABDs declare no FSW slots for the field.

False positives (an IPO that contains the jobname string but doesn't
actually dispatch it) haven't been observed. If they appear, fall
back to parsing the IPO's `cabimain` dispatch table — but the bytes
to walk are well-bounded and the parser already exists for read flow.

## 7. References

- `apps/web/src/components/FaEditorDialog.svelte` — parser/emitter,
  slot-based UI, dictionary filters
- `apps/web/src/components/FgnrEditorDialog.svelte` — multi-target
  VIN write
- `apps/web/src/components/WriteTargetList.svelte` — shared
  checkbox-list + status-pill UI for identity writes
- `apps/web/src/lib/runtime.svelte.ts:329` — `FGNR_SCHREIBEN` seed
  (both stores), `FA_WRITE` seed (cabd-par only), `ZCS_SCHREIBEN`
  seed (3 keys via cabd-par)
- `docs/ncsexper-fahrgestell-nr-format.md` — Mod-36 algorithm and the
  GM5 C_FG_AUFTRAG SGBD-side gate
- `docs/daten-format.md §2.3` — AT.000 record syntax
- `packages/fa-asw/src/tokenize.ts` — `tokenizeFa` (`#` preservation
  rationale)
- `packages/identity/src/m36-checksum.ts` — Mod-36 checksum + 17-char
  → 18-char `formatFahrgestellNr`
