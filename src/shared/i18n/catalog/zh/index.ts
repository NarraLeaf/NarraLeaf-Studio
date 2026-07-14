/**
 * 简体中文目录。
 *
 * 每个顶层命名空间一个文件（见本目录）。未翻译的键会在运行时自动回退到英文源目录，
 * 因此可以增量翻译。每个命名空间文件用 `satisfies LocaleNamespace<"…">` 约束：
 * 允许缺键，但拼错键名或写错结构会编译报错。
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
import type { LocaleMessages } from "../types";

export const zh = {
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
} satisfies LocaleMessages;
