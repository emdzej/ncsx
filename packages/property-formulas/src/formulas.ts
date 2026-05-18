/* eslint-disable @typescript-eslint/no-unused-vars */

// AUTO-GENERATED from NCS Dummy Classes/Formulas/Formulas.cs.
// 1055 case arms in the original switch → this dispatch table.
//
import type { Formula } from './types.js';
import {
  getFloat,
  getFloat0_128,
  getFloatNeg128,
  getFloatNeg8,
  getString,
  invert,
  pow,
  printNumber,
  reverse,
} from './helpers.js';

export const FORMULAS = new Map<string, Formula>();

function reg(keys: string[], fn: Formula): void {
  for (const k of keys) FORMULAS.set(k, fn);
}

// ── PORTED FORMULAS START ──

reg(['LENK_UEBERSETZUNG', 'LENK_UEBERSETZUNG_NVC'], (ctx) => {
        if (ctx.data.length === 0)
        {
          return "?";
        }
        return printNumber(getFloat(ctx.data) / 5);
});

reg(['C_AAT_SCHUB_EIN_KORR_05', 'C_AAT_SCHUB_EIN_KORR_C05', 'C_AAT_SCHUB_EIN_KORR_C0F', 'C_AAT_SCHUB_EIN_KORR_SKAL', 'C10C_AAT_SCHUB_EIN_KORR', 'E84_AAT_SCHUB_EIN_KORR', 'E84C_AAT_SCHUB_EIN_KORR', 'K_SCHW_EIN_B_EMPF_BLIND', 'K_SCHWELLE_EIN_B_BLIND', 'SCHWELLE_EIN_B_BLIND', 'SCHWELLE_EIN_B_EMPF_BLIND'], (ctx) => {
        if (ctx.data.length === 0)
        {
          return "?";
        }
        return printNumber(getFloat(ctx.data) / 20);
});

reg(['TOR_DISTANZ_FAKTOR_AUS', 'TOR_DISTANZ_FAKTOR_AUS_2', 'TOR_DISTANZ_FAKTOR_EIN', 'TOR_DISTANZ_FAKTOR_EIN_2'], (ctx) => {
        if (ctx.data.length === 0)
        {
          return "?";
        }
        return printNumber(getFloat(ctx.data) / 128);
});

reg(['TANK_RED_REICHWEITE'], (ctx) => {
        if (ctx.data.length === 0)
        {
          return "?";
        }
        return printNumber(getFloat(ctx.data) / 255);
});

reg(['K_SCHWELLE_EIN_A_BLIND', 'SCHWELLE_EIN_A_BLIND'], (ctx) => {
        if (ctx.data.length === 0)
        {
          return "?";
        }
        return printNumber((getFloat(ctx.data) / 20) + 0.2);
});

reg(['K_SCHWELLE_RUECK_B_BLIND', 'SCHWELLE_RUECK_B_BLIND'], (ctx) => {
        if (ctx.data.length === 0)
        {
          return "?";
        }
        return printNumber((getFloat(ctx.data) / 20) + 0.5);
});

reg(['K_SCHWELLE_RUECK_A_BLIND', 'SCHWELLE_RUECK_A_BLIND'], (ctx) => {
        if (ctx.data.length === 0)
        {
          return "?";
        }
        return printNumber((getFloat(ctx.data) / 20) + 0.6);
});

reg(['DELTA_PSI_BETA_LIMITKORR2'], (ctx) => {
        if (ctx.data.length === 0)
        {
          return "?";
        }
        return printNumber(getFloat(ctx.data) / 16 + 1);
});

reg(['SCHW_TAU_LW_GR'], (ctx) => {
        if (ctx.data.length === 0)
        {
          return "?";
        }
        return printNumber(getFloat(ctx.data)) + " °";
});

reg(['ABBL_LZ_RKW', 'ABBL_LZ_STAND'], (ctx) => {
        if (ctx.data.length === 0)
        {
          return "?";
        }
        return printNumber(getFloat(ctx.data) / 3) + " °";
});

reg(['CBD_VERTICAL_DEFAULT', 'MAX_DELTA_KEINE_VERR', 'MAX_DELTA_KEINE_VERR_SP', 'MAX_SW_SCHWENK_W_AUSSEN', 'MAX_SW_SCHWENK_W_INNEN', 'MIN_DELTA_MAX_VERR', 'MIN_DELTA_MAX_VERR_SP', 'SW_NULL_BEREICH', 'SW_NULL_BEREICH_SP', 'VERTIKAL_BILD_OFFSET', 'VERTIKAL_BILD_OFFSET_R', 'WINKEL_GERADEAUS_10'], (ctx) => {
        if (ctx.data.length === 0)
        {
          return "?";
        }
        return printNumber(getFloat(ctx.data) / 10) + " °";
});

reg(['RAUSCH'], (ctx) => {
        if (ctx.data.length === 0)
        {
          return "?";
        }
        return printNumber(getFloat(ctx.data) / 40) + " °";
});

reg(['ALC_OFFSET_LWR', 'ALC_OFFSET_LWR_34'], (ctx) => {
        if (ctx.data.length === 0)
        {
          return "?";
        }
        return printNumber(getFloat(ctx.data) / 50) + " °";
});

reg(['ALC_ABSENKUNG_10_KM/H', 'ALC_ANHEBUNG_175_KM/H'], (ctx) => {
        if (ctx.data.length === 0)
        {
          return "?";
        }
        return printNumber(getFloat(ctx.data) / 100) + " °";
});

reg(['LENKWINKEL_UEBERSCHREITEN', 'LENKWINKEL_UNTERSCHREITEN'], (ctx) => {
        if (ctx.data.length === 0)
        {
          return "?";
        }
        return printNumber(getFloat(ctx.data) * 0.35) + " °";
});

reg(['MELDUNG_AENDERUNG_DIMMER'], (ctx) => {
        if (ctx.data.length === 0)
        {
          return "?";
        }
        return printNumber(getFloat(ctx.data) * 120 / 255) + " °";
});

reg(['JUSTAGE_OFF_HOR', 'JUSTAGE_OFF_VER', 'K_JUSOFFSETH_XXXX', 'K_JUSOFFSETV_XXXX'], (ctx) => {
        if (ctx.data.length === 0)
        {
          return "?";
        }
        return printNumber(getFloat(ctx.data) * 180 / 3217) + " °";
});

reg(['AB_SCHWELLE_DEJUSH_1', 'AB_SCHWELLE_DEJUSH_2', 'DEJU_HORZ_TOTE_ZONE_KOMP', 'DEJUS_TOTE_ZONE', 'K_ABSCHWELLEHDEJ_MAIN', 'K_ABSCHWELLEV_XXXX', 'SCHWELLE_DEJU_HOR_SCHNELL', 'SCHWELLE_DEJU_HORZ_RPU', 'SCHWELLE_DEJU_HORZ_SPU', 'SCHWELLE_DEJU_VER'], (ctx) => {
        if (ctx.data.length === 0)
        {
          return "?";
        }
        return printNumber(getFloat(ctx.data) * 180 / 6434) + " °";
});

reg(['FAN_VAL1_DOWN', 'FAN_VAL1_UP', 'FAN_VAL2_DOWN', 'FAN_VAL2_UP', 'FAN_VAL3_DOWN', 'FAN_VAL3_UP', 'MOTOR_UEBERTEMP', 'TEMP_MOT_OFF', 'ZIELTEMP_STUFE_1_KI_BFH', 'ZIELTEMP_STUFE_1_KI_BFS', 'ZIELTEMP_STUFE_1_KI_FAH', 'ZIELTEMP_STUFE_1_KI_FAS', 'ZIELTEMP_STUFE_1_LE_BFH', 'ZIELTEMP_STUFE_1_LE_BFS', 'ZIELTEMP_STUFE_1_LE_FAH', 'ZIELTEMP_STUFE_1_LE_FAS', 'ZIELTEMP_STUFE_2_KI_BFH', 'ZIELTEMP_STUFE_2_KI_BFS', 'ZIELTEMP_STUFE_2_KI_FAH', 'ZIELTEMP_STUFE_2_KI_FAS', 'ZIELTEMP_STUFE_2_LE_BFH', 'ZIELTEMP_STUFE_2_LE_BFS', 'ZIELTEMP_STUFE_2_LE_FAH', 'ZIELTEMP_STUFE_2_LE_FAS', 'ZIELTEMP_STUFE_3_KI_BFH', 'ZIELTEMP_STUFE_3_KI_BFS', 'ZIELTEMP_STUFE_3_KI_FAH', 'ZIELTEMP_STUFE_3_KI_FAS', 'ZIELTEMP_STUFE_3_LE_BFH', 'ZIELTEMP_STUFE_3_LE_BFS', 'ZIELTEMP_STUFE_3_LE_FAH', 'ZIELTEMP_STUFE_3_LE_FAS'], (ctx) => {
        if (ctx.data.length === 0)
        {
          return "?";
        }
        return printNumber(getFloat(ctx.data)) + " °C";
});

reg(['ABST_ENDT_VOR_PH_2_KI_BFH', 'ABST_ENDT_VOR_PH_2_KI_BFS', 'ABST_ENDT_VOR_PH_2_KI_FAH', 'ABST_ENDT_VOR_PH_2_KI_FAS', 'ABST_ENDT_VOR_PH_2_LE_BFH', 'ABST_ENDT_VOR_PH_2_LE_BFS', 'ABST_ENDT_VOR_PH_2_LE_FAH', 'ABST_ENDT_VOR_PH_2_LE_FAS'], (ctx) => {
        if (ctx.data.length === 0)
        {
          return "?";
        }
        return printNumber(getFloat(ctx.data) / 8) + " °C";
});

reg(['CBD_CAM_RESOLUTION'], (ctx) => {
        if (ctx.data.length === 0)
        {
          return "?";
        }
        return printNumber(getFloat(ctx.data) / 1000) + " °/pixel";
});

