/**
 * 日本語カタログ。
 *
 * 名前空間ごとに 1 ファイル（このディレクトリを参照）。未翻訳のキーは実行時に英語の
 * ソースカタログへフォールバックするため、段階的に翻訳できる。各ファイルは
 * `satisfies LocaleNamespace<"…">` で制約する。キーの欠落は許すが、綴り違いや
 * 構造の誤りはコンパイルエラーになる。
 *
 * 文体の取り決め（`docs/help-system.md` に対応する日本語側の運用）:
 * - ボタンとラベルは体言止め。説明文は常体の言い切りにし、「です・ます」はあいさつ文にだけ使う。
 * - 1 行で終わる文の末尾に句点は付けない。文が 2 つ以上続くときだけ、間を句点で区切る。
 * - 感嘆符と励ましの文は使わない。理由や仕組みの説明も書かない。何が起きるかだけを書く。
 * - 括弧は全角（）を使う。列挙の読点は「、」。
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
import { saveSchema } from "./saveSchema";
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
import { serverTrust } from "./serverTrust";
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
import type { LocaleMessages } from "../types";

export const ja = {
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
  saveSchema,

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
  serverTrust,
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
  crash
} satisfies LocaleMessages;
