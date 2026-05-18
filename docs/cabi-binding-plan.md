# CABI binding plan — Phase 9

Mapping every function declared in NCSEXPER's `SGDAT/CABI.H` (97 externs) to an
existing ncsx package or a small new wrapper. This is the work needed to make CABI-style
IPO scripts run under the `@emdzej/inpax` interpreter — the Kernfunktionen runner of
[`user-flow.md`](user-flow.md) Phase 9.

Background: [`ipo-usage.md` §4](ipo-usage.md) explains how the bridge works. Short version:
the IPO emits opcode `0x0D CALLE` with a function name in the constant pool; the
interpreter resolves the name against an in-process **symbol table inside NCSEXPER.EXE
itself** — the `Cabiger.dll` / `CabiUS.dll` files only carry localised resource strings,
not function implementations. In ncsx we register TypeScript handlers in the inpax
interpreter's system-function table.

The contract is fully specified in `NCSEXPER/SGDAT/CABI.H` (391 lines, parameter
directions and types in C-header form). The 97 declared externs are the public API; this
plan adds any extra functions we find by scanning NCSEXPER.EXE's symbol-table strings —
see §"Inventory delta" at the end.

## Inventory by group

### 1. EDIABAS bridge — `api*` (10 functions)

Plain INPA-style EDIABAS calls. Already covered by `@emdzej/ediabasx` + inpax's
[`@emdzej/inpax-ediabasx-provider`](../../inpax/packages/ediabasx-provider/) — we just
need name aliases.

| CABI symbol      | Implementation                                         |
|------------------|--------------------------------------------------------|
| `apiInit`        | `ediabasx.init()` (provider already wires this)        |
| `apiEnd`         | `ediabasx.end()`                                       |
| `apiJob`         | `ediabasx.apiJob(sgbd, job, params, results)`          |
| `apiState`       | `ediabasx.apiState()`                                  |
| `apiResultInt`   | `ediabasx.apiResultInt(resultName, set)`               |
| `apiResultReal`  | `ediabasx.apiResultReal(resultName, set)`              |
| `apiResultText`  | `ediabasx.apiResultText(resultName, set)`              |
| `apiResultSets`  | `ediabasx.apiResultSets()` — number of result sets     |
| `apiErrorCode`   | `ediabasx.lastErrorCode()`                             |
| `apiErrorText`   | `ediabasx.lastErrorText()`                             |

**Effort:** ~30 LoC (thin aliases).

### 2. CDH EDIABAS bridge — `CDHapi*` (11 functions)

CDH variants of the api* family. Add ECU-scope state on top of plain EDIABAS calls (the
"current SG" tracked in a CDH session) so callers can omit the SGBD name on every call.

| CABI symbol              | Notes                                                |
|--------------------------|------------------------------------------------------|
| `CDHapiInit`             | Initialise CDH session — alias for `apiInit`         |
| `CDHapiEnd`              | alias for `apiEnd`                                   |
| `CDHapiJob`              | apiJob, but SGBD defaults to the current CDH SG      |
| `CDHapiJobData`          | apiJob with a binary-buffer param                    |
| `CDHapiCheckJobStatus`   | Wait for the EDIABAS job to finish                   |
| `CDHapiResultText`       | apiResultText, current set                           |
| `CDHapiResultInt`        | apiResultInt, current set                            |
| `CDHapiResultDigital`    | bool variant of apiResultInt                         |
| `CDHapiResultAnalog`     | apiResultReal                                        |
| `CDHapiResultBinary`     | apiResult into a CDHBinBuf handle                    |
| `CDHapiResultSets`       | apiResultSets                                        |

**Effort:** ~80 LoC. Needs a `CdhSession` struct holding `currentSgName`, `currentCabd`,
the active `EdiabasInterface`, and the in-progress `TraceOverlay`.

### 3. CDH coding — Activate/Inactivate / ChangePsw (8 functions)

Manipulate the in-memory FSW/PSW overlay. Maps to `@emdzej/ncsx-trace`'s
`applyFswPswTrace` / `TraceOverlayParameter.selected` direct mutations.

| CABI symbol            | TraceOverlay operation                                |
|------------------------|-------------------------------------------------------|
| `CDHActivateFsw`       | Find function by keyword, select its default PSW      |
| `CDHInactivateFsw`     | Find function, deselect all PSWs                      |
| `CDHActivateGrp`       | Activate every function under a group description    |
| `CDHInactivateGrp`     | Deactivate every function under a group               |
| `CDHActivateAllFsw`    | Walk overlay, activate every function                 |
| `CDHInactivateAllFsw`  | Walk overlay, deselect everything                     |
| `CDHChangePsw`         | Find function by FSW, set the named PSW as selected   |
| `CDHSaveFswPswList`    | Push a structural-clone snapshot of the overlay       |
| `CDHRestoreFswPswList` | Pop the snapshot                                      |

