# NCSEXPER CABI syscalls — slot, signature, purpose

The 99 system functions NCSEXPER's IPO interpreter dispatches via
`CALL sys <id>` (opcode `0x0C`, flag `0x81`). Slot → name comes from
`ncsserv.exe`'s in-memory keyword table (1996 16-bit predecessor, same
v1.x VM as NCSEXPER's embedded interpreter — see
[`ncsexper-syscall-table.md`](ncsexper-syscall-table.md) for how the
table was extracted). Signatures come from `NCSEXPER/SGDAT/CABI.H` V2.0.
"Samples" is the count of `CALL sys N` observations across the 915 CABI
IPOs in `NCSEXPER/SGDAT` — `—` means we never observed that slot in the
wild (declared but unused by the shipping dispatchers).

Slot `0x0D` (`CDHapiJob`) is the load-bearing apiJob bridge that every
A_*.ipo coding/identity flow funnels through.


### Timers

| Slot | Name | Signature | Samples | Purpose |
|------|------|-----------|---------|---------|
| `0x00` | `settimer` | `in: int timernum, in: int timeval` | 3,896 | Start a countdown timer; pair with testtimer. |
| `0x01` | `testtimer` | `in: int timernum, out: bool expiredflag` | 3,215 | Returns true once the timer started by settimer has expired. |
| `0x5a` | `CDHDelay` | `in: int d` | 3,616 | Block for d milliseconds (CDH-side, doesn't yield to the screen executor). |

### Flow control

| Slot | Name | Signature | Samples | Purpose |
|------|------|-----------|---------|---------|
| `0x02` | `exit` | `()` | 4,172 | Terminate the IPO. RET-equivalent. |

### Type conversion

| Slot | Name | Signature | Samples | Purpose |
|------|------|-----------|---------|---------|
| `0x03` | `realtostring` | `in: real r, in: string format, out: string s` | — | Format a real as a string using a printf-like format. |
| `0x04` | `inttostring` | `in: int i, out: string s` | 7,165 | Format an int as a decimal string. |
| `0x05` | `hexconvert` | `in: string HexString, out: int high, out: int mid, out: int low, out: int seg` | 66 | Split a hex string into 16-bit chunks (high/mid/low/seg). |

### String ops

| Slot | Name | Signature | Samples | Purpose |
|------|------|-----------|---------|---------|
| `0x06` | `strcat` | `out: string DestStr, in: string SrcStr1, in: string SrcStr2` | 7,823 | Concatenate SrcStr1+SrcStr2 into DestStr. |
| `0x07` | `strlen` | `out: int len, in: string str` | 3,336 | Length of a string. |
| `0x08` | `midstr` | `out: string ResultStr, in: string SrcStr, in: int FirstIndex, in: int Count` | 1,002 | Substring at FirstIndex, Count characters. |

### File I/O

| Slot | Name | Signature | Samples | Purpose |
|------|------|-----------|---------|---------|
| `0x21` | `fileopen` | `in: string FileName, in: string OpenMode` | 107 | Open a file for write (OpenMode = 'w' / 'a'). |
| `0x22` | `fileclose` | `()` | 113 | Close the open file. |
| `0x23` | `filewrite` | `in: string str` | 110 | Append a string to the open file. |

### Simulation (user input)

| Slot | Name | Signature | Samples | Purpose |
|------|------|-----------|---------|---------|
| `0x09` | `simnum` | `out: real val, in: string BoxTitle, in: string BoxText, in: real minval, in: real maxval` | — | Prompt the user for a real value (range-checked) — diag-simulator UI. |
| `0x0a` | `simdigital` | `out: bool val, in: string BoxTitle, in: string BoxText, in: string FalseStr, in: string TrueStr` | — | Prompt the user for a bool (labelled with FalseStr/TrueStr). |

### EDIABAS via CDH error handling

| Slot | Name | Signature | Samples | Purpose |
|------|------|-----------|---------|---------|
| `0x0b` | `CDHapiInit` | `()` | 11,373 | Initialise EDIABAS via the CDH wrapper. Auto-handles errors into CDH state. |
| `0x0c` | `CDHapiEnd` | `()` | 907 | Shut down EDIABAS via CDH. |
| `0x0d` | `CDHapiJob` | `in: string ecu, in: string job, in: string para, in: string result` | 35,491 | Run an EDIABAS job, routing errors through CDH state. **The apiJob bridge used by every A_*.ipo coding flow.** Slot 0x0D is the load-bearing entry point. |
| `0x0e` | `CDHapiJobData` | `in: string ecu, in: string job, in: int BufHandle, in: int BufSize, in: string result` | 5,086 | Run an EDIABAS job with a binary buffer param (BufHandle/BufSize). |
| `0x0f` | `CDHapiResultText` | `out: string ResultText, in: string ApiResult, in: int ApiSet, in: string ApiFormat` | 38,156 | Read a string result by name + set, format-respecting. |
| `0x10` | `CDHapiResultInt` | `out: int ResultVal, in: string ApiResult, in: int ApiSet` | 18,478 | Read an int result by name + set. |
| `0x11` | `CDHapiResultSets` | `out: int sets` | 16 | Get count of result sets from the last job. |
| `0x12` | `CDHapiResultDigital` | `out: bool ResultVal, in: string ApiResult, in: int ApiSet` | — | Read a bool result by name + set. |
| `0x13` | `CDHapiResultAnalog` | `out: real ResultVal, in: string ApiResult, in: int ApiSet` | — | Read a real result by name + set. |
| `0x14` | `CDHapiResultBinary` | `in: int BufHandle, in: string ApiResult, in: int ApiSet, out: int RetVal` | 1,524 | Read a binary result into the named binary buffer. |
| `0x15` | `CDHapiCheckJobStatus` | `in: string RefStr` | — | Check JOB_STATUS against a reference string; populate CDH error if mismatch. |

### EDIABAS raw (1:1)

| Slot | Name | Signature | Samples | Purpose |
|------|------|-----------|---------|---------|
| `0x16` | `apiInit` | `out: bool rc` | — | Initialise EDIABAS, return rc directly. |
| `0x17` | `apiEnd` | `()` | — | Shut down EDIABAS. |
| `0x18` | `apiJob` | `in: string ecu, in: string job, in: string para, in: string result` | 552 | Run an EDIABAS job — bypasses the CDH error layer. |
| `0x19` | `apiState` | `out: int ApiState` | — | Read EDIABAS state (busy / idle / error). |
| `0x1a` | `apiResultText` | `out: bool rc, out: string ResultText, in: string ApiResult, in: int ApiSet, in: string ApiFormat` | 3,607 | Read string result, with rc. |
| `0x1b` | `apiResultInt` | `out: bool rc, out: int ResultVal, in: string ApiResult, in: int ApiSet` | 30 | Read int result, with rc. |
| `0x1c` | `apiResultSets` | `out: bool rc, out: int sets` | — | Result-set count, with rc. |
| `0x1d` | `apiResultReal` | `out: bool rc, out: real ResultVal, in: string ApiResult, in: int ApiSet` | — | Read real result, with rc. |
| `0x1e` | `apiErrorCode` | `out: int ErrorCode` | 374 | Last EDIABAS error code. |
| `0x1f` | `apiErrorText` | `out: string ErrorText` | 1,057 | Last EDIABAS error text. |

### Binary buffer

| Slot | Name | Signature | Samples | Purpose |
|------|------|-----------|---------|---------|
| `0x20` | `GetBinaryDataString` | `out: string DataString, out: int DataStringLen` | — | Read out the current binary data string + its length. |
| `0x4b` | `CDHBinBufCreate` | `out: int BufHandle, out: int RetVal` | 8,835 | Allocate a binary buffer; returns handle. |
| `0x4c` | `CDHBinBufDelete` | `in: int BufHandle, out: int RetVal` | 4,897 | Free a binary buffer. |
| `0x4d` | `CDHBinBufWriteByte` | `in: int BufHandle, in: int ByteVal, in: int Position, out: int RetVal` | 23,030 | Write a byte at Position. |
| `0x4e` | `CDHBinBufWriteWord` | `in: int BufHandle, in: int WordVal, in: int Position, out: int RetVal` | 1,509 | Write a 16-bit word at Position. |
| `0x4f` | `CDHBinBufReadByte` | `in: int BufHandle, out: int ByteVal, in: int Position, out: int RetVal` | 7,148 | Read a byte at Position. |
| `0x50` | `CDHBinBufReadWord` | `in: int BufHandle, out: int WordVal, in: int Position, out: int RetVal` | 30 | Read a 16-bit word at Position. |
| `0x51` | `CDHBinBufToStr` | `in: int BufHandle, out: string BinBufStr, out: int RetVal` | 156 | Serialise a binary buffer to a hex string. |

### String array

| Slot | Name | Signature | Samples | Purpose |
|------|------|-----------|---------|---------|
| `0x24` | `StrArrayCreate` | `out: bool rc, out: int hStrArray` | — | Allocate a string array; returns rc + handle. |
| `0x25` | `StrArrayDestroy` | `in: int hStrArray` | — | Free a string array. |
| `0x26` | `StrArrayWrite` | `in: int hStrArray, in: int index, in: string str` | — | Write string at index. |
| `0x27` | `StrArrayRead` | `in: int hStrArray, in: int index, out: string str` | — | Read string at index. |
| `0x28` | `StrArrayGetElementCount` | `in: int hStrArray, out: int ElementCount` | — | Element count of a string array. |
| `0x29` | `StrArrayDelete` | `in: int hStrArray` | — | Delete an element from a string array. |

### CDH error state

| Slot | Name | Signature | Samples | Purpose |
|------|------|-----------|---------|---------|
| `0x2b` | `CDHSetReturnVal` | `in: int Wert` | 19,613 | Set the per-IPO COAPI return code (CDH-side error state). |
| `0x52` | `CDHResetError` | `()` | — | Reset the CDH error state. |
| `0x53` | `CDHSetError` | `in: int ErrNr, in: string ModulName, in: string ProcName, in: int LineNr, in: string ErrorInfo` | 1,922 | Set a CDH error (ErrNr + module/proc/line + info). |
| `0x54` | `CDHTestError` | `out: int ErrNr` | 13,418 | Read current CDH error number (0 = no error). |

### CDH initialisation

| Slot | Name | Signature | Samples | Purpose |
|------|------|-----------|---------|---------|
| `0x2a` | `CDHGetFswPswFromZcs` | `in: string Gm, in: string Sa, in: string Vn, out: int RetVal` | — | Initialise CDH from a ZCS triple (GM/SA/VN). Also implicit CDHInit. |
| `0x30` | `CDHGetFswPswFromCvt` | `out: int RetVal` | — | Initialise CDH from the CVT (coding variant) table for the current chassis. |

### CDH data state

| Slot | Name | Signature | Samples | Purpose |
|------|------|-----------|---------|---------|
| `0x2c` | `CDHSetSystemData` | `in: string Bezeichner, in: string Wert, out: int RetVal` | 91 | Set a system data variable by name (used for VIN, build date, etc.). |
| `0x2d` | `CDHGetSystemData` | `in: string Bezeichner, out: string Wert, out: int RetVal` | 301 | Read a system data variable by name. |
| `0x47` | `CDHResetApiJobData` | `()` | 146 | Clear the per-job binary result buffer (between iterations). |
| `0x48` | `CDHGetApiJobData` | `in: int MaxData, in: int BufHandle, out: int BufSize, out: int NrOfData, out: int DataType, out: int RetVal` | 497 | Read raw binary result bytes from the last apiJob into a buffer. |
| `0x49` | `CDHCheckDataUsed` | `out: int RetVal` | 453 | Verify every byte of the binary result was consumed. |
| `0x4a` | `CDHBinBufToNettoData` | `in: int BufHandle, out: int RetVal` | 206 | Treat a BinBuf's contents as the netto-byte stream. |
| `0x55` | `CDHGetApiJobByteData` | `in: int MaxData, in: int BufHandle, out: int BufSize, out: int NrOfData, out: int RetVal` | 3,218 | Read raw byte result (typed) from the last apiJob. |

### CABD ↔ CDH parameter exchange

| Slot | Name | Signature | Samples | Purpose |
|------|------|-----------|---------|---------|
| `0x2e` | `CDHSetCabdPar` | `in: string Bezeichner, in: string Wert, out: int RetVal` | 55,196 | Set a CABD-side parameter (string) by name. |
| `0x2f` | `CDHGetCabdPar` | `in: string Bezeichner, out: string Wert, out: int RetVal` | 10,977 | Read a CABD-side parameter (string) by name. |
| `0x56` | `CDHSetCabdWordPar` | `in: string Bezeichner, in: int Wert, out: int RetVal` | 11,697 | Set a CABD-side parameter (16-bit word) by name. |
| `0x57` | `CDHGetCabdWordPar` | `in: string Bezeichner, out: int Wert, out: int RetVal` | 3,076 | Read a CABD-side parameter (16-bit word) by name. |

### SG resolution

| Slot | Name | Signature | Samples | Purpose |
|------|------|-----------|---------|---------|
| `0x31` | `CDHReadSget` | `out: string SgList, out: int RetVal` | 6 | Read the SG-Ermittlung result (which SGs are present). |
| `0x32` | `CDHSetSgName` | `in: string SgName, out: int RetVal` | 6 | Set the currently-active SG name (drives subsequent CDH state). |
| `0x33` | `CDHGetSgbdName` | `out: string SgbdName, out: int RetVal` | 12,448 | Get the resolved SGBD basename for the active SG. |

### Chassis (Baureihe)

| Slot | Name | Signature | Samples | Purpose |
|------|------|-----------|---------|---------|
| `0x34` | `CDHGetBaureiheFromZcs` | `in: string Gm, in: string Sa, in: string Vn, out: string Baureihe, out: int RetVal` | — | Derive chassis (baureihe) string from a ZCS triple. |

### FSW/PSW manipulation

| Slot | Name | Signature | Samples | Purpose |
|------|------|-----------|---------|---------|
| `0x35` | `CDHActivateFsw` | `in: string Fsw, out: int RetVal` | 22 | Activate (turn on) a function code (FSW). |
| `0x36` | `CDHInactivateFsw` | `in: string Fsw, out: int RetVal` | 62 | Deactivate a function code. |
| `0x37` | `CDHActivateGrp` | `in: string Gruppe, out: int RetVal` | 90 | Activate a whole group of FSWs. |
| `0x38` | `CDHInactivateGrp` | `in: string Gruppe, out: int RetVal` | 65 | Deactivate a whole group. |
| `0x39` | `CDHActivateAllFsw` | `()` | 314 | Activate every FSW in the active CBD. |
| `0x3a` | `CDHInactivateAllFsw` | `()` | 54 | Deactivate every FSW. |
| `0x3b` | `CDHChangePsw` | `in: string Fsw, in: string Psw, out: int RetVal` | — | Change the parameter value (PSW) attached to an FSW. |
| `0x3c` | `CDHSaveFswPswList` | `out: int RetVal` | — | Save the current FSW/PSW list to backup (for diff / undo). |
| `0x3d` | `CDHRestoreFswPswList` | `out: int RetVal` | — | Restore the FSW/PSW list from backup. |

### CBD / netto-byte stream

| Slot | Name | Signature | Samples | Purpose |
|------|------|-----------|---------|---------|
| `0x3e` | `CDHSetCbdName` | `in: string CbdName` | 1 | Set the active CBD (.Cxx) by name. |
| `0x3f` | `CDHGetInfo` | `in: string Bezeichner, in: int InfoNr, out: string Info, out: int NrOfInfo, out: int RetVal` | 2 | Read a named info attribute from the active CBD (multi-valued: pass InfoNr). |
| `0x40` | `CDHCheckIdent` | `in: string Bezeichner, in: string Id1, in: string Id2, out: int RetVal` | 176 | Verify identity match (Id1 == Id2 for the named anchor). |
| `0x41` | `CDHGetFswDataFromCbd` | `in: string Fsw, out: int RetVal` | 23 | Pull FSW data row from the active CBD by name. |
| `0x42` | `CDHGetFswPswDataFromCbd` | `in: string Fsw, in: string Psw, out: int RetVal` | — | Pull combined FSW+PSW data row from the active CBD. |
| `0x43` | `CDHGetGrpDataFromCbd` | `in: string Gruppe, out: int RetVal` | 9 | Pull group data from the active CBD. |
| `0x44` | `CDHGetNettoDataFromCbd` | `out: int RetVal` | 301 | Materialise the netto-byte stream from the active CBD's settings. |
| `0x45` | `CDHGetNettoMaskFromCbd` | `out: int RetVal` | 201 | Materialise the netto write-mask (which bits are coding-managed). |
| `0x46` | `CDHGetFswPswFromNettoData` | `in: string OutFileName, out: int RetVal` | 15 | Reverse: parse a netto-byte stream into FSW/PSW pairs, writing to OutFileName. |

### Flash programming

| Slot | Name | Signature | Samples | Purpose |
|------|------|-----------|---------|---------|
| `0x58` | `CDHGetReferenzProgramm` | `—` | — | [Not declared in CABI.H V2.0] — likely a flash-reference program lookup. |
| `0x59` | `CDHGetReferenzDaten` | `—` | — | [Not declared in CABI.H V2.0] — likely a flash-reference data lookup. |
| `0x5b` | `CDHSetDataOrg` | `in: int WortBreite, in: int ByteFolge, in: int AdrMode, out: int RetVal` | 81 | Configure flash data organisation: word-width, byte-order, addressing-mode. |

### SGVT identification

| Slot | Name | Signature | Samples | Purpose |
|------|------|-----------|---------|---------|
| `0x5c` | `CDHIdReady` | `out: bool IdReady` | — | Returns true once SGVT (SG variant table) identification is ready. |

### Authentication

| Slot | Name | Signature | Samples | Purpose |
|------|------|-----------|---------|---------|
| `0x5d` | `CDHCallAuthenticate` | `in: string SgFamilie, in: string UserId, in: string StgId, in: string Type, in: int SgrndHdl, in: string Level, in: int ResponseHdl, out: int ResponseLen, out: int RetVal` | 1,043 | Run the per-SG authentication challenge/response. |
| `0x62` | `CDHAuthGetRandom` | `out: string RndBin, out: string RndAsc` | 1,034 | Get the auth random (binary + ASCII forms) for a session. |

### FA (Fahrzeugauftrag) coding

| Slot | Name | Signature | Samples | Purpose |
|------|------|-----------|---------|---------|
| `0x5e` | `CDHGetFaVersion` | `out: string Version, out: int RetVal` | — | Read the FA version string for the current vehicle. |
| `0x5f` | `CDHGetAnzahlFaElemente` | `out: int Anzahl` | — | Count of FA elements (tokens) in the current FA. |
| `0x60` | `CDHGetFaElement` | `in: string Typ, in: bool FirstElement, out: string Element` | 56 | Iterate FA elements by type (FirstElement = start). |
| `0x61` | `CDHCheckIdent2` | `in: string Bezeichner, in: int Id1, out: int RetVal` | 125 | Verify identity v2 (Id1 as int) for an anchor — used by post-2003 chassis. |