reg(['MAX_SCHWENK_V_H_BEGR', 'MAX_SCHWENK_V_H_BEGR_SP', 'MAX_SW_SCHWENK_V_HORIZ', 'MIN_SW_SCHWENK_V_HORIZ', 'MIN_SW_SCHWENK_V_HORIZ_SP'], (ctx) => {
        if (ctx.data.length === 0)
        {
          return "?";
        }
        return printNumber(pow(1.12, getFloat(ctx.data))) + " °/s";
});

reg(['MAX_SW_SCHWENK_V_VERTI', 'MIN_SW_SCHWENK_V_VERTI'], (ctx) => {
        if (ctx.data.length === 0)
        {
          return "?";
        }
        return printNumber(pow(1.65, getFloat(ctx.data)) / 2.0) + " °/s";
});

reg(['Y_RSSI_LENGTH'], (ctx) => {
        if (ctx.data.length === 0)
        {
          return "?";
        }
        return printNumber(getFloat(ctx.data) * 500) + " µs";
});

reg(['ABSCHW_D_TAU_HI', 'ABSCHW_D_TAU_HI_SP', 'ABSCHW_D_TAU_LO', 'ABSCHW_D_TAU_LO_SP', 'ABSCHWAECH_D_TAU', 'ABSCHWAECH_D_TAU_SP', 'C08_IPM_MAX_P_RES', 'C0A_IPM_MAX_P_RES', 'C0B_IPM_MAX_P_RES', 'C0C_IPM_MAX_P_RES', 'C0F_IPM_MAX_P_RES', 'C10_IPM_MAX_P_RES', 'CBS_RES_SPERR', 'DRIFT_SCHWELLE', 'DUTY_CICLE_EXT_SUPPLY', 'E84_IPM_MAX_P_RES', 'IPM_MAX_P_RES', 'KENNL_REDUZ_MAX_SCHWEN_SP', 'KENNL_REDUZ_MAX_SCHWENK', 'MAX_PWM_PH_1_KI_BFH', 'MAX_PWM_PH_1_KI_BFS', 'MAX_PWM_PH_1_KI_FAH', 'MAX_PWM_PH_1_KI_FAS', 'MAX_PWM_PH_1_LE_BFH', 'MAX_PWM_PH_1_LE_BFS', 'MAX_PWM_PH_1_LE_FAH', 'MAX_PWM_PH_1_LE_FAS', 'PWM_ALBV_CLOSE_KEN_1', 'PWM_ALBV_CLOSE_KEN_3', 'PWM_ALBV_OPEN', 'PWM_COMF_CLOSE', 'PWM_COMF_OPEN', 'PWM_INIT', 'REGENINTENSITAET', 'SVT_ECO_TOL_STROMPL', 'TAU_ABSCHWAECHUNG', 'TAU_ABSCHWAECHUNG_SP', 'TEILLAST_RELATIV_WERT'], (ctx) => {
        if (ctx.data.length === 0)
        {
          return "?";
        }
        return printNumber(getFloat(ctx.data)) + " %";
});

reg(['SPERREN_ANZUG_PWM', 'SPERREN_HALTE_PWM'], (ctx) => {
        if (ctx.data.length === 0)
        {
          return "?";
        }
        return printNumber(getFloat(ctx.data) * 100 / 156) + " %";
});

reg(['FA_PWM_MAX', 'FA_PWM_MIN', 'SUCHBEL_PWM_MAX', 'SUCHBEL_PWM_MAX_Z', 'SUCHBEL_PWM_MIN', 'SUCHBEL_PWM_MIN_Z'], (ctx) => {
        if (ctx.data.length === 0)
        {
          return "?";
        }
        return printNumber(getFloat(ctx.data) * 100 / 250) + " %";
});

reg(['PAO_HELL', 'SIA_RESET_SCHWELLE_LITER'], (ctx) => {
        if (ctx.data.length === 0)
        {
          return "?";
        }
        return printNumber(getFloat(ctx.data) * 100 / 255) + " %";
});

reg(['GEARMOMENTREGLER_MAX_HA_2', 'GEARMOMENTREGLER_MIN_HA_2'], (ctx) => {
        if (ctx.data.length === 0)
        {
          return "?";
        }
        return printNumber(getFloatNeg8(ctx.data) * 4000 / 1024) + " %";
});

reg(['STROM_KS_MAX', 'STROM_KS_MIN'], (ctx) => {
        if (ctx.data.length === 0)
        {
          return "?";
        }
        return printNumber(getFloat(ctx.data) * 10) + " A";
});

reg(['BREMSE_DRUCK'], (ctx) => {
        if (ctx.data.length === 0)
        {
          return "?";
        }
        return printNumber(getFloat(ctx.data) / 10) + " bar";
});

reg(['C_METER_NACH_INNEN_HI'], (ctx) => {
        if (ctx.data.length === 0)
        {
          return "?";
        }
        return printNumber(getFloat(ctx.data)) + " cm";
});

reg(['SIA_RESET_SCHWELLE_TAG', 'WAKEUP_TAGE'], (ctx) => {
        if (ctx.data.length === 0)
        {
          return "?";
        }
        return printNumber(getFloat(ctx.data)) + " days";
});

reg(['PER_WAKEUP-STEP4_DURATION'], (ctx) => {
        if (ctx.data.length === 0)
        {
          return "?";
        }
        return printNumber(getFloat(ctx.data) * 30) + " days";
});

reg(['INPUT_SCALING_SUB2'], (ctx) => {
        if (ctx.data.length === 0)
        {
          return "?";
        }
        return printNumber(getFloat(ctx.data)) + " dB";
});

reg(['PER_WAKEUP-EMERG_DURATION', 'PER_WAKEUP-STEP3_DURATION'], (ctx) => {
        if (ctx.data.length === 0)
        {
          return "?";
        }
        return printNumber(getFloat(ctx.data) * 12) + " h";
});

reg(['NACHLAUF_ZEIT_H', 'PER_WAKEUP-EMERG_PERIOD', 'PER_WAKEUP-STEP2_DURATION', 'PER_WAKEUP-STEP3_PERIOD', 'PER_WAKEUP-STEP4_PERIOD'], (ctx) => {
        if (ctx.data.length === 0)
        {
          return "?";
        }
        return printNumber(getFloat(ctx.data)) + " h";
});

reg(['CC_BLINKFREQUENZ_LANGSAM', 'CC_BLINKFREQUENZ_SCHNELL'], (ctx) => {
        if (ctx.data.length === 0)
        {
          return "?";
        }
        return printNumber(10 / getFloat(ctx.data)) + " Hz";
});

reg(['MITTENFREQUENZ_BAND1', 'PWM_FREQUENZ'], (ctx) => {
        if (ctx.data.length === 0)
        {
          return "?";
        }
        return printNumber(getFloat(ctx.data)) + " Hz";
});

reg(['MAX_ALBV_POS', 'KHV_SOFTBLOCK_BFH', 'KHV_SOFTBLOCK_BFS', 'KHV_SOFTBLOCK_FAH', 'KHV_SOFTBLOCK_FAS', 'LBV_SOFTBLOCK_BFH', 'LBV_SOFTBLOCK_BFS', 'LBV_SOFTBLOCK_FAH', 'LBV_SOFTBLOCK_FAS', 'LKV_SOFTBLOCK_BFH', 'LKV_SOFTBLOCK_BFS', 'LKV_SOFTBLOCK_FAH', 'LKV_SOFTBLOCK_FAS', 'LNV_SOFTBLOCK_BFH', 'LNV_SOFTBLOCK_BFS', 'LNV_SOFTBLOCK_FAH', 'LNV_SOFTBLOCK_FAS', 'SHV_SOFTBLOCK_BFH', 'SHV_SOFTBLOCK_BFS', 'SHV_SOFTBLOCK_FAH', 'SHV_SOFTBLOCK_FAS', 'SLV_SOFTBLOCK_BFH', 'SLV_SOFTBLOCK_BFS', 'SLV_SOFTBLOCK_FAH', 'SLV_SOFTBLOCK_FAS', 'SNV_SOFTBLOCK_BFH', 'SNV_SOFTBLOCK_BFS', 'SNV_SOFTBLOCK_FAH', 'SNV_SOFTBLOCK_FAS', 'STV_SOFTBLOCK_BFH', 'STV_SOFTBLOCK_BFS', 'STV_SOFTBLOCK_FAH', 'STV_SOFTBLOCK_FAS'], (ctx) => {
        if (ctx.data.length === 0)
        {
          return "?";
        }
        return printNumber(getFloat(ctx.data)) + " impulses";
});

reg(['C02_E84_FZG_MASSE', 'C08_FZG_MASSE', 'C10_FZG_MASSE', 'E84_FZG_MASSE', 'FZG_MASSE', 'FZG_MASSE_04', 'FZG_MASSE_C03', 'FZG_MASSE_C05', 'M_ANHAENGER', 'M_FZG_LDM'], (ctx) => {
        if (ctx.data.length === 0)
        {
          return "?";
        }
        return printNumber(getFloat(ctx.data) * 100) + " kg";
});

reg(['APPL_GEWICHT'], (ctx) => {
        if (ctx.data.length === 0)
        {
          return "?";
        }
        return printNumber(getFloat(ctx.data) * 16) + " kg";
});

reg(['IR_TF1_NOM', 'IR_TF2_NOM'], (ctx) => {
        if (ctx.data.length === 0)
        {
          return "?";
        }
        return printNumber(getFloat(ctx.data)) + " kHz";
});

reg(['TANK_RW_WARNUNG'], (ctx) => {
        if (ctx.data.length === 0)
        {
          return "?";
        }
        return printNumber(getFloat(ctx.data)) + " km";
});

reg(['CBS_GELB_KM_MIN'], (ctx) => {
        if (ctx.data.length === 0)
        {
          return "?";
        }
        return printNumber(getFloat(ctx.data) * 100) + " km";
});

reg(['CBS_INTW_10H', 'CBS_INTW_11H'], (ctx) => {
        if (ctx.data.length === 0)
        {
          return "?";
        }
        return printNumber(getFloat(ctx.data) * 1000) + " km";
});