**Effort:** ~120 LoC + a small undo stack inside `CdhSession`.

### 4. CDH coding — CBD/data lookups (9 functions)

Pull FSW/PSW/group definitions out of the loaded CABD `.Cxx` catalog. All of this is in
`@emdzej/ncsx-function-list` and `@emdzej/ncsx-cabd`; we wrap with CDH-named adapters.

| CABI symbol                  | ncsx package call                                       |
|------------------------------|---------------------------------------------------------|
| `CDHSetCbdName`              | Resolve via `chassis.cabd.listModules()` + cache        |
| `CDHGetInfo`                 | Read SGID_HARDWARENUMMER / SWNUMMER / CODIERINDEX from FunctionList metadata |
| `CDHCheckIdent` / `CDHCheckIdent2` | Compare ID strings against `chassis.cabd` Info     |
| `CDHGetFswDataFromCbd`       | `functionList.items.find(i => i.kind==='function' && i.fswKeyword===…)` |
| `CDHGetFswPswDataFromCbd`    | Same + look up parameter                               |
| `CDHGetGrpDataFromCbd`       | Find group item                                        |
| `CDHGetNettoDataFromCbd`     | `coder.planCoding({…}).netto`                          |
| `CDHGetNettoMaskFromCbd`     | Compose mask bytes from overlay                        |

**Effort:** ~150 LoC.

### 5. CDH coding — pars + meta (6 functions)

| CABI symbol         | Notes                                              |
|---------------------|----------------------------------------------------|
| `CDHSetCabdPar`     | Set a byte-level CABD parameter                    |
| `CDHGetCabdPar`     | Get one byte-level CABD parameter                  |
| `CDHSetCabdWordPar` | Word-level setter                                  |
| `CDHGetCabdWordPar` | Word-level getter                                  |
| `CDHSetSgName`      | Set the active SG (resolves SGFAM/SGAUSWAHL)       |
| `CDHGetSgbdName`    | Return the active SG's SGBD (EDIABAS module name)  |

**Effort:** ~80 LoC. Most of these are property accessors on `CdhSession`.

### 6. CDH coding — BR / FA / CVT / ZCS (6 functions)

| CABI symbol              | ncsx call                                              |
|--------------------------|--------------------------------------------------------|
| `CDHGetBaureiheFromZcs`  | `resolveChassisCode(brRef, zcs-derived-code)`          |
| `CDHGetFswPswFromCvt`    | `buildOptionList(cvt)` + lookup                        |
| `CDHGetFswPswFromZcs`    | New: decode ZCS → FSW/PSW (see "Open" below)           |
| `CDHGetFaVersion`        | Constant or chassis-derived                            |
| `CDHGetAnzahlFaElemente` | `tokenizeFa(fa).length`                                |
| `CDHGetFaElement`        | Pick element by index from the tokenised FA            |

**Effort:** ~60 LoC (assuming ZCS-decode lands in `@emdzej/ncsx-fa-asw` separately —
currently open, see [`fa-asw/README.md`](../packages/fa-asw/README.md) §"What this doesn't do").

### 7. CDH coding — netto / SGET / sysdata (5 functions)

| CABI symbol               | Notes                                                |
|---------------------------|------------------------------------------------------|
| `CDHGetFswPswFromNettoData` | Decode netto bytes → FSW/PSW selections (reverse of code path) — `cabd.decodeField` per FSW row, then resolve PSW |
| `CDHReadSget`             | Wraps `chassis.sget` + `selectEcus()`                |
| `CDHGetSystemData`        | Get one of SGID_HARDWARENUMMER / SWNUMMER / CODIERINDEX |
| `CDHSetSystemData`        | Set the same — only meaningful when writing back to the ECU |
| `CDHIdReady`              | Return whether SG identification has been read       |

**Effort:** ~80 LoC.

### 8. CDH binary buffer (8 functions)

A simple byte-buffer ADT used to marshal raw bytes between IPO scripts and EDIABAS
results. Pure helpers — backing store is a `Map<handle, Uint8Array>` in `CdhSession`.

