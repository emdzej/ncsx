/**
 * Combined result of issuing the VIN and FA reads against one user-selected ECU. The UI
 * shows this next to the SG name the user picked, so partial success — VIN read worked,
 * FA didn't — is a normal state worth surfacing instead of an all-or-nothing failure.
 */
export interface IdentityReadResult {
  /** 17-character VIN if the SG returned one. */
  vin?: string;
  /** FA token string exactly as the SG returned it (`$0205$0502…` or `0205 0502 …`). */
  fa?: string;
  /** Per-job JOB_STATUS — `'OKAY'` on success, the SG's error code on failure. */
  vinStatus?: string;
  faStatus?: string;
  /** Captured exception text from the EDIABAS layer for the worst-case full failure. */
  error?: string;
}
