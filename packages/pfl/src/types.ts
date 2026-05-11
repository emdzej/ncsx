/**
 * Typed view of a PFL profile. Schema mirrors the on-disk INI layout documented in
 * `docs/pfl-format.md`. All numeric flags collapse to `number`, booleans collapse to
 * `boolean`, strings stay as `string`.
 *
 * - `ProfilPruefsumme` is preserved as the raw 4-hex-digit string for round-trip stability
 *   (Ghidra confirmed it's not recomputed on load/save).
 */
export interface PflProfile {
  header: PflHeader;
  fgnrZcs: PflFgnrZcs;
  asw: PflAsw;
  fswPsw: PflFswPsw;
  nettodaten: PflNettodaten;
  sget: PflSget;
  coding: PflCoding;
  individ: PflIndivid;
  verifikation: PflVerifikation;
  applikation: PflApplikation;
}

export interface PflHeader {
  formatVersion: string;             // ProfilFormatVersion (only "3.0" observed)
  bezeichnung: string;               // ProfilBezeichnung (display name)
  kommentar: string;                 // ProfilKommentar (free text)
  tag: string;                       // ProfilTag (DD or empty)
  monat: string;                     // ProfilMonat (MM or empty)
  jahr: string;                      // ProfilJahr (YYYY or empty)
  pruefsumme: string;                // ProfilPruefsumme (4-hex-digit opaque tag)
}

export interface PflFgnrZcs {
  fgNrEingabeModus: number;          // 1 or 2 — loader bounds-check
  checksummeBerechnen: boolean;
  loeschenVorEingabe: boolean;
  fktZcsEingeben: boolean;
  fktZcsAusSteuerdatei: boolean;
  fktZcsAusFahrzeug: boolean;
  fktBrAuswahl: boolean;
}

export interface PflAsw {
  lesenModus: number;                // 0..2 — loader bounds-check
  trace: boolean;
  leseDatei: string;
}

export interface PflFswPsw {
  lesenModus: number;                // 0..2 — loader bounds-check
  trace: boolean;
  manipulieren: boolean;
  leseDatei: string;
}

export interface PflNettodaten {
  lesenModus: number;                // 0..3 — loader bounds-check
  trace: boolean;
  leseDatei: string;
}

export interface PflSget {
  sgetLesen: boolean;
  fktSgAuswahl: boolean;
  fktSgetEingeben: boolean;
}

export interface PflCoding {
  zcsutLesen: boolean;
  zcsSchreibenModus: number;         // 1..3 — loader bounds-check (0 silently dropped)
  zcsVorCodierungLoeschen: boolean;
  zcsNurAktuellesSg: boolean;
  fktSgCodieren: boolean;
  fktFzgCodieren: boolean;
  fktCodierJobAendern: boolean;
  fktSgAuslesen: boolean;
  konvertierenFswPsw: boolean;
  fktKernfunktionen: boolean;
  spezialJobName: string;
  sgCodFktText: string;
  fzgCodFktText: string;
  ciFromSg: boolean;
}

export interface PflIndivid {
  checkIndividTrace: boolean;
  fktIndivid: boolean;
  fktKernfunktionen: boolean;
}

export interface PflVerifikation {
  codierungEin: boolean;
  vfpEin: boolean;
  zutEin: boolean;
  steuerFileName: string;
}

export interface PflApplikation {
  appKennung: string;                // "SERIE" | "ENTW" | "WERK"
}

export type PflWarning = {
  kind: 'out-of-range' | 'unknown-key' | 'malformed' | 'missing-required';
  section: string;
  key?: string;
  message: string;
};

export interface ParsePflOptions {
  /** Reject any out-of-range Lesemodus value instead of clamping. Default: false (clamp + warn). */
  strict?: boolean;
  /** Optional warning sink. Defaults to a no-op. */
  onWarning?: (w: PflWarning) => void;
}