| CABI symbol              | Implementation                                       |
|--------------------------|------------------------------------------------------|
| `CDHBinBufCreate`        | Allocate buffer, return handle                       |
| `CDHBinBufDelete`        | Free handle                                          |
| `CDHBinBufWriteByte`     | `buf[pos] = val`                                     |
| `CDHBinBufWriteWord`     | `(buf[pos], buf[pos+1]) = u16-LE-split(val)`         |
| `CDHBinBufReadByte`      | `val = buf[pos]`                                     |
| `CDHBinBufReadWord`      | `val = buf[pos] | (buf[pos+1] << 8)`                 |
| `CDHBinBufToStr`         | hex string                                           |
| `CDHBinBufToNettoData`   | Copy buffer into the overlay's netto image          |

**Effort:** ~60 LoC. No external dependencies.

### 9. CDH API job data (4 functions)

| CABI symbol            | Notes                                                  |
|------------------------|--------------------------------------------------------|
| `CDHResetApiJobData`   | Clear cached EDIABAS job result                        |
| `CDHGetApiJobData`     | Pull rows from cached job result                       |
| `CDHCheckDataUsed`     | Whether the script has consumed all rows               |
| `CDHGetApiJobByteData` | Byte-array variant of `CDHGetApiJobData`               |

**Effort:** ~40 LoC.

### 10. CDH error + flash + misc (6 functions)

| CABI symbol         | Notes                                                  |
|---------------------|--------------------------------------------------------|
| `CDHResetError`     | `session.lastError = null`                             |
| `CDHSetError`       | Push a structured error onto the session log           |
| `CDHTestError`      | Return + clear the last error code                     |
| `CDHSetReturnVal`   | Set the return value for the current IPO call          |
| `CDHSetDataOrg`     | Configure word-width / byte-order / address mode (mirrors `SPEICHERORG`) |
| `CDHDelay`          | Sleep N milliseconds (await `setTimeout`)              |

**Effort:** ~50 LoC.

### 11. CDH authentication (2 functions)

| CABI symbol              | Notes                                                |
|--------------------------|------------------------------------------------------|
| `CDHCallAuthenticate`    | Seed-and-key challenge with the SG. Needs the per-SG seed table; we'd punt this to a `CdhAuthProvider` interface and require the caller to supply a key-derivation function |
| `CDHAuthGetRandom`       | Fetch the random challenge bytes                     |

**Effort:** ~50 LoC + a `CdhAuthProvider` extension point. The actual seed→key logic for
each SG family is proprietary; ncsx ships only the protocol scaffolding.

### 12. Utilities — strings / files / timers / sim (14 functions)

| CABI symbol           | Implementation                                       |
|-----------------------|------------------------------------------------------|
| `exit`                | Signal IPO interpreter to halt                       |
| `inttostring`         | `String(n)`                                          |
| `realtostring`        | C-style sprintf format string → `value.toFixed(…)`   |
| `strcat`              | `a + b`                                              |
| `strlen`              | `s.length`                                           |
| `midstr`              | `s.slice(start, start+length)`                       |
| `hexconvert`          | `parseInt(hex, 16)` ↔ `n.toString(16)`               |
| `fileopen` / `fileclose` / `filewrite` | OPFS handle for browser, fs.write for Node — both abstracted behind a `FileSink` interface |
| `settimer` / `testtimer` | `Map<number, deadline>` in CdhSession            |
| `simnum` / `simdigital` | Simulation-mode value injection — for tests; no-op in production |
| `GetBinaryDataString` | Hex-encode a CDHBinBuf                               |

**Effort:** ~100 LoC. Most overlap inpax's existing helpers; rename + thin adapters.

### 13. String arrays (6 functions)

`StrArray*` — `Array<string>` ADT used by CDH calls that return multiple results.
Identical to the inpax string-array primitive if one exists; otherwise ~30 LoC.

| CABI symbol               | Implementation                                    |
|---------------------------|---------------------------------------------------|
| `StrArrayCreate`          | New handle → empty array                          |
| `StrArrayDestroy`         | Drop handle                                       |
| `StrArrayDelete`          | Remove one element                                |
| `StrArrayWrite`           | Set element by index                              |
| `StrArrayRead`            | Get element by index                              |
| `StrArrayGetElementCount` | `array.length`                                    |

**Effort:** ~30 LoC.

## Totals

