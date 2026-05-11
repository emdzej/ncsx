import type { PflProfile } from './types.js';

const b = (v: boolean): string => (v ? '1' : '0');

/**
 * Serialise a {@link PflProfile} back to PFL text. Matches NCSEXPER's own writer:
 *
 * - Section order: HEADER, FGNR_ZCS, ASW, FSWPSW, NETTODATEN, SGET, CODING, INDIVID,
 *   VERIFIKATION, APPLIKATION.
 * - Keys appear in the canonical order documented in `docs/pfl-format.md`.
 * - Lines use `\n` (NCSEXPER writes `\n` not CRLF when calling `WriteString`).
 * - `ProfilPruefsumme` is emitted as-is (opaque metadata; not recomputed here).
 *
 * Round-trips byte-stable for unmodified profiles.
 */
export function serializePfl(profile: PflProfile): string {
  const lines: string[] = [];
  const emit = (s: string): void => {
    lines.push(s);
  };

  // [HEADER]
  emit('[HEADER]');
  emit(`ProfilFormatVersion=${profile.header.formatVersion}`);
  emit(`ProfilBezeichnung=${profile.header.bezeichnung}`);
  emit(`ProfilKommentar=${profile.header.kommentar}`);
  emit(`ProfilTag=${profile.header.tag}`);
  emit(`ProfilMonat=${profile.header.monat}`);
  emit(`ProfilJahr=${profile.header.jahr}`);
  emit(`ProfilPruefsumme=${profile.header.pruefsumme}`);
  emit('');

  // [FGNR_ZCS]
  emit('[FGNR_ZCS]');
  emit(`FgNrEingabeModus=${profile.fgnrZcs.fgNrEingabeModus}`);
  emit(`ChecksummeBerechnen=${b(profile.fgnrZcs.checksummeBerechnen)}`);
  emit(`LoeschenVorEingabe=${b(profile.fgnrZcs.loeschenVorEingabe)}`);
  emit(`FktZcsEingeben=${b(profile.fgnrZcs.fktZcsEingeben)}`);
  emit(`FktZcsAusSteuerdatei=${b(profile.fgnrZcs.fktZcsAusSteuerdatei)}`);
  emit(`FktZcsAusFahrzeug=${b(profile.fgnrZcs.fktZcsAusFahrzeug)}`);
  emit(`FktBrAuswahl=${b(profile.fgnrZcs.fktBrAuswahl)}`);
  emit('');

  // [ASW]
  emit('[ASW]');
  emit(`AswLesenModus=${profile.asw.lesenModus}`);
  emit(`AswTrace=${b(profile.asw.trace)}`);
  emit(`AswLeseDatei=${profile.asw.leseDatei}`);
  emit('');

  // [FSWPSW]
  emit('[FSWPSW]');
  emit(`FswPswLesenModus=${profile.fswPsw.lesenModus}`);
  emit(`FswPswTrace=${b(profile.fswPsw.trace)}`);
  emit(`FswPswManipulieren=${b(profile.fswPsw.manipulieren)}`);
  emit(`FswPswLeseDatei=${profile.fswPsw.leseDatei}`);
  emit('');

  // [NETTODATEN]
  emit('[NETTODATEN]');
  emit(`NettoDatenLesenModus=${profile.nettodaten.lesenModus}`);
  emit(`NettoDatenTrace=${b(profile.nettodaten.trace)}`);
  emit(`NettoDatenLeseDatei=${profile.nettodaten.leseDatei}`);
  emit('');

  // [SGET]
  emit('[SGET]');
  emit(`SgetLesen=${b(profile.sget.sgetLesen)}`);
  emit(`FktSgAuswahl=${b(profile.sget.fktSgAuswahl)}`);
  emit(`FktSgetEingeben=${b(profile.sget.fktSgetEingeben)}`);
  emit('');

  // [CODING]
  emit('[CODING]');
  emit(`ZcsutLesen=${b(profile.coding.zcsutLesen)}`);
  emit(`ZcsSchreibenModus=${profile.coding.zcsSchreibenModus}`);
  emit(`ZcsVorCodierungLoeschen=${b(profile.coding.zcsVorCodierungLoeschen)}`);
  emit(`ZcsNurAktuellesSg=${b(profile.coding.zcsNurAktuellesSg)}`);
  emit(`FktSgCodieren=${b(profile.coding.fktSgCodieren)}`);
  emit(`FktFzgCodieren=${b(profile.coding.fktFzgCodieren)}`);
  emit(`FktCodierJobAendern=${b(profile.coding.fktCodierJobAendern)}`);
  emit(`FktSgAuslesen=${b(profile.coding.fktSgAuslesen)}`);
  emit(`KonvertierenFswPsw=${b(profile.coding.konvertierenFswPsw)}`);
  emit(`FktKernfunktionen=${b(profile.coding.fktKernfunktionen)}`);
  emit(`SpezialJobName=${profile.coding.spezialJobName}`);
  emit(`SgCodFktText=${profile.coding.sgCodFktText}`);
  emit(`FzgCodFktText=${profile.coding.fzgCodFktText}`);
  emit(`CiFromSg=${b(profile.coding.ciFromSg)}`);
  emit('');

  // [INDIVID]
  emit('[INDIVID]');
  emit(`CheckIndividTrace=${b(profile.individ.checkIndividTrace)}`);
  emit(`FktIndivid=${b(profile.individ.fktIndivid)}`);
  emit(`FktKernfunktionen=${b(profile.individ.fktKernfunktionen)}`);
  emit('');

  // [VERIFIKATION]
  emit('[VERIFIKATION]');
  emit(`CodierungEin=${b(profile.verifikation.codierungEin)}`);
  emit(`VfpEin=${b(profile.verifikation.vfpEin)}`);
  emit(`ZutEin=${b(profile.verifikation.zutEin)}`);
  emit(`SteuerFileName=${profile.verifikation.steuerFileName}`);
  emit('');

  // [APPLIKATION]
  emit('[APPLIKATION]');
  emit(`AppKennung=${profile.applikation.appKennung}`);

  return lines.join('\n') + '\n';
}
