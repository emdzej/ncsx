/**
 * COAPI error numbers — the canonical `RetVal` codes CDH functions return.
 * Pulled verbatim from `NCSEXPER/SGDAT/CABI.H` so IPO scripts that branch on
 * specific error numbers behave identically.
 *
 * Numbers must NOT change — they're cross-referenced from CDH (NCSEXPER), CABD,
 * and the SGBDs themselves. Per the header banner in CABI.H:
 *
 *   "ACHTUNG: Nummern nicht aendern.
 *             Werden auch in CDH, CABD und SGBD verwendet !!!"
 */

// 1000..1019: General errors
export const COAPI_OK = 0;
export const COAPI_ERROR = 1000;
export const COAPI_INVALID_HANDLE = 1001;
export const COAPI_MEM_ERROR = 1002;
export const COAPI_PAR_ERROR = 1003;

// 1020..1039: File errors
export const COAPI_INPUT_FILE_NOT_FOUND = 1020;
export const COAPI_OUTPUT_FILE_NOT_FOUND = 1021;
export const COAPI_READ_INPUT_FILE_ERROR = 1022;
export const COAPI_WRITE_OUTPUT_FILE_ERROR = 1023;
export const COAPI_FILE_ERROR = 1040;
export const COAPI_ZST_FILE_ERROR = 1041;
export const COAPI_CVT_FILE_ERROR = 1042;
export const COAPI_CBD_FILE_ERROR = 1043;
export const COAPI_SGET_FILE_ERROR = 1044;
export const COAPI_SWT_FILE_ERROR = 1045;
export const COAPI_ZCSUT_FILE_ERROR = 1046;
export const COAPI_VMGEN_ERROR = 1047;

// 1060..1079: CABD errors
export const COAPI_CABD_ERROR = 1060;
export const COAPI_CABD_INIT_ERROR = 1061;
export const COAPI_CABD_RESULT_ERROR = 1062;
export const COAPI_CABD_PAR_ERROR = 1063;
export const COAPI_CABD_JOB_ERROR = 1064;

// 1080..1099: Coding-key errors (ZCS / FGNR / BR)
export const COAPI_ZCS_ERROR = 1080;
export const COAPI_GM_KEY_ERROR = 1081;
export const COAPI_SA_KEY_ERROR = 1082;
export const COAPI_VN_KEY_ERROR = 1083;
export const COAPI_AM_KEY_ERROR = 1084;
export const COAPI_FG_KEY_ERROR = 1085;
export const COAPI_BR_ERROR = 1086;

// 1100..1119: SG selection
export const COAPI_SG_NOT_IN_SGET = 1100;

// 1120..1139: Coding-data usage
export const COAPI_DATA_USED_ERROR = 1120;

// 2000..2019: EDIABAS layer
export const COAPI_DIABAS_ERROR = 2000;
export const COAPI_DIABAS_INIT_ERROR = 2001;
export const COAPI_DIABAS_RESULT_ERROR = 2002;
export const COAPI_DIABAS_PAR_ERROR = 2003;
export const COAPI_DIABAS_BINBUF_ERROR = 2004;
export const COAPI_DIABAS_JOB_ERROR = 2005;

// 2020..2039: ECU wire-level
export const COAPI_ECU_TIMEOUT = 2020;
export const COAPI_ECU_TRANSMISSION_ERROR = 2021;
export const COAPI_ECU_UBATT_ERROR = 2022;
export const COAPI_ECU_TEL_ERROR = 2023;
export const COAPI_ECU_READ_BAUDRATE_ERROR = 2024;
export const COAPI_ECU_DELETE_DTC_ERROR = 2025;

// 2040..2059: SG identification
export const COAPI_ECU_ID_ERROR = 2040;
export const COAPI_ECU_CDNR_ERROR = 2041;
export const COAPI_ECU_HWNR_ERROR = 2042;
export const COAPI_ECU_SWNR_ERROR = 2043;

// 2060..2079: Coding errors at the ECU
export const COAPI_ECU_CODING_ERROR = 2060;
export const COAPI_ECU_WRITE_DATA_ERROR = 2061;
export const COAPI_ECU_READ_DATA_ERROR = 2062;
export const COAPI_ECU_COMPARE_DATA_ERROR = 2063;
export const COAPI_ECU_DELETE_DATA_ERROR = 2064;
export const COAPI_ECU_CHECKSUM_ERROR = 2065;