| Group                                 | Functions | LoC est. |
|---------------------------------------|----------:|---------:|
| EDIABAS bridge (api*)                 | 10        | 30       |
| CDH EDIABAS bridge (CDHapi*)          | 11        | 80       |
| CDH coding — overlay mutations         | 8         | 120      |
| CDH coding — CBD lookups               | 9         | 150      |
| CDH coding — pars + meta              | 6         | 80       |
| CDH coding — BR / FA / CVT / ZCS       | 6         | 60       |
| CDH coding — netto / SGET / sysdata    | 5         | 80       |
| CDH binary buffer                      | 8         | 60       |
| CDH API job data                       | 4         | 40       |
| CDH error + flash + misc               | 6         | 50       |
| CDH authentication                     | 2         | 50       |
| Utilities                              | 14        | 100      |
| String arrays                          | 6         | 30       |
| **Total**                              | **95**    | **~930** |

(Two of the 97 CABI.H externs — `exit` and `apiInit` — overlap between groups and aren't
double-counted.)

## Package shape

```
packages/inpax-cabi-provider/
├── src/
│   ├── index.ts          — registerCabi(table, deps) entry point
│   ├── session.ts        — CdhSession (state container)
│   ├── api.ts            — group 1
│   ├── cdh-api.ts        — group 2
│   ├── overlay-ops.ts    — group 3 (Activate/Change/Save/Restore)
│   ├── cbd-lookups.ts    — group 4
│   ├── pars.ts           — group 5
│   ├── br-fa-zcs.ts      — group 6
│   ├── netto-sget.ts     — group 7
│   ├── bin-buf.ts        — group 8
│   ├── job-data.ts       — group 9
│   ├── misc.ts           — group 10
│   ├── auth.ts           — group 11
│   ├── utils.ts          — group 12
│   └── str-array.ts      — group 13
├── package.json
└── README.md
```

Deps:
- `@emdzej/inpax-providers` — system-function table type
- `@emdzej/ediabasx-ediabas` — EDIABAS API
- `@emdzej/ncsx-chassis`, `@emdzej/ncsx-function-list`, `@emdzej/ncsx-trace`,
  `@emdzej/ncsx-cabd`, `@emdzej/ncsx-coder`, `@emdzej/ncsx-fa-asw`, `@emdzej/ncsx-options`
- Workspace-internal; no new external deps.

## Inventory delta — CDH symbols found in NCSEXPER.EXE that are **not** in `CABI.H`

Walking NCSEXPER.EXE's trace-string section (`0x005af*` … `0x005b1*`) surfaces ~23
additional `CDH*` symbols beyond the 97 declared in `CABI.H`. None of them appear in the
public header, and a `strings` sweep across every shipped `.ipo` (NCSEXPER `SGDAT/` +
INPA `SGDAT/`) confirms that **shipped scripts don't call any of these** — only
`CDHapiResultSets` (which is in `CABI.H`) is referenced by name. Everything else IPOs
need they get via `api*` (EDIABAS) directly.

So these are NCSEXPER-internal COAPI helpers, not part of the public IPO surface. We
list them here for completeness; **we don't need to implement them for Phase 9** unless
a community script ends up using one (in which case the inpax interpreter will surface
the missing-symbol error and we can fill it in then).

| Symbol                          | Likely role                                                |
|---------------------------------|------------------------------------------------------------|
| `CDHGetCabdName`                | Get currently-loaded CABD name (used by COAPI internally)  |
| `CDHGetSgbdName` (duplicate)    | Already in CABI.H — same symbol                            |
| `CDHGetVmZcsProgName`           | Get VM (variant module) ZCS program name                   |
| `CDHGetVmGerName`               | Get VM-Gerät (variant module device) name                  |
| `CDHGetCodierBaureihe`          | Get the coding-target chassis (BR)                         |
| `CDHSetBaureihe`                | Set the active chassis from C++ code                       |
| `CDHSaveTmpFswPswList`          | Temp/scratch save (alongside the public `CDHSaveFswPswList`) |
| `CDHRestoreTmpFswPswList`       | Temp/scratch restore                                       |
| `CDHIntInit`                    | Internal: ZUT/VFP "integration" subsystem init             |
| `CDHIntSetMode`                 | Internal: integration mode setter                          |
| `CDHIntSetScriptFile`           | Internal: integration script file setter                   |
| `CDHIntTrigger`                 | Internal: integration trigger                              |
| `CDHSetNettoData`               | Direct netto-buffer setter                                 |
| `CDHSetNettoMaskData`           | Direct netto+mask setter                                   |
| `CDHGetNettoData`               | Direct netto-buffer getter                                 |
| `CDHGetReferenzDaten`           | Get reference dataset                                      |
| `CDHGetReferenzProgramm`        | Get reference program                                      |
| `CDHBinBufWrite`                | Generic bin-buffer write (vs `WriteByte` / `WriteWord` in CABI.H) |
| `CDHBinBufRead`                 | Generic bin-buffer read                                    |
| `CDHBinBufReadAt`               | Read at a specific position                                |
| `CDHBinBufSize`                 | Get buffer size                                            |
| `CDHBinBufAppend`               | Append bytes                                               |
| `CDHBinBufCopy`                 | Copy buffer                                                |
| `CDHApiInit` (Pascal-cased)     | Likely a duplicate symbol or alias for the public `CDHapiInit` (the only case-collision in the trace strings) |

