/**
 * English catalog - the source of truth for every translatable string.
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
import { storyExpr } from "./storyExpr";
import { storyInspector } from "./storyInspector";
import { assets } from "./assets";
import { blueprint } from "./blueprint";
import { characters } from "./characters";
import { properties } from "./properties";
import { motion } from "./motion";
import { storyVars } from "./storyVars";
import { storySnapshot } from "./storySnapshot";
import { uiEditor } from "./uiEditor";
import { widgets } from "./widgets";
import { widgetAppearance } from "./widgetAppearance";
import { widgetChrome } from "./widgetChrome";
import { console } from "./console";
import { project } from "./project";
import { welcome } from "./welcome";
import { onboarding } from "./onboarding";
import { about } from "./about";
import { actions } from "./actions";
import { placeholders } from "./placeholders";
import { wizard } from "./wizard";
import { devMode } from "./devMode";
import { developer } from "./developer";
import { pluginPermission } from "./pluginPermission";
import { plugins } from "./plugins";
import { dialogs } from "./dialogs";
import { defaultDoc } from "./defaultDoc";
import { build } from "./build";
import { dashboard } from "./dashboard";
import { lint } from "./lint";
import { documentDiff } from "./documentDiff";
import { test } from "./test";
import { help } from "./help";
import { update } from "./update";
import { brand } from "./brand";
import { game } from "./game";
import { crash } from "./crash";

export const en = {
    common,
    menu,
    settings,
    launcher,
    workspace,
    story,
    storyExpr,
    storyInspector,
    assets,
    blueprint,
    characters,
    properties,
    motion,
    storyVars,
    storySnapshot,
    uiEditor,
    widgets,
    widgetAppearance,
    widgetChrome,
    console,
    project,
    welcome,
    onboarding,
    about,
    actions,
    placeholders,
    wizard,
    devMode,
    developer,
    pluginPermission,
    plugins,
    dialogs,
    defaultDoc,
    build,
    dashboard,
    lint,
    documentDiff,
    test,
    help,
    update,
    brand,
    game,
    crash,
} as const;