reg(['OELWARTUNGSINTERVAL_MSD85', 'OELWARTUNGSINTERVAL_MSXUS', 'OELWARTUNGSINTERVALL', 'OELWARTUNGSINTERVALL_608', 'OELWARTUNGSINTERVALL_701', 'OELWARTUNGSINTERVALL_DDE', 'OELWARTUNGSINTERVALL_MEX', 'OELWARTUNGSINTERVALL_NEU', 'OELWARTUNGSINTERVALLMSS1'], (ctx) => {
        if (ctx.data.length === 0)
        {
          return "?";
        }
        if (ctx.data.length === 2)
        {
          return printNumber(ctx.data[0] * 256) + " km / " + printNumber(ctx.data[1]) + " weeks";
        }
        return printNumber(getFloat(ctx.data) * 256) + " km";
});

reg(['SENDMHKCCMLIMIT', 'V_WUNSCH_ACC_MAX_KMH', 'V_WUNSCH_DCC_MAX_KMH'], (ctx) => {
        if (ctx.data.length === 0)
        {
          return "?";
        }
        return printNumber(getFloat(ctx.data) * 5) + " km/h";
});

reg(['TLC_GESCHW_MAX', 'WISCHER_RUECK_GESCHW', 'WISCHER_RUECKSCHALT_S2_1'], (ctx) => {
        if (ctx.data.length === 0)
        {
          return "?";
        }
        return printNumber(getFloat(ctx.data) * 2) + " km/h";
});

reg(['ASP_GESCHW_AUTO_AUSKLAPP', 'ASP_MAX_GESCHW_EINKLAPPEN', 'GESCHW_ASP_AUTO_AUSKLAPP', 'GESCHW_DOWN', 'GESCHW_SPERRE_TOEHK', 'GESCHW_UP', 'GESCHWINDIGKEIT_ABBLENDEN', 'GESCHWINDIGKEIT_AUFBLEND', 'MAX_GESCHW_EINKLAPPEN_2', 'SEAT_BELT_GESCHW', 'SEAT_BELT_SPEED', 'SPEED_AUTO_UNFOLD', 'SPEED_MAX_FOLD', 'T_SCHOTT_AUF', 'T_SCHOTT_AUF_HS', 'T_SCHOTT_ZU', 'T_SCHOTT_ZU_HS', 'TSCHOTT_AUF', 'TSHOTT_AUF_HS', 'V_ABSCHALT_KMH', 'V_HI_ABSCHW_D_TAU', 'V_HI_ABSCHW_D_TAU_SP', 'V_HI_AENDER_LENK_UEBER_SP', 'V_HI_AENDER_LENK_UEBERS', 'V_HI_RED_SCHWENK_W', 'V_HI_RED_SCHWENK_W_SP', 'V_HI_REDUZIER_V_SCHWEN_SP', 'V_HI_REDUZIER_V_SCHWENK', 'V_HI_SW_MITLENKEN', 'V_HI_SW_MITLENKEN_SP', 'V_HI_SW_NACH_INNEN', 'V_HI_SW_NACH_INNEN_SP', 'V_HI_TAU_GIERRATE', 'V_LO_ABSCHW_D_TAU', 'V_LO_ABSCHW_D_TAU_SP', 'V_LO_AENDER_LENK_UEBER_SP', 'V_LO_AENDER_LENK_UEBERS', 'V_LO_RED_SCHWENK_W', 'V_LO_RED_SCHWENK_W_SP', 'V_LO_REDUZIER_V_SCHWEN_SP', 'V_LO_REDUZIER_V_SCHWENK', 'V_LO_SW_MITLENKEN', 'V_LO_SW_MITLENKEN_SP', 'V_LO_SW_NACH_INNEN', 'V_LO_SW_NACH_INNEN_SP', 'V_LO_TAU_GIERRATE', 'V_M_HI_REDUZIER_V_SCHW_SP', 'V_M_HI_REDUZIER_V_SCHWENK', 'V_M_LO_REDUZIER_V_SCHW_SP', 'V_M_LO_REDUZIER_V_SCHWENK', 'V_REFERENZLAUF_EN', 'V_VAR_SPERRE_BEIKLAPP_GM', 'V_VAR_SPERRE_BEIKLAPPEN', 'V_WUNSCH_DELTA_FEIN_KMH', 'V_WUNSCH_DELTA_GROB_KMH', 'V_WUNSCH_KMH_MIN', 'V_WUNSCH_KMH_ST_GROB', 'V_WUNSCH_MIN_KMH', 'VSCHOTT_AUF', 'VSCHOTT_AUF_HS', 'VSCHOTT_ZU', 'VSCHOTT_ZU_HS', 'VSCHOTTCLOSE', 'GAL_KMH_STUFUNG', 'SPEEDLOCK_X_KMH_MAX', 'SPEEDLOCK_X_KMH_MAX_C0E', 'SPEEDLOCK_X_KMH_MIN', 'SPEEDLOCK_X_KMH_MIN_C0E'], (ctx) => {
        if (ctx.data.length === 0)
        {
          return "?";
        }
        return printNumber(getFloat(ctx.data)) + " km/h";
});

reg(['WARNUNG_GESCHW_LIMIT', 'WARNUNG_GESCHW_LIMIT_2', 'WARNUNG_GESCHW_LIMIT_RED'], (ctx) => {
        if (ctx.data.length === 0)
        {
          return "?";
        }
        switch (ctx.module)
        {
        case "EKM":
          if (ctx.data[0] <= 0)
          {
            return "undefined";
          }
          return printNumber(getFloat(ctx.data) + 49) + " km/h";
        case "CCM":
        case "KMB_E32":
        case "LCM":
          return printNumber(getFloat(ctx.data) + 50) + " km/h";
        default:
          return printNumber(getFloat(ctx.data)) + " km/h";
        }
});

reg(['VERRIEGELUNGSSCHWELLE'], (ctx) => {
        switch (ctx.module)
        {
        case "CAS":
        case "CAS2":
        case "CAS3":
        case "CAS_RR":
          if (ctx.data.length === 0)
          {
            return "?";
          }
          return printNumber(getFloat(ctx.data)) + " km/h";
        default:
          return null;
        }
});

reg(['ACC_V_SET_MAX', 'ACC_V_SET_MIN'], (ctx) => {
        if (ctx.data.length === 0)
        {
          return "?";
        }
        return printNumber(getFloat(ctx.data) * 5) + " km/h or mph";
});

reg(['C08_SETZ_V_MAX', 'C0A_SETZ_V_MAX', 'C0B_SETZ_V_MAX', 'C0C_SETZ_V_MAX', 'C0F_SETZ_V_MAX', 'C10_SETZ_V_MAX_CC', 'C10_SETZ_V_MIN', 'C10_V_ABSCHALT', 'E84_SETZ_V_MAX_CC', 'E84_SETZ_V_MIN', 'E84_V_ABSCHALT', 'SETZ_V_MAX_CC', 'SETZ_V_MIN', 'THRV_AVAI_TLC_HIGH', 'THRV_AVAI_TLC_LOW', 'V_ABSCHALT', 'VSETZ_MAX', 'VSETZ_MAX_2', 'VSETZ_MIN', 'VSETZ_MIN_2'], (ctx) => {
        if (ctx.data.length === 0)
        {
          return "?";
        }
        return printNumber(getFloat(ctx.data)) + " km/h or mph";
});

reg(['CBS_AVKM_START'], (ctx) => {
        if (ctx.data.length === 0)
        {
          return "?";
        }
        return printNumber(getFloat(ctx.data) * 40) + " km/week";
});

reg(['IPM_P_MAX', 'IPM_P_MAX_CA', 'IPM_P_MAX_CC'], (ctx) => {
        if (ctx.data.length === 0)
        {
          return "?";
        }
        return printNumber(getFloat(ctx.data) * 10000) + " kW";
});

reg(['C02E84_MOTOR_LEISTUNG_MAX', 'C08_MOTOR_LEISTUNG_MAX', 'IPM_P_MIN', 'IPM_P_MIN_C'], (ctx) => {
        if (ctx.data.length === 0)
        {
          return "?";
        }
        return printNumber(getFloat(ctx.data) * 1000) + " kW";
});

reg(['P_AUSROLL_ANTRIEB', 'P_AUSROLL_ANTRIEB_04', 'P_AUSROLL_ANTRIEB_C03', 'P_AUSROLL_ANTRIEB_C05', 'P_AUSROLL_ANTRIEB_C0E', 'P_AUSROLL_ANTRIEB_C0F'], (ctx) => {
        if (ctx.data.length === 0)
        {
          return "?";
        }
        return printNumber(getFloat(ctx.data) / 5) + " kW";
});

reg(['MOTOR_LEISTUNG_MAX_04'], (ctx) => {
        if (ctx.data.length === 0)
        {
          return "?";
        }
        return printNumber((getFloat(ctx.data) + 80) * 1000) + " kW";
});

reg(['OEL_MAX_WERT'], (ctx) => {
        if (ctx.data.length === 0)
        {
          return "?";
        }
        return printNumber(getFloat(ctx.data) / 10) + " l";
});

reg(['K_STRECKE_B_BLIND', 'K_STRECKE_B_EMPF_BLIND', 'STRECKE_B_BLIND', 'STRECKE_B_BLIND_2', 'STRECKE_B_BLIND_3', 'STRECKE_B_EMPF_BLIND'], (ctx) => {
        if (ctx.data.length === 0)
        {
          return "?";
        }
        return printNumber(getFloat(ctx.data) * 50) + " m";
});

reg(['SEAT_BELT_DIST_1', 'SEAT_BELT_DISTANCE', 'SEAT_BELT_DISTANCE_ACSM'], (ctx) => {
        if (ctx.data.length === 0)
        {
          return "?";
        }
        return printNumber(getFloat(ctx.data) * 10) + " m";
});

