/**
 * BMW Mod-36 checksum — appended as the 18th byte of `FAHRGESTELL_NR`
 * in NCSEXPER's system-data store. Anchor for the algorithm and its
 * use site:
 *
 *   - **Algorithm** — `CalcMod36CheckSum` (`FUN_0043e9d0` in
 *     NCSEXPER.EXE). Disassembly walks each input character through
 *     `DecodeCharToBin` (`FUN_0043e800` — `0..9 → 0..9`, `A..Z → 10..35`),
 *     conditionally multiplies the value by 3 on **even-indexed**
 *     iterations (iteration 0 multiplies, 1 skips, 2 multiplies, …),
 *     and accumulates into a 16-bit sum. Final check value is
 *     `sum mod 36`, encoded back to a char via `EncodeBinToChar`
 *     (`FUN_0043e870`: `0..9 → '0'..'9'`, `10..35 → 'A'..'Z'`).
 *   - **Use** — `coapiSetFgNr` (`FUN_0042a560`) prepends `"FP"` to the
 *     17-char VIN, hands the 19-char buffer to `CalcMod36CheckSum`,
 *     and stores `FAHRGESTELL_NR = vin + check` (18 chars) and
 *     `FAHRGESTELL_NR_KOMPL = vin[0..6]` (7 chars) into the
 *     system-data variable store.
 *   - **Why it matters** — coding SGBDs that take the chassis number
 *     via `pars` (BMW E46 GM5's `C_FG_AUFTRAG` is the surfaced
 *     example) trip `strlen S, #$12` (= length must equal 18) on the
 *     received string. Sending the bare 17-char VIN fails with
 *     `JOB_STATUS = "ERROR_NUMBER_ARGUMENT"`. Pre-computing the M36
 *     check on the host side gets us to 18 chars and matches what
 *     NCSEXPER's MFC layer would have stored.
 *
 * Mod-36 alphabet (case-insensitive on input — letters are
 * uppercased to keep the encoding stable for round-trips):
 *
 *   `0..9, A..Z` → `0..35`
 */

/** Decode one Mod-36 char to its numeric value. Returns `null` on invalid input. */
function mod36Decode(c: string): number | null {
  if (c.length !== 1) return null;
  const code = c.charCodeAt(0);
  if (code >= 0x30 && code <= 0x39) return code - 0x30; // '0'..'9' → 0..9
  if (code >= 0x41 && code <= 0x5a) return code - 0x37; // 'A'..'Z' → 10..35
  if (code >= 0x61 && code <= 0x7a) return code - 0x57; // 'a'..'z' → 10..35 (case-insensitive)
  return null;
}

/** Encode a value `0..35` to its Mod-36 character. */
function mod36Encode(v: number): string {
  if (v < 10) return String.fromCharCode(0x30 + v);
  return String.fromCharCode(0x37 + v); // 10 → 'A', 35 → 'Z'
}

/**
 * Compute the BMW Mod-36 checksum character for an arbitrary input
 * string. Throws if the input contains a non-alphanumeric char (NCSEXPER's
 * `CalcMod36CheckSum` returns error code `0x41` in the same case).
 *
 * Algorithm (1:1 with FUN_0043e9d0):
 *   - 16-bit accumulator, signed at the divisor step.
 *   - Even iterations (i = 0, 2, 4, ...) multiply the per-char value by 3.
 *   - Final encoded char = `EncodeBinToChar(sum mod 36)`.
 */
export function mod36Checksum(input: string): string {
  let sum = 0;
  for (let i = 0; i < input.length; i++) {
    const v = mod36Decode(input[i]!);
    if (v === null) {
      throw new Error(
        `mod36Checksum: invalid character "${input[i]}" at index ${i} of "${input}"`,
      );
    }
    const weighted = (i & 1) === 0 ? v * 3 : v;
    // 16-bit accumulator wrap (matches NCSEXPER's `add word ptr [..],dx`
    // which lets the sum wrap around 65536 before the final mod 36).
    sum = (sum + weighted) & 0xffff;
  }
  // Sign-extend the 16-bit sum the same way `MOVSX EAX, word` does before
  // the IDIV — keeps the result identical for sums > 0x7FFF (e.g., very
  // long inputs). Then `sum mod 36`. JS `%` is truncated, matching
  // x86 IDIV's signed remainder; we add 36 and re-mod to keep the result
  // non-negative for any negative remainder.
  const signedSum = sum >= 0x8000 ? sum - 0x10000 : sum;
  const checkValue = ((signedSum % 36) + 36) % 36;
  return mod36Encode(checkValue);
}

/**
 * Format a 17-char VIN into NCSEXPER's 18-char `FAHRGESTELL_NR` shape
 * (VIN + Mod-36 check char) — the form the system-data store expects
 * and the value coding SGBDs (E46 GM5 `C_FG_AUFTRAG`, …) validate.
 *
 * Mirrors `coapiSetFgNr` (`FUN_0042a560`)'s 17-char input branch:
 *   1. Uppercase the VIN.
 *   2. Compute Mod-36 checksum over `"FP" + vin` (19 chars).
 *   3. Return `vin + checksum_char` (18 chars).
 *
 * Throws if the VIN is the wrong length or contains non-alphanumerics —
 * we'd rather fail loudly at seed time than send the SGBD a buffer
 * it'll reject downstream.
 */
export function formatFahrgestellNr(vin: string): string {
  const v = vin.trim().toUpperCase();
  if (v.length !== 17) {
    throw new Error(
      `formatFahrgestellNr: VIN must be 17 chars, got ${v.length} ("${v}")`,
    );
  }
  const check = mod36Checksum(`FP${v}`);
  return v + check;
}
