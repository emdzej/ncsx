# `.ssd` / ZUT record format

The `[VERIFIKATION].SteuerFileName` profile setting points to a `.ssd` file. In **NCSEXPER 4.0.1** (the larger 10 MB build we have in Ghidra), the verifier is the **ZUT subsystem** (`ZUT_PROC.C`, strings at `0x006020f0..`) — not the older `CCreateJobCond`/`CJobCond` engine that appeared in earlier (smaller) builds. The two were replaced by `VFP` ("Verfahrensprüfung") and `ZUT` ("ZCS-Update-Tabelle") in this version.

## 1. File container

`.ssd` is **plain text** with record-per-line semantics. Each line begins with a record-tag token; the rest of the line carries the record's fields. The lexer skips blanks and comments (`;` and `//` per the rest of the DATEN text family — to be confirmed against a real `.ssd` sample, which isn't shipped with the stock install).

## 2. Record tags

Discovered from the `RecFncZUT*` handler-string table in `.rdata` (`0x00602148..0x00602294`), each tag dispatched to a Ghidra function near `FUN_0043d060+`:

| Record tag       | Handler                | Fields read by the handler                          |
|------------------|------------------------|-----------------------------------------------------|
| `DATEINAME`      | `RecFncZUTDateiname`   | filename of the SG/CABD this record group targets   |
| `BAUREIHE`       | `RecFncZUTBaureihe`    | chassis (E46, E89, …)                               |
| `SGNAME`         | `RecFncZUTSgName`      | logical SG short-name                               |
| `ID_CODIERINDEX` | `RecFncZUTIdCodierindex` | match when the read CI value equals this           |
| `NO_CODIERINDEX` | `RecFncZUTNoCodierindex` | match when the read CI value differs               |
| `ID_HARDWARENR`  | `RecFncZUTIdHardwareNr`  | match on hardware-number equality                  |
| `NO_HARDWARENR`  | `RecFncZUTNoHardwareNr`  | match on hardware-number inequality                |
| `ID_SOFTWARENR`  | `RecFncZUTIdSoftwareNr`  | match on software-number equality                  |
| `NO_SOFTWARENR`  | `RecFncZUTNoSoftwareNr`  | match on software-number inequality                |
| `ID_VERSIONSNR`  | `RecFncZUTIdVersionsNr`  | match on version-number equality                   |
| `NO_VERSIONSNR`  | `RecFncZUTNoVersionsNr`  | match on version-number inequality                 |
| `MASKE`          | `RecFncZUTMaske`         | bit mask applied to a byte/word during the update  |
| `UMRECHNUNG`     | `RecFncZUTUmrechnung`    | conversion rule (likely the same syntax as CABD `OPERATION` — to confirm) |

## 3. Handler structure (from Ghidra `RecFncZUTDateiname`)

Each handler is a small function with this shape (decompiled `FUN_0043d060` for `DATEINAME`):

```c
void RecFncZUTDateiname(void)
{
  char buf[64];
  // FUN_00455250 = read a named field from the current record into `buf`
  short status = FUN_00455250(&FIELD_NAME_STR, buf, 64);
  if (status != 0) {                              // field missing or syntax error
    LogError(0x1177, 0, "ZUT_PROC.C", "RecFncZUTDateiname", 1);
    return;
  }
  if (TRACE_ENABLED == 1) {
    fprintf(TRACE_FILE, "DATEINAME                       %s\n", buf);
  }
}
```

So each handler:
1. Reads the named field from the record (via `FUN_00455250(field_name, dest, max_len)`).
2. Logs an error on parse failure with code `0x1177` / `0x1178` etc. (per-handler).
3. Optionally writes a `DATEINAME <value>` line to the trace file if `[Trace].ZutTrace = ON`.
4. Stores the parsed value in process state (struct offset depending on tag).

`MASKE` and `UMRECHNUNG` handlers are wider — they additionally parse the value (bit mask byte string for `MASKE`, operation list for `UMRECHNUNG`) into the same on-disk forms used elsewhere in DATEN.

## 4. Companion subsystems

| Subsystem | Source module | What it does |
|-----------|---------------|--------------|
| **ZUT**   | `ZUT_PROC.C`  | Re-applies ZCS-update-table rules after coding (when `[VERIFIKATION].ZutEin=1` and `[CODING].ZcsutLesen=1`). Reads `.ssd` script + `<BR>ZCSUT.000`. |
| **VFP**   | `VFP_PROC.C`  | Verfahrensprüfung — formal coding verification ("did the SG end up with the bits we expected"). Class `CVfp`, dialog `CEditVfpDlg`. |
| **FA / ASW record handlers** | (same family) `RecFncAuftrag`, `RecFncAsw` | `.ssd` files can also carry FA and ASW records — same dispatch mechanism, different state targets. |

## 5. Earlier-build verifier (`CCreateJobCond` / `CJobCond` / `CReadErrCond`)

Smaller / earlier NCSEXPER images (around 4 MB `.text`) shipped a different verifier: a job-condition runtime built on the `CCreateJobCond` / `CJobCond` / `CReadErrCond` C++ classes (debug strings:
`WARNING:CCreateJobCond: Syntax : Line is Empty--Leaving`,
`FATAL:CCreateJobCond: Out of Memory`,
`NOTE:CJobCond: Starting Job: "%s"; Device: "%s"; Params: "%s"...`).

That verifier consumed the same `.ssd` file extension but with a different grammar — likely line-oriented `<SGBD> <JOB> <params> <expected-result>` tuples. The current build replaced it with the ZUT/VFP split.

## 6. Open items

- **Field-separator and value syntax** for each ZUT record — Ghidra-traceable, but easier with a real `.ssd` sample. None ship with the stock install; the user supplies one per coding session via the profile editor.
- **Full `MASKE` / `UMRECHNUNG` value syntax** — likely re-uses the CABD `OPERATION` and mask formats documented in [`daten-format.md` §1.7](daten-format.md#17-the-a-length-prefixed-bytes-field). Verify by tracing `RecFncZUTMaske` and `RecFncZUTUmrechnung`.
- **Output trace location** — `ZUT.OUT` (string `0x005deaf8`) is the runtime output; `[Trace]` settings control whether it's written.
- **`HandleZutChange` error path** — `Fehler bei HandleZutChange: %s\n` (string `0x005e0eb4`) is the dialog error site. Find it in Ghidra for a full picture of ZUT lifecycle.