reg(['DIST_RELEVANT_FALL_A', 'NORM_LEUCHTWEITE', 'REICHWEITE_MAX'], (ctx) => {
        if (ctx.data.length === 0)
        {
          return "?";
        }
        return printNumber(getFloat(ctx.data)) + " m";
});

reg(['TOR_DISTANZ_MIN', 'TOR_DISTANZ_MIN_2'], (ctx) => {
        if (ctx.data.length === 0)
        {
          return "?";
        }
        return printNumber(getFloat(ctx.data) / 16) + " m";
});

reg(['SPURBREITE'], (ctx) => {
        if (ctx.data.length === 0)
        {
          return "?";
        }
        return printNumber(getFloat(ctx.data) / 32) + " m";
});

reg(['FZG_RADSTAND', 'FZG_RADSTAND_LM', 'FZG_RADSTAND_NVC'], (ctx) => {
        if (ctx.data.length === 0)
        {
          return "?";
        }
        return printNumber(getFloat(ctx.data) / 50) + " m";
});

reg(['RADSTAND_ACC', 'WHEEL_BASE_LDM'], (ctx) => {
        if (ctx.data.length === 0)
        {
          return "?";
        }
        return printNumber(getFloat(ctx.data) / 64) + " m";
});

reg(['DYN_ROLLRADIUS'], (ctx) => {
        return printNumber(getFloat(ctx.data) / 100) + " m";
});

reg(['EINBAUORT_HORIZONTAL', 'EINBAUORT_HORIZONTAL_2'], (ctx) => {
        if (ctx.data.length === 0)
        {
          return "?";
        }
        return printNumber(getFloatNeg128(ctx.data) / 128) + " m";
});

reg(['RADSTAND', 'SPUR_HA', 'SPUR_VA'], (ctx) => {
        if (ctx.data.length === 0)
        {
          return "?";
        }
        if (ctx.data.length === 2)
        {
          return printNumber(getFloat(reverse(ctx.data)) / 1000) + " m";
        }
        return printNumber(getFloat(reverse(ctx.data)) / 32) + " m";
});

reg(['STROM_RUHE'], (ctx) => {
        if (ctx.data.length === 0)
        {
          return "?";
        }
        return printNumber(getFloat(ctx.data) * 20) + " mA";
});

reg(['ECO_ERSATZSTROMWERT', 'SVT_ECO_WIDERM'], (ctx) => {
        if (ctx.data.length === 0)
        {
          return "?";
        }
        return printNumber(getFloat(ctx.data) * 4) + " mA";
});

reg(['BACK_UP_BATTERY_CAPACITY'], (ctx) => {
        if (ctx.data.length === 0)
        {
          return "?";
        }
        return printNumber(getFloat(ctx.data) * 10) + " mAh";
});

reg(['AKTIVZEIT_KAPSENSOR_BT', 'AKTIVZEIT_KAPSENSOR_BTH', 'AKTIVZEIT_KAPSENSOR_FT', 'AKTIVZEIT_KAPSENSOR_FTH', 'DELAY_PWR_DOWN_INIT_DUR', 'DELAY_PWR_DOWN_INIT_JAPAN', 'ENERGIE_ZEIT_ENTPRELL', 'ENERGIE_ZEIT_LIMIT', 'FBD_PANIKDAUER', 'HIGH_POWER_MAX_TIME', 'HIGH_POWER_MAX_TIME_E', 'KL30G_TIMEOUT', 'KLR_AUS_TIMEOUT', 'KONFIG_NACHL_REGEN', 'MAX_GPRS_TIMER', 'MINUTEN_VA_IL', 'NACHLAUF_ZEIT_MIN', 'NAD_ALWAYS_ON_MAX_TIME', 'NEUE_FAHRT_KL_15_NACHL', 'PER_WAKEUP-AMPS_SNOOPING', 'PER_WAKEUP-SMS_SNOOPING', 'PER_WAKEUP-STEP1_PERIOD', 'PER_WAKEUP-STEP2_PERIOD', 'T_SPERR', 'TC_TIME_KL15_AUTO_OFF', 'ZEIT_ST3_NACH_ST2'], (ctx) => {
        if (ctx.data.length === 0)
        {
          return "?";
        }
        return printNumber(getFloat(ctx.data)) + " min";
});

reg(['NACHLAUFZEIT_HZ_KL_AS_FAS', 'NACHLAUFZEIT_HZ_KL_AS', 'NACHLAUFZEIT_HZ_KL_AS_BFS'], (ctx) => {
        if (ctx.data.length === 0)
        {
          return "?";
        }
        return ((ctx.data[0] < 0xff) ? printNumber(getFloat(ctx.data)) : "∞") + " min";
});

reg(['PER_WAKEUP-STEP1_DURATION'], (ctx) => {
        if (ctx.data.length === 0)
        {
          return "?";
        }
        return printNumber(getFloat(ctx.data) * 30) + " min";
});

reg(['WAKEUP_ZEIT'], (ctx) => {
        if (ctx.data.length === 0)
        {
          return "?";
        }
        return printNumber(getFloat(ctx.data) * 5) + " min";
});

reg(['C07_GMK_ECBA_HA', 'C07_GMK_ECBA_VA', 'C08_GMK_ECBA_HA', 'C08_GMK_ECBA_VA', 'C0A_GMK_ECBA_HA', 'C0A_GMK_ECBA_VA', 'C0B_GMK_ECBA_HA', 'C0B_GMK_ECBA_VA', 'C0C_GMK_ECBA_HA', 'C0C_GMK_ECBA_VA', 'C0F_GMK_ECBA_HA', 'C0F_GMK_ECBA_VA', 'GMK_ECBA_HA', 'GMK_ECBA_VA'], (ctx) => {
        if (ctx.data.length === 0)
        {
          return "?";
        }
        return printNumber(getFloat(ctx.data) * 3) + " mm";
});

reg(['C10_R_RAD_DYN_DSC', 'E84_R_RAD_DYN_DSC', 'E89_R_RAD_DYN_DSC', 'R_RAD_DYN', 'R_RAD_DYN_C05', 'R_RAD_DYN_DSC', 'R_RAD_DYN_DSC_C0F'], (ctx) => {
        if (ctx.data.length === 0)
        {
          return "?";
        }
        return printNumber(getFloat(ctx.data) * 2) + " mm";
});

reg(['DELTA_SOS_SHD'], (ctx) => {
        if (ctx.data.length === 0)
        {
          return "?";
        }
        return printNumber(getFloat(ctx.data) * 1.8) + " mm";
});

reg(['LWR_HEBEL', 'LWR_HEBEL_33', 'LWR_HEBEL_34'], (ctx) => {
        if (ctx.data.length === 0)
        {
          return "?";
        }
        return printNumber(getFloat(ctx.data)) + " mm";
});

reg(['CBS_GELB_HUAU', 'CBS_INTD_03H', 'CBS_INTD_14H'], (ctx) => {
        if (ctx.data.length === 0)
        {
          return "?";
        }
        return printNumber(getFloat(ctx.data)) + " months";
});

reg(['V_WUNSCH_ACC_MAX_MPH', 'V_WUNSCH_DCC_MAX_MPH'], (ctx) => {
        if (ctx.data.length === 0)
        {
          return "?";
        }
        return printNumber(getFloat(ctx.data) * 5) + " mph";
});

reg(['V_ABSCHALT_MPH', 'V_WUNSCH_DELTA_FEIN_MPH', 'V_WUNSCH_DELTA_GROB_MPH', 'V_WUNSCH_MIN_MPH', 'V_WUNSCH_MPH_MIN', 'V_WUNSCH_MPH_ST_GROB'], (ctx) => {
        if (ctx.data.length === 0)
        {
          return "?";
        }
        return printNumber(getFloat(ctx.data)) + " mph";
});

reg(['SL_SCHALT_UMSCHALT_OPT'], (ctx) => {
        if (ctx.data.length === 0)
        {
          return "?";
        }
        return printNumber(getFloat(ctx.data) * 150) + " ms";
});

reg(['TIMEOUT_ID_UEBERW_SIM'], (ctx) => {
        if (ctx.data.length === 0)
        {
          return "?";
        }
        return printNumber(getFloat(ctx.data) * 110) + " ms";
});

reg(['ACC_TIMER_PAUSE', 'ANZ_HOLD_KI', 'HAFT_RUECKSTELL_PERIODE', 'MINDZEIT_VR_SEN_FT_AKTIV', 'PREDRIVE_PERIODENDAUER', 'WARTEZEIT_CA_FREIGABE'], (ctx) => {
        if (ctx.data.length === 0)
        {
          return "?";
        }
        return printNumber(getFloat(ctx.data) * 100) + " ms";
});

reg(['VERZ_FRWISCHER_N_WASCHANF', 'VERZ_HKWISCHER_N_WASCHANF'], (ctx) => {
        if (ctx.data.length === 0)
        {
          return "?";
        }
        if (ctx.data[0] >= 0xff)
        {
          return "undefined";
        }
        return printNumber(getFloat(ctx.data) * 100) + " ms";
});

reg(['BFD_1_ENTPRELL_ABS', 'BFD_2_ENTPRELL_ABS'], (ctx) => {
        if (ctx.data.length === 0)
        {
          return "?";
        }
        return printNumber(getFloat(ctx.data) * 80) + " ms";
});

reg(['ACC_TIMER_BALKEN', 'KOMFORT_AUS_IN_50MS'], (ctx) => {
        if (ctx.data.length === 0)
        {
          return "?";
        }
        return printNumber(getFloat(ctx.data) * 50) + " ms";
});

reg(['AUDIBLE_WARNING_MAX', 'AUDIBLE_WARNING_MIN', 'BFD_1_ENTPRELL_AX', 'BFD_2_ENTPRELL_AX', 'BREAK_INTERMITTEND_MODE', 'MAX_WARNING_LENGTH', 'MIN_WARNING_LENGTH', 'PULS_INTERMITTEND_MODE'], (ctx) => {
        if (ctx.data.length === 0)
        {
          return "?";
        }
        return printNumber(getFloat(ctx.data) * 40) + " ms";
});

