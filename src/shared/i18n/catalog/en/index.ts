/**
 * English catalog — the source of truth for every translatable string.
 *
 * One file per top-level namespace (see this directory). Add a namespace per
 * app/surface and register it below. Leaves are strings; interpolate with
 * `{name}` placeholders. Plurals give `.one` / `.other` (and `.few`/`.many`/…
 * where a locale needs them), read with `translator.tn(baseKey, count)`.
 *
 * `as const` on each namespace file is required: the key type and interpolation
 * checks derive from these literals.
 */
import { common } from "./common";
import { menu } from "./menu";
import { settings } from "./settings";
import { launcher } from "./launcher";
import { workspace } from "./workspace";
import { story } from "./story";
import { storyInspector } from "./storyInspector";
import { assets } from "./assets";
import { blueprint } from "./blueprint";
import { characters } from "./characters";
import { properties } from "./properties";
import { motion } from "./motion";
import { storyVars } from "./storyVars";
import { uiEditor } from "./uiEditor";
import { widgets } from "./widgets";
import { widgetAppearance } from "./widgetAppearance";
import { widgetChrome } from "./widgetChrome";
import { console } from "./console";
import { project } from "./project";
import { welcome } from "./welcome";
import { actions } from "./actions";
import { placeholders } from "./placeholders";
import { wizard } from "./wizard";
import { devMode } from "./devMode";
import { pluginPermission } from "./pluginPermission";
import { dialogs } from "./dialogs";
import { defaultDoc } from "./defaultDoc";
import { build } from "./build";
import { dashboard } from "./dashboard";

export const en = {
    common,
    menu,
    settings,
    launcher,
    workspace,
    story,
    storyInspector,
    assets,
    blueprint,
    characters,
    properties,
    motion,
    storyVars,
    uiEditor,
    widgets,
    widgetAppearance,
    widgetChrome,
    console,
    project,
    welcome,
    actions,
    placeholders,
    wizard,
    devMode,
    pluginPermission,
    dialogs,
    defaultDoc,
    build,
    dashboard,
} as const;
