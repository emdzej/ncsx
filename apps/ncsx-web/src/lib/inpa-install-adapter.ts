import type { InpaInstall } from "@emdzej/inpax-web-provider";
import type { NcsxInstall } from "./daten-install";

/**
 * Adapt `NcsxInstall` to inpax-web-provider's `InpaInstall` shape so we can reuse
 * its `BrowserNativeImportProvider`, `makeBrowserSgbdResolver`, and other helpers
 * unchanged.
 *
 * Our install discovery already finds every directory inpax needs — we just expose
 * them under inpax's canonical field names. **The SGDAT we point at is NCSEXPER's**
 * (`<root>/NCSEXPER/SGDAT/`), not INPA's, because the per-CABD `A_*.ipo` dispatchers
 * live there (see `docs/assumptions.md` A2). Likewise CFGDAT points at NCSEXPER's
 * `COAPI.INI`, not INPA's `INPA.INI`.
 */
export function toInpaInstall(install: NcsxInstall): InpaInstall {
  return {
    root: install.root,
    cfgdat: install.ncsCfgdat,
    sgdat: install.ncsSgdat,
    ecu: install.ediabasEcu,
    ediabasBin: install.ediabasBin,
  };
}