reg(['TIMEOUT_ID_UEBERW_SBSL', 'TIMEOUT_ID_UEBERW_SBSR'], (ctx) => {
        if (ctx.data.length === 0)
        {
          return "?";
        }
        return printNumber(getFloat(ctx.data) * 32) + " ms";
});

reg(['ABFRAGEZEIT_AHM'], (ctx) => {
        if (ctx.data.length === 0)
        {
          return "?";
        }
        return printNumber(getFloat(ctx.data) * 30) + " ms";
});

reg(['ALC_REF_LAUF_AL_AUS', 'T_CC_MIN'], (ctx) => {
        if (ctx.data.length === 0)
        {
          return "?";
        }
        return printNumber(getFloat(ctx.data) * 20) + " ms";
});

reg(['BFD_1_STUFE_DELAY', 'BFD_2_STUFE_DELAY', 'CC_15_AUS', 'CC_15_EIN', 'CC_ML', 'CC_R_AUS', 'CC_R_EIN', 'D_TAU_MITTEL_GIERR', 'D_TAU_MITTEL_LENKW', 'ENTLADEZEIT_ER', 'FH_EMERGENCY_TA', 'FH_EMERGENZY_TA', 'HAFT_RUECKSTELL_VERZGRNG', 'HAFT_RUECKSTELLPULSLAENGE', 'HECKWISCHER_ENTPRELLZEIT', 'LENKSTOCK_UMSCHALT_VERZ', 'LOAD_DUMP_PRELL', 'LS_UMSCHALT_FEHLER_ZEIT', 'NACHL_RKW', 'SAT_TEST_ZYKL', 'SHD_BLOCK_TIME', 'SHD_NORMINGBLOCKTIME', 'SOS_BLOCK_TIME', 'SOS_NORMINGBLOCKTIME', 'SPERREN_ANZUGSZEIT', 'T_F_GIERRATE_DEF', 'T_FILTER_DYN_LZ', 'T_FILTER_GIERRATE', 'T_FILTER_LENKWINKEL', 'T_FILTER_TAU_LW', 'T_FILTER_UEBERST', 'T_FILTER_UEBERST_SP', 'T_FILTER_V_VEH', 'T_FILTER_V_VEH_SP', 'TIMEOUT_ID_UEBERW_SFZ', 'TIMEOUT_ID_UEBERW_STVL', 'TIMEOUT_ID_UEBERW_STVR', 'TIMEOUT_ID_UEBERW_SZL', 'ZEIT_KALT_PULSE', 'ZEIT_KALT_PULSE_QUICK', 'ZYKLUS_KALT_RUNDEN_QUICK'], (ctx) => {
        if (ctx.data.length === 0)
        {
          return "?";
        }
        return printNumber(getFloat(ctx.data) * 10) + " ms";
});

reg(['ZEIT_WASCH_M/O_FRWISCHER', 'ZEIT_WASCH_M/O_HKWISCHER'], (ctx) => {
        if (ctx.data.length === 0)
        {
          return "?";
        }
        if (ctx.data[0] >= 0xff)
        {
          return "undefined";
        }
        return printNumber(getFloat(ctx.data) * 10) + " ms";
});

reg(['DELAY_KL50L', 'DELAY_KLR_AUS', 'ZEIT_BREMSE'], (ctx) => {
        if (ctx.data.length === 0)
        {
          return "?";
        }
        return printNumber(getFloat(ctx.data) * 5) + " ms";
});

reg(['ENTPRELLZEIT_FRWISCHER', 'ENTPRELLZEIT_HKWISCHER'], (ctx) => {
        if (ctx.data.length === 0)
        {
          return "?";
        }
        if (ctx.data[0] >= 0xff)
        {
          return "undefined";
        }
        return printNumber(getFloat(ctx.data) * 5) + " ms";
});

reg(['BULK_DELAY_C15', 'SLV2FEH_UMSCHALTZEIT', 'SVT_ECO_ENT_ZEIT', 'WARTEZEIT_ZW_MESSUNG'], (ctx) => {
        if (ctx.data.length === 0)
        {
          return "?";
        }
        return printNumber(getFloat(ctx.data)) + " ms";
});

reg(['ECO_REGELZEIT', 'SVT_REGELZEIT'], (ctx) => {
        if (ctx.data.length === 0)
        {
          return "?";
        }
        return printNumber(getFloat(ctx.data) / 4) + " ms";
});

reg(['FH_EMERGENCY_TZF', 'FH_EMERGENZY_TZF'], (ctx) => {
        if (ctx.data.length === 0)
        {
          return "?";
        }
        return printNumber(getFloat(ctx.data) / 10) + " ms";
});

reg(['T_MAX_DISTANZ'], (ctx) => {
        if (ctx.data.length === 0)
        {
          return "?";
        }
        return printNumber(getFloat(ctx.data) / 32) + " ms";
});

reg(['ENTPRELLZEIT_HALLSENSOREN', 'ENTPRELLZEIT_P', 'ENTPRELLZEIT_SPORT', 'ENTPRELLZEIT_UNLOCK'], (ctx) => {
        if (ctx.data.length === 0)
        {
          return "?";
        }
        return printNumber((getFloat(ctx.data) + 1) * 8) + " ms";
});

reg(['BFD_1_BLINK_FREQ_AUS', 'BFD_1_BLINK_FREQ_EIN', 'BFD_2_BLINK_FREQ_AUS', 'BFD_2_BLINK_FREQ_EIN'], (ctx) => {
        if (ctx.data.length === 0)
        {
          return "?";
        }
        return printNumber(getFloat(ctx.data) * 40 + 100) + " ms";
});

reg(['XENON_WIEDER_Z_AUS_PHASE'], (ctx) => {
        if (ctx.data.length === 0)
        {
          return "?";
        }
        return printNumber(getFloat(ctx.data) * 300 + 600) + " ms";
});

reg(['ALC_DEF_LWR_SENSOR_HI'], (ctx) => {
        if (ctx.data.length === 0)
        {
          return "?";
        }
        return printNumber(getFloat(ctx.data) * 19.6) + " mV";
});

reg(['ONLINE_DISABLE_VMAX', 'ONLINE_DISABLE_VMAX_6'], (ctx) => {
        if (ctx.data.length === 0)
        {
          return "?";
        }
        return printNumber(getFloat(ctx.data)) + " m/s";
});

reg(['BESCHLEUNIGUNG_V_CHAR'], (ctx) => {
        if (ctx.data.length === 0)
        {
          return "?";
        }
        return printNumber(getFloat(ctx.data) / 2) + " m/s";
});

reg(['BESCHLEUNIGUNG_MAX_HIGH', 'BESCHLEUNIGUNG_MAX_LOW', 'VERZOEGERUNG_MAX', 'VERZOEGERUNG_MAX_2'], (ctx) => {
        if (ctx.data.length === 0)
        {
          return "?";
        }
        return printNumber(getFloat(ctx.data) / 64) + " m/s²";
});

reg(['CDS_AX_NEG_FEIN', 'CDS_AX_NEG_GROB', 'DS_AX_POS_FEIN', 'DS_AX_POS_GROB'], (ctx) => {
        if (ctx.data.length === 0)
        {
          return "?";
        }
        return printNumber(getFloat(ctx.data) / 50) + " m/s²";
});

reg(['A_MAX', 'A_MAX_DSC', 'A_MIN', 'A_MIN_DSC', 'C08_VERZOEG_NEG_FEIN', 'C08_VERZOEG_NEG_GROB', 'C08_VERZOEG_POS_FEIN', 'C08_VERZOEG_POS_GROB', 'C0A_VERZOEG_NEG_FEIN', 'C0A_VERZOEG_NEG_GROB', 'C0A_VERZOEG_POS_FEIN', 'C0A_VERZOEG_POS_GROB', 'C0B_VERZOEG_NEG_FEIN', 'C0B_VERZOEG_NEG_GROB', 'C0B_VERZOEG_POS_FEIN', 'C0B_VERZOEG_POS_GROB', 'C0C_VERZOEG_NEG_FEIN', 'C0C_VERZOEG_NEG_GROB', 'C0C_VERZOEG_POS_FEIN', 'C0C_VERZOEG_POS_GROB', 'C0F_VERZOEG_NEG_FEIN', 'C0F_VERZOEG_NEG_GROB', 'C0F_VERZOEG_POS_FEIN', 'C0F_VERZOEG_POS_GROB', 'C10_A_MAX', 'C10_A_MIN', 'C10_VERZOEG_NEG_FEIN', 'C10_VERZOEG_NEG_GROB', 'C10_VERZOEG_POS_FEIN', 'C10_VERZOEG_POS_GROB', 'E84_A_MAX', 'E84_A_MAX_DSC', 'E84_A_MIN', 'E84_A_MIN_DSC', 'E84_VERZOEG_NEG_FEIN', 'E84_VERZOEG_NEG_GROB', 'E84_VERZOEG_POS_FEIN', 'E84_VERZOEG_POS_GROB', 'VERZOEG_NEG_FEIN', 'VERZOEG_NEG_GROB', 'VERZOEG_POS_FEIN', 'VERZOEG_POS_GROB'], (ctx) => {
        if (ctx.data.length === 0)
        {
          return "?";
        }
        return printNumber(getFloatNeg128(ctx.data) / 10) + " m/s²";
});

