/**
 * The generated catalogue the agent skill ships under `references/catalog/`: what Studio has, named
 * the way Studio's interface names it, in Chinese and English.
 *
 * Written for two readers. An agent driving Studio reads it to find the exact name of a node, a
 * field or a command. A person - or a search tool indexing the public skills repository - reads it
 * to answer "how do I ..." in the words the interface uses, not the words the source uses.
 *
 * Nothing here is written by hand. `skillCatalog.test.ts` compares every file with what these
 * functions produce and fails when the two differ; running it with `-u` rewrites the files.
 *
 * Comments in English per project convention.
 */

import { generatedHeader, joinLines } from "./catalogText";
import { renderBlueprintNodePages } from "./blueprintNodes";
import { renderHelpPage, renderShortcutsPage } from "./shortcutsAndHelp";
import { renderStoryCommandsPage } from "./storyCommands";
import { listAuthorWidgets, loadWidgetNames } from "./widgetNames";
import { renderWidgetsPage } from "./widgets";

/** Path of each file under `references/catalog/` -> its content. */
export type SkillCatalog = Map<string, string>;

export async function buildSkillCatalog(): Promise<SkillCatalog> {
    const widgetNames = await loadWidgetNames();
    const nodePages = renderBlueprintNodePages(widgetNames);
    const files: SkillCatalog = new Map();
    const nodeTotal = nodePages.reduce((sum, page) => sum + page.count, 0);
    files.set("README.md", joinLines([
        ...generatedHeader("NarraLeaf Studio 目录 · Catalogue", [
            "从 Studio 源码生成的参考目录，所有名称都和 Studio 界面上显示的一致（中文 · English）。回答「某个功能叫什么、在哪、怎么用」时先查这里。",
            "",
            "A reference generated from the Studio source. Every name matches what Studio's interface shows (Chinese · English). Look here first for what a feature is called, where it is and how it is used.",
        ]),
        "## 文件 · Files",
        "",
        "- [help-topics.md](help-topics.md)：Studio 内置帮助（F1）全文，讲每个编辑器和面板怎么操作 · Full text of the in-Studio help",
        "- [shortcuts.md](shortcuts.md)：默认快捷键和鼠标操作 · Default shortcuts and gestures",
        "- [widgets.md](widgets.md)：界面编辑器的控件、属性面板字段和控件事件 · Widgets, their properties and events",
        "- [story-commands.md](story-commands.md)：故事编辑器的 `/` 命令和参数 · Story commands and their parameters",
        `- 蓝图节点 · Blueprint nodes（共 ${nodeTotal} 个）：`,
        ...nodePages.map(page => `  - [${page.label}](${page.file})（${page.count}）`),
    ]));
    files.set("help-topics.md", renderHelpPage());
    files.set("shortcuts.md", renderShortcutsPage());
    files.set("widgets.md", renderWidgetsPage(await listAuthorWidgets(), widgetNames));
    files.set("story-commands.md", renderStoryCommandsPage());
    for (const page of nodePages) {
        files.set(page.file, page.text);
    }
    return files;
}
