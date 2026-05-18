import type { Chassis } from "@emdzej/ncsx-chassis";
import type { FunctionList } from "@emdzej/ncsx-function-list";
import type { TranslationFile } from "@emdzej/ncsx-translations";
import type { NcsxInstall } from "./daten-install";

/**
 * Top-level UI states. `picker` is the landing screen; `browse-chassis` once an install
 * is mounted; `browse-modules` once a chassis is selected; `view-module` for a loaded
 * SG's catalog.
 */
export type AppView =
  | "picker"
  | "browse-chassis"
  | "browse-modules"
  | "view-module";

interface AppState {
  view: AppView;
  install: NcsxInstall | null;
  chassis: Chassis | null;
  selectedSg: string | null;
  functionList: FunctionList | null;
  /**
   * Community-maintained NCSDummy-style keyword→English dictionary. Loaded once on app
   * startup from `/translations.csv`; null until the fetch settles. UI components fall
   * back to raw keywords when the lookup is unavailable.
   */
  translations: TranslationFile | null;
  error: string | null;
  busy: boolean;
}

/**
 * Single shared `$state` object. Components import this directly and mutate it; Svelte's
 * runes-mode reactivity propagates the changes.
 */
export const app: AppState = $state({
  view: "picker",
  install: null,
  chassis: null,
  selectedSg: null,
  functionList: null,
  translations: null,
  error: null,
  busy: false,
});