reg(['C03_UNTERSTEUERSCHWELLE_2', 'C04_UEBERSTEUERN_MUE_1_2', 'C04_UNTERSTEUERSCHWELLE_2', 'C07_UEBERSTEUERN_MUE_1_2', 'C08_UEBERSTEUERN_MUE_1_2', 'C08_UNTERSTEUERN_MUE_1_2', 'C09_UEBERSTEUERN_MUE_1_2', 'C09_UNTERSTEUERN_MUE_1_2', 'C0A_UEBERSTEUERN_MUE_1_2', 'C0A_UNTERSTEUERN_MUE_1_2', 'C0B_UEBERSTEUERN_MUE_1_2', 'C0B_UNTERSTEUERN_MUE_1_2', 'C0C_UEBERSTEUERN_MUE_1_2', 'C0C_UNTERSTEUERN_MUE_1_2', 'C0D_UEBERSTEUERN_MUE_1_2', 'C0D_UNTERSTEUERN_MUE_1_2', 'C0E_UEBERSTEUERN_MUE_1_2', 'C0E_UNTERSTEUERN_MUE_1_2', 'C0F_UEBERSTEUERN_MUE_1_2', 'C0F_UNTERSTEUERN_MUE_1_2', 'M3_UEBERSTEUERN_MUE_1_2', 'UEBERSTEUERN_MUE_1_2', 'UNTERSTEUERN_MUE_1_2', 'UNTERSTEUERSCHWELLE_2'], (ctx) => {
        if (ctx.data.length === 0)
        {
          return "?";
        }
        return printNumber(2.5 + (getFloatNeg128(ctx.data) / 64)) + " m/s²";
});

reg(['C04_UEBERSTEUERN_MUE_0_2', 'C07_UEBERSTEUERN_MUE_0_2', 'UEBERSTEUERN_MUE_0_2', 'UNTERSTEUERN_MUE_0_2'], (ctx) => {
        if (ctx.data.length === 0)
        {
          return "?";
        }
        return printNumber(1.5 + (getFloatNeg128(ctx.data) / 128)) + " m/s²";
});

reg(['C_AAT_SCHUB_AUS_OFFSET', 'C_AAT_SCHUB_EIN_OFFSET', 'C10C_AAT_SCHUB_AUS_OFFSET', 'C10C_AAT_SCHUB_EIN_OFFSET', 'E84_AAT_SCHUB_AUS_OFFSET', 'E84_AAT_SCHUB_EIN_OFFSET', 'E84C_AAT_SCHUB_AUS_OFFSET', 'E84C_AAT_SCHUB_EIN_OFFSET'], (ctx) => {
        if (ctx.data.length === 0)
        {
          return "?";
        }
        return printNumber(getFloat(ctx.data) * 10) + " Nm";
});

reg(['MOTOR_DREHM_MAX_CHAR', 'MOTOR_DREHM_MAX_CHAR_2'], (ctx) => {
        if (ctx.data.length === 0)
        {
          return "?";
        }
        return printNumber(getFloat(ctx.data) * 8) + " Nm";
});

reg(['ECO_MAX_WID', 'ECO_MIN_WID', 'SVT_MAX_WID', 'SVT_MIN_WID'], (ctx) => {
        if (ctx.data.length === 0)
        {
          return "?";
        }
        return printNumber(getFloat(ctx.data) / 10) + " ohm";
});

reg(['CBD_CCC_FULL_CENTRE', 'CBD_CCC_SPLIT_CENTRE'], (ctx) => {
        if (ctx.data.length === 0)
        {
          return "?";
        }
        return printNumber(getFloat(ctx.data)) + " pixels";
});

reg(['ABSCHALTDREHZAHL_ANLASSER'], (ctx) => {
        if (ctx.data.length === 0)
        {
          return "?";
        }
        return printNumber(getFloat(ctx.data) * 100) + " rpm";
});

reg(['MOTOR_DREHZAHL_MAX', 'MOTOR_DREHZAHL_MAX_2'], (ctx) => {
        if (ctx.data.length === 0)
        {
          return "?";
        }
        return printNumber(getFloat(ctx.data) * 32) + " rpm";
});

reg(['SLEEPTIMER_FH_KLRAUS'], (ctx) => {
        if (ctx.data.length === 0)
        {
          return "?";
        }
        return printNumber(getFloat(ctx.data) * 6) + " s";
});

reg(['RLS_RESTART_COMM', 'ZEIT_AUTO_ZV_VR'], (ctx) => {
        if (ctx.data.length === 0)
        {
          return "?";
        }
        return printNumber(getFloat(ctx.data) * 5) + " s";
});

reg(['LOAD_DUMP_MAX_TIME', 'MAX_ZEIT_PH_1_KI_BFH', 'MAX_ZEIT_PH_1_KI_BFS', 'MAX_ZEIT_PH_1_KI_FAH', 'MAX_ZEIT_PH_1_KI_FAS', 'MAX_ZEIT_PH_1_LE_BFH', 'MAX_ZEIT_PH_1_LE_BFS', 'MAX_ZEIT_PH_1_LE_FAH', 'MAX_ZEIT_PH_1_LE_FAS'], (ctx) => {
        if (ctx.data.length === 0)
        {
          return "?";
        }
        return printNumber(getFloat(ctx.data) * 4) + " s";
});

reg(['ZEIT_KALT_RUNDEN'], (ctx) => {
        if (ctx.data.length === 0)
        {
          return "?";
        }
        return printNumber(getFloat(ctx.data) * 2.5) + " s";
});

reg(['ZEITDAUER_BIS_ABSCHALTUNG'], (ctx) => {
        if (ctx.data.length === 0)
        {
          return "?";
        }
        return printNumber(getFloat(ctx.data) * 2) + " s";
});

reg(['ABSCHALTZEIT_IR', 'BLK_TIMER_STAND', 'DEF_HEIMLEUCHTEN_CKM', 'DEFAULT_ONTIME', 'E_CALL_COUNTD_DEL_TMR', 'E_CALL_COUNTD_DELAY_T_C06', 'E_CALL_COUNTD_DELAY_TIMER', 'HEIMLEUCHTEN', 'HEIMLEUCHTEN_1', 'HEIMLEUCHTEN_2', 'HEIMLEUCHTEN_3', 'INTERVALLZEIT_STAND', 'SBLK_E64_FKT_TIMEOUT', 'SEAT_BELT_MONITOR', 'SEAT_BELT_MONITOR_ACSM2', 'SEAT_BELT_MONITOR_CD', 'SEAT_BELT_WARNDAUER', 'TIMER_SMS_NACK', 'UNP_HEIMLEUCHTEN_CKM', 'WL_DAUER', 'ZEIT_BIS_AUTOM_SPERREN', 'ZEIT_DEKR_N_WDHSP_HKKL', 'ZEIT_DEKR_N_WDHSP_HKSCHEI', 'ZEIT_DEKR_N_WDHSPERRE_ER'], (ctx) => {
        if (ctx.data.length === 0)
        {
          return "?";
        }
        return printNumber(getFloat(ctx.data)) + " s";
});

reg(['BLOCK_ERKENNUNG_FRWISCHER', 'BLOCK_ERKENNUNG_HKWISCHER', 'INTERVALLZEIT_HECKWISCHER', 'SPERRZ_N_BLOCK_FRWISCHER', 'SPERRZ_N_BLOCK_HKWISCHER'], (ctx) => {
        if (ctx.data.length === 0)
        {
          return "?";
        }
        if (ctx.data[0] >= 0xff)
        {
          return "undefined";
        }
        return printNumber(getFloat(ctx.data)) + " s";
});

reg(['SVS_KLEMMEND'], (ctx) => {
        if (ctx.data.length === 0)
        {
          return "?";
        }
        return ((ctx.data[0] < 31) ? printNumber(getFloat(ctx.data)) : "∞") + " s";
});

reg(['ALARM_PAUSE_TIME', 'ALARM_TIME_EXT_SUPPLY', 'ALARM_TIME_SELF_SUPPLY', 'AUTO_LOSF_WARTEZEIT', 'FBD_MOTORLAUF', 'FBD_MOTORSTART', 'INTERVALLZEIT_HK_WISC_RG', 'K_ZEITSCHRANKE_A_BLIND', 'TEMPOMAT_SETZ_ANZ_DAUER', 'TIMEOUT_NACH_FEHLSPAN_BFS', 'TIMEOUT_NACH_FEHLSPAN_FAS', 'TIMEOUT_NACH_FEHLSPANNUNG', 'ZEITSCHRANKE_A_BLIND'], (ctx) => {
        if (ctx.data.length === 0)
        {
          return "?";
        }
        return printNumber(getFloat(ctx.data) / 2) + " s";
});

reg(['DAB_FROM_FM', 'DAB_TO_FM', 'SHD_TIMEOUTLIMPHOMETIME', 'SHD_TIMEOUTTIME', 'SOS_TIMEOUTLIMPHOMETIME', 'SOS_TIMEOUTTIME'], (ctx) => {
        if (ctx.data.length === 0)
        {
          return "?";
        }
        return printNumber(getFloat(ctx.data) / 4) + " s";
});

reg(['CC_F_KUEHLMITTELSTAND', 'CC_F_WASCHWASSERSTAND', 'MINZEIT_IOUT_ANSTEUER_BT', 'MINZEIT_IOUT_ANSTEUER_BTH', 'MINZEIT_IOUT_ANSTEUER_FT', 'MINZEIT_IOUT_ANSTEUER_FTH', 'T_ZEIT_ZUG_NACH_DRUCK_BT', 'T_ZEIT_ZUG_NACH_DRUCK_BTH', 'T_ZEIT_ZUG_NACH_DRUCK_FT', 'T_ZEIT_ZUG_NACH_DRUCK_FTH'], (ctx) => {
        if (ctx.data.length === 0)
        {
          return "?";
        }
        return printNumber(getFloat(ctx.data) / 5) + " s";
});

reg(['FBD_HECKKLAPPE_TOTZEIT', 'FBD_PANIK_TOTZEIT'], (ctx) => {
        if (ctx.data.length === 0)
        {
          return "?";
        }
        return printNumber(getFloat(ctx.data) / 10) + " s";
});

reg(['KMFRT_OEFF_HINTEN', 'KMFRT_OEFF_SHD', 'KMFRT_OEFFNEN', 'KMFRT_SCHL_VORNE', 'KMFRT_SCHLIESSEN', 'KOMFORT_SCHL_SHD', 'MAX_KMFRT_UNTERB', 'MAX_KMFRT_UNTERB_FBD', 'MIND_KMFRT_NACH_UNTERB'], (ctx) => {
        if (ctx.data.length === 0)
        {
          return "?";
        }
        switch (ctx.module)
        {
        case "CAS":
        case "CAS_RR":
          return printNumber(getFloat(reverse(ctx.data)) / 100) + " s";
        default:
          return printNumber(getFloat(ctx.data) / 10) + " s";
        }
});