### How we'll handle these in `inpax-cabi-provider`

The system-function table will throw `UnknownFunction("…")` if an IPO calls one of these.
For Phase 9 v1 we accept that and let the user file an issue. If a real script needs
one, we add a binding in a follow-up — by that point the implementation is usually
trivial (`CDHGetCabdName` is one line, `CDHGetNettoData` is `overlay.netto`, etc.).

A pragmatic shortcut: register a single fallback `(name, ctx) => { logUnimplemented(name); return null; }` adapter for the whole "internal CDH*" namespace so scripts limp along
instead of hard-failing. That way unsupported calls become warning lines in the log
rather than crashes.

### Where `api*` actually lives

The public `api*` family (`apiInit`, `apiJob`, …) in `CABI.H` resolves at runtime to
`api32.dll` exports — strings like `___apiResultChar@16`, `___apiResultByte@16`, …
appear at `0x005feb*` in NCSEXPER.EXE's `.idata`, which is the standard PE import-table
pattern for `__stdcall` symbols from another DLL. So:

- `CDH*` functions — implementations inside NCSEXPER.EXE itself.
- `api*` functions — re-exported by NCSEXPER.EXE but ultimately implemented in
  `api32.dll` (BMW's EDIABAS API library).

For ncsx, both groups land in our binding via `@emdzej/ediabasx` (api*) and the ncsx
packages (CDH*). The DLL boundary doesn't affect our TS shape — we register handlers
under both name spellings.

## Testing strategy

For each function group:

1. **Unit tests** with synthesized DATEN fixtures, asserting the binding produces the same
   return value the C# `Cabi*.dll` would. (The C# implementation is the spec.)
2. **Integration test** running an actual `.ipo` script that exercises the function and
   asserting on the resulting `TraceOverlay` or netto buffer.
3. **End-to-end test** running a real cabi-style IPO from `NCSEXPER/SGDAT/` (e.g.
   `00EK9272.ipo`) against a mock EDIABAS interface and verifying it completes
   successfully.

Most CABI functions don't need ECU access — they read DATEN or mutate the overlay — so
the test matrix is mostly offline. Only the `CDHapi*` group needs the wire layer.

## Open questions

1. **`CDHGetFswPswFromZcs`** — depends on a ZCS-decoder we haven't shipped yet. Punt to a
   second pass, or land it as part of this work? Looks like ~80 LoC since ZCS is mostly
   the same FA-token format with a different framing.
2. **`CDHCallAuthenticate`** — the seed→key derivation per SG family is proprietary BMW
   knowledge. Reasonable to scope ncsx to *protocol scaffolding* and require an external
   key-derivation provider (analogous to how OpenSSL ships protocol without certs)?
3. **`fileopen` / `fileclose` / `filewrite`** — in the browser, these need to write to
   OPFS or trigger a download. In Node, they can hit the real filesystem. Define a
   `FileSink` abstraction in the binding so both work? Inpax may already have one.
4. **Performance:** the inpax interpreter resolves function calls by string name; with
   ~100 CABI functions registered, the lookup map should still be O(1) but worth
   confirming the hot path isn't allocation-heavy.

## When this lands

`docs/user-flow.md` §6 phase plan: Phase 9 (Kernfunktionen runner). Not on the critical
path for the coding flow (Phases 4-8). When we start this work, the immediate next steps
are:

1. Scaffold `packages/inpax-cabi-provider` with `CdhSession` + the type definitions.
2. Implement groups 1, 8, 12, 13 first (no ncsx-package dependencies; pure adapters).
3. Add groups 2-7 as ncsx's wire layer + tracing matures.
4. Group 11 (auth) and the `ZCS` parts of group 6 last — they're least frequently used
   by community IPOs and need external inputs we don't ship.