reg(['TOR_DYN_SCHWELLE_ACCRGLT', 'TOR_DYN_SCHWELLE_SUS', 'TOR_STAT_SCHWELLE_ACCRGLT', 'TOR_STAT_SCHWELLE_SUSP'], (ctx) => {
        if (ctx.data.length === 0)
        {
          return "?";
        }
        return printNumber(getFloat(ctx.data) / 20) + " s";
});

reg(['T_MIN_TOR', 'T_TOL_B_NACH_A_BLIND'], (ctx) => {
        if (ctx.data.length === 0)
        {
          return "?";
        }
        return printNumber(getFloat(ctx.data) / 32) + " s";
});

reg(['T_MIN_GONG'], (ctx) => {
        if (ctx.data.length === 0)
        {
          return "?";
        }
        return printNumber(getFloat(ctx.data) / 128) + " s";
});

reg(['SCHRITTE_KENN_UMSCHAL', 'SVT_SCHRITTE'], (ctx) => {
        if (ctx.data.length === 0)
        {
          return "?";
        }
        return printNumber(getFloat(ctx.data) * 10) + " steps";
});

reg(['CYCL_TI_BLK', 'CYCL_TI_BLK_LM2', 'DEF_ZYKL_TIPP_BLK_CKM', 'MIND_ANZ_ZYKL_TIPP_BLK', 'MIND_ANZ_ZYKL_TIPP_BLK_1', 'MIND_ANZ_ZYKL_TIPP_BLK_2', 'MIND_ANZ_ZYKL_TIPP_BLK_3', 'UNP_ZYKL_TIPP_BLK_CKM', 'ANZAHL_NACHWISCHZ_FRONT', 'ANZAHL_NACHWISCHZ_HECK', 'HAFT_ANZ_RUECKSTEL_BIS_FS', 'HAFT_ANZAHL_RUECKSTELL', 'N_FSW', 'STREETLAMP_COUNT', 'WDHSPERRE_HECKKLAPPE', 'WDHSPERRE_HKSCHEIBE', 'WIEDERHOLSPERRE_ER', 'WL_ZYKLEN'], (ctx) => {
        if (ctx.data.length === 0)
        {
          return "?";
        }
        return printNumber(getFloat(ctx.data)) + " times";
});

reg(['ANZ_EIN_N_BLOCK_FRWISCHER', 'ANZ_EIN_N_BLOCK_HKWISCHER', 'ANZ_NACHWISCH_FRSCH_WASCH', 'ANZ_NACHWISCH_HKSCH_WASCH'], (ctx) => {
        if (ctx.data.length === 0)
        {
          return "?";
        }
        if (ctx.data[0] >= 0xff)
        {
          return "undefined";
        }
        return printNumber(getFloat(ctx.data)) + " times";
});

reg(['MAX_BETAETIGUNG_FOMEHO'], (ctx) => {
        if (ctx.data.length === 0)
        {
          return "?";
        }
        return ((ctx.data[0] > 0) ? printNumber(getFloat(ctx.data) - 1) : "∞") + " times";
});

reg(['REF_BORD_SPG'], (ctx) => {
        if (ctx.data.length === 0)
        {
          return "?";
        }
        return printNumber(getFloat(ctx.data) / 10) + " V";
});

reg(['ACHSE_OBERGRENZE', 'ACHSE_UNTERGRENZE', 'KL_30_UGRENZE', 'U_DIMMUNG_STANDL', 'U_GEDIMM_BLK_V', 'U_GEDIMM_BREMSL', 'U_LWR_POTI_STELLUNG_0', 'U_LWR_POTI_STELLUNG_1', 'U_LWR_POTI_STELLUNG_2', 'U_POTI_DIMM_DELTA', 'U_POTI_DIMM_MIN', 'U_POTI_DIMMER_DELTA', 'U_POTI_DIMMER_MIN', 'U_POTI_STELLUNG_0', 'U_POTI_STELLUNG_1', 'U_POTI_STELLUNG_2'], (ctx) => {
        if (ctx.data.length === 0)
        {
          return "?";
        }
        return printNumber(getFloat(ctx.data) * 5 / 255) + " V";
});

reg(['ENERGIE_UBATT_LIMIT', 'SP_GRENZE', 'WERT_SPANNUNG_0', 'WERT_SPANNUNG_1', 'WERT_SPANNUNG_2', 'WERT_SPANNUNG_3', 'WERT_SPANNUNG_4', 'WERT_SPANNUNG_5'], (ctx) => {
        if (ctx.data.length === 0)
        {
          return "?";
        }
        return printNumber(getFloat(ctx.data) * 18 / 255) + " V";
});

reg(['MAX_MOTORSP._MSB/LSB', 'MIN_MOTORSP._MSB/LSB'], (ctx) => {
        if (ctx.data.length === 0)
        {
          return "?";
        }
        return printNumber(getFloat(ctx.data) * 23 / 1023) + " V";
});

reg(['KEINE_SPANNUNG_KL30', 'MAX_SPANNUNG_KL15_MSB/LSB', 'MAX_SPANNUNG_KL30_MSB/LSB', 'MIN_SPANNUNG_KL15_MSB/LSB', 'MIN_SPANNUNG_KL30'], (ctx) => {
        if (ctx.data.length === 0)
        {
          return "?";
        }
        return printNumber(getFloat(ctx.data) * 30 / 1023) + " V";
});

reg(['EFFEKTIVSPANNUNG_LAMPEN'], (ctx) => {
        if (ctx.data.length === 0)
        {
          return "?";
        }
        return printNumber((getFloat(ctx.data) / 40) + 9.625) + " V";
});

reg(['ABSCHALTUNG_UNTERSPG'], (ctx) => {
        if (ctx.data.length === 0)
        {
          return "?";
        }
        return printNumber((((ctx.data[0] > 0) ? getFloat(ctx.data) : 132) * 18 / 255) + 0.7) + " V";
});

reg(['PWM_AL', 'PWM_AN_BLK_H', 'PWM_AN_BLK_H_34', 'PWM_AN_NSL_SL', 'PWM_AN_SL_V_AL_1', 'PWM_AN_SL_V_AL_1_34', 'PWM_AN_SL_V_FL_1', 'PWM_AN_SL_V_FL_1_34', 'PWM_ANS_RL_BL_2_AL', 'PWM_ANS_RL_BL_2_AL_33', 'PWM_ANS_RL_BL_2_FL', 'PWM_ANS_RL_BL_2_FL_33', 'PWM_ANST_1_UNBELEGT', 'PWM_ANST_2_UNBELEGT', 'PWM_ANST_3_UNBELEGT', 'PWM_ANST_BL_2_SL', 'PWM_ANST_FL_BIXENON', 'PWM_ANST_NSL_SL', 'PWM_ANST_RL_BL_1_BL', 'PWM_ANST_RL_BL_1_L_BL', 'PWM_ANST_RL_BL_1_R_BL', 'PWM_ANST_RL_BL_2_AL', 'PWM_ANST_RL_BL_2_BL', 'PWM_ANST_RL_BL_2_FL', 'PWM_ANST_RL_BL_2_L_BL', 'PWM_ANST_RL_BL_2_R_BL', 'PWM_ANST_RL_BL_BL', 'PWM_ANST_RL_BL_BL_33', 'PWM_ANSTEUERUNG_AL', 'PWM_ANSTEUERUNG_AL_33', 'PWM_ANSTEUERUNG_AL_L', 'PWM_ANSTEUERUNG_AL_LM2', 'PWM_ANSTEUERUNG_AL_R', 'PWM_ANSTEUERUNG_BFD_AUSG', 'PWM_ANSTEUERUNG_BIXENON', 'PWM_ANSTEUERUNG_BL', 'PWM_ANSTEUERUNG_BL_L', 'PWM_ANSTEUERUNG_BL_M', 'PWM_ANSTEUERUNG_BL_M_1', 'PWM_ANSTEUERUNG_BL_MITTE', 'PWM_ANSTEUERUNG_BL_R', 'PWM_ANSTEUERUNG_BLK_H', 'PWM_ANSTEUERUNG_BLK_H_L', 'PWM_ANSTEUERUNG_BLK_H_R', 'PWM_ANSTEUERUNG_BLK_HI', 'PWM_ANSTEUERUNG_BLK_LH', 'PWM_ANSTEUERUNG_BLK_LV', 'PWM_ANSTEUERUNG_BLK_LZ', 'PWM_ANSTEUERUNG_BLK_RH', 'PWM_ANSTEUERUNG_BLK_RV', 'PWM_ANSTEUERUNG_BLK_RZ', 'PWM_ANSTEUERUNG_BLK_V', 'PWM_ANSTEUERUNG_BLK_V_2', 'PWM_ANSTEUERUNG_BLK_V_L', 'PWM_ANSTEUERUNG_BLK_V_L_2', 'PWM_ANSTEUERUNG_BLK_V_R', 'PWM_ANSTEUERUNG_BLK_V_R_2', 'PWM_ANSTEUERUNG_BLK_VORN', 'PWM_ANSTEUERUNG_BLK_Z', 'PWM_ANSTEUERUNG_BLK_Z_L', 'PWM_ANSTEUERUNG_BLK_Z_R', 'PWM_ANSTEUERUNG_FERNLICHT', 'PWM_ANSTEUERUNG_FL', 'PWM_ANSTEUERUNG_FL_33', 'PWM_ANSTEUERUNG_FL_34', 'PWM_ANSTEUERUNG_FL_L', 'PWM_ANSTEUERUNG_FL_R', 'PWM_ANSTEUERUNG_IB', 'PWM_ANSTEUERUNG_IB2', 'PWM_ANSTEUERUNG_IL', 'PWM_ANSTEUERUNG_KZL', 'PWM_ANSTEUERUNG_KZL_33', 'PWM_ANSTEUERUNG_KZL_L', 'PWM_ANSTEUERUNG_KZL_R', 'PWM_ANSTEUERUNG_NSL', 'PWM_ANSTEUERUNG_NSL_33', 'PWM_ANSTEUERUNG_NSL_BL', 'PWM_ANSTEUERUNG_NSL_L', 'PWM_ANSTEUERUNG_NSL_LI', 'PWM_ANSTEUERUNG_NSL_R', 'PWM_ANSTEUERUNG_NSL_SL', 'PWM_ANSTEUERUNG_NSW', 'PWM_ANSTEUERUNG_NSW_L', 'PWM_ANSTEUERUNG_NSW_R', 'PWM_ANSTEUERUNG_RFS', 'PWM_ANSTEUERUNG_RFS_33', 'PWM_ANSTEUERUNG_RFS_34', 'PWM_ANSTEUERUNG_RFS_L', 'PWM_ANSTEUERUNG_RFS_R', 'PWM_ANSTEUERUNG_RL', 'PWM_ANSTEUERUNG_RL_33', 'PWM_ANSTEUERUNG_RL_BL', 'PWM_ANSTEUERUNG_RL_BL_1', 'PWM_ANSTEUERUNG_RL_BL_1_L', 'PWM_ANSTEUERUNG_RL_BL_1_R', 'PWM_ANSTEUERUNG_RL_BL_2', 'PWM_ANSTEUERUNG_RL_BL_2_L', 'PWM_ANSTEUERUNG_RL_BL_2_R', 'PWM_ANSTEUERUNG_RL_BL_L', 'PWM_ANSTEUERUNG_RL_BL_R', 'PWM_ANSTEUERUNG_SL2_RE_HI', 'PWM_ANSTEUERUNG_SL3_LI_HI', 'PWM_ANSTEUERUNG_SL3_RE_HI', 'PWM_ANSTEUERUNG_SL_H', 'PWM_ANSTEUERUNG_SL_LH', 'PWM_ANSTEUERUNG_SL_LHI', 'PWM_ANSTEUERUNG_SL_LI_HI', 'PWM_ANSTEUERUNG_SL_LV', 'PWM_ANSTEUERUNG_SL_RE_HI', 'PWM_ANSTEUERUNG_SL_RH', 'PWM_ANSTEUERUNG_SL_RHI', 'PWM_ANSTEUERUNG_SL_RV', 'PWM_ANSTEUERUNG_SL_V', 'PWM_ANSTEUERUNG_SL_V_AL', 'PWM_ANSTEUERUNG_SL_V_FL', 'PWM_ANSTEUERUNG_SL_V_I', 'PWM_ANSTEUERUNG_SL_V_L', 'PWM_ANSTEUERUNG_SL_V_R', 'PWM_ANSTEUERUNG_SL_VO_LI', 'PWM_ANSTEUERUNG_SL_VO_RE', 'PWM_ANSTEUERUNG_SML', 'PWM_ANSTEUERUNG_SML_33', 'PWM_ANSTEUERUNG_VA', 'PWM_ANSTEUERUNG_VFB', 'PWM_ANSTEUERUNG_ZU_1', 'PWM_ANSTEUERUNG_ZU_2', 'PWM_ANSTEUERUNG_ZU_3', 'PWM_ANSTEUERUNG_ZUSTZBLK', 'PWM_BFD', 'PWM_BFD_3R', 'PWM_BFD_ALS_SL', 'PWM_BFD_ERSETZT_RL_BL_1', 'PWM_BFD_ERSETZT_SL_1', 'PWM_BFD_FKT_SL', 'PWM_BL1__GR_BL', 'PWM_BL1__KL_BL', 'PWM_BL2__GR_BL', 'PWM_BL_FKT_BL', 'PWM_BL_FKT_SL', 'PWM_BL_M', 'PWM_BL_M_1', 'PWM_BLK_H', 'PWM_BLK_V', 'PWM_BLK_V_FKT_SIDEMARKER', 'PWM_BLK_Z', 'PWM_FL', 'PWM_FL_ALS_CORNERLIGHT', 'PWM_FL_BEI_BIXENON', 'PWM_FL_BIX', 'PWM_FL_FKT_DRL', 'PWM_FL_FKT_DRL_33', 'PWM_FL_FKT_DRL_3R', 'PWM_FL_N', 'PWM_FL_NSW_FKT_ABBLIEGEL', 'PWM_FL_NSW_FKT_ABBLIEGELI', 'PWM_FRA_H', 'PWM_FRA_H_FKT_BFD', 'PWM_FRA_V', 'PWM_FRA_V_FKT_SIDEMARKER', 'PWM_FRA_Z_AN_SML', 'PWM_IB', 'PWM_KZL', 'PWM_KZL_3R', 'PWM_NSL', 'PWM_NSL_FKT_BFD', 'PWM_NSL_FKT_BL_BEI_BFD', 'PWM_NSL_FKT_SL', 'PWM_NSL_ODER_BFD_ALS_BL', 'PWM_NSL_ODER_BFD_FKT_BL', 'PWM_NSW', 'PWM_NSW_3R', 'PWM_NSW_FKT_PARKL', 'PWM_NSW_FKT_TFL', 'PWM_NSW_PARKL', 'PWM_NSW_TFL', 'PWM_PIN_05_62', 'PWM_PIN_05_62_33', 'PWM_PIN_05_62_34', 'PWM_PIN_11_63', 'PWM_PIN_11_63_33', 'PWM_PIN_22_68_24_39', 'PWM_PIN_25_40', 'PWM_POL', 'PWM_POL_BEI_AKTIVEN_AL', 'PWM_POL_BEI_AKTIVEN_FL', 'PWM_RFS', 'PWM_RL1_ERS_BL1', 'PWM_RL_BL_1_FKT_BL', 'PWM_RL_BL_1_FKT_PARKL', 'PWM_RL_BL_1_FKT_PARKL_33', 'PWM_RL_BL_1_FKT_PARKL_C09', 'PWM_RL_BL_1_FKT_SL', 'PWM_RL_BL_2_FKT_BL', 'PWM_RL_BL_2_FKT_SL', 'PWM_RL_BL_FKT_BL', 'PWM_RL_BL_FKT_SL', 'PWM_SIDEMARKER_BLK_V', 'PWM_SL_1_FKT_BL_TFL', 'PWM_SL_1_FKT_PARKL', 'PWM_SL_1_FKT_SL_TFL', 'PWM_SL_1_FKT_SL_TFL_DIMM', 'PWM_SL_2_FKT_BL', 'PWM_SL_2_FKT_SL', 'PWM_SL_V', 'PWM_SL_V_BEI_AKTIV_AL_C09', 'PWM_SL_V_BEI_AKTIV_FL_C09', 'PWM_SL_V_BEI_AKTIVEN_AL', 'PWM_SL_V_BEI_AKTIVEN_FL', 'PWM_VFB', 'PWM_WERT2_ALS_BL_AUSGANG', 'PWM_WERT2_ALS_SL_AUSGANG', 'PWM_WERT2_BLK_ZUSATZFKT', 'PWM_WERT2_FL_BIXENON', 'PWM_WERT2_FL_BIXENON_LM2', 'PWM_WERT2_NSL_ZUSATZFKT', 'PWM_WERT2_SL3_ZUSATZFKT'], (ctx) => {
        if (ctx.data === null)
        {
          return "?";
        }
        if (ctx.data.length === 2)
        {
          switch (ctx.module)
          {
          case "LM2_E83":
          case "LSZ":
            return null;
          case "FRM3_E7X":
          case "FRM3_E89":
          case "FRM3_R56":
            if (ctx.data[0] <= 15)
            {
              return printNumber(getFloat(Uint8Array.from([ctx.data[1], ctx.data[0] ])) * 18 / 4095) + " V";
            }
            return printNumber(getFloat(Uint8Array.from([ctx.data[1], (ctx.data[0] & 0xF) ])) * 100 / 4095) + " %";
          default:
            if (ctx.data[1] <= 15)
            {
              return printNumber(getFloat(ctx.data) * 18 / 4095) + " V";
            }
            return printNumber(getFloat(Uint8Array.from([ctx.data[0], (ctx.data[1] & 0xF) ])) * 100 / 4095) + " %";
          }
        }
        switch (ctx.module)
        {
        case "LCM":
        case "LSZ":
          return null;
        case "LM_AHL":
        case "LM_E60":
        case "LM_E65":
        case "LM_RR":
          return null;
        default:
          return printNumber(getFloat(ctx.data) * 18 / 255) + " V";
        }
});

reg(['CBS_GELB'], (ctx) => {
        if (ctx.data.length === 0)
        {
          return "?";
        }
        return printNumber(getFloat(ctx.data)) + " weeks";
});

reg(['BACKUP_DESTINATION_ADDRES', 'BACKUP_SMSC_ADDRESS', 'DEF_DESTINATION_ADDRESS', 'DEFAULT_SMSC_ADDRESS', 'GATS_SMS_DESTIN_BACKUP', 'GATS_SMS_DESTIN_DEFAULT', 'GATS_SMSC_BACKUP', 'GATS_SMSC_DEFAULT', 'GATS_SMSC_OR_AMPS_BACKUP', 'GATS_SMSC_OR_AMPS_DFLT', 'HOTLINE_ADDRESS', 'INCOMING_RS_CALL_NR_BKUP', 'INCOMING_RS_CALL_NUMBER', 'INCOMING_SVT_CALL_NR_BKUP', 'INCOMING_SVT_CALL_NUMBER', 'NON_TELEMATIC_E_CALL_NR', 'NON_TELEMATIC_ECALL_NR', 'OUTGOING_RS_CALL_NUMBER', 'OUTGOING_SVT_CALL_NUMBER', 'EMERGENCY_NUMBER', 'BT_UFN'], (ctx) => {
        if (ctx.data.length === 0)
        {
          return "?";
        }
        return getString(ctx.data);
});

// Generated 149 formula groups from 1034 case arms.
