import path from "path";
import type { AgentGuideChapter } from "@shared/agent/tools";

/**
 * Where each guide chapter lives inside the bundled skill folder
 * (`resources/agent/skills/narraleaf-make-game/`).
 *
 * `workflow` is the skill's own `SKILL.md`; every other chapter is a file under `references/`. The
 * same folder is copied to the author's desktop as the agent skill, so the MCP resources and the
 * skill can never say different things. A chapter may be filed under a longer name than its id
 * (`ui-design` as `ui-design-guide.md`), so each id lists the names it is looked for under, first
 * match wins.
 */
export function guideFileCandidates(chapter: AgentGuideChapter): string[][] {
    if (chapter === "workflow") {
        return [["SKILL.md"]];
    }
    const names = [`${chapter}.md`, `${chapter}-guide.md`];
    return names.map(name => ["references", name]);
}

/**
 * `SKILL.md` opens with YAML front matter (`name`, `description`) that is addressed to the skill
 * loader, not to the reader; served as a guide chapter it is noise, so it is cut.
 */
export function stripFrontMatter(text: string): string {
    const match = /^﻿?---\r?\n[\s\S]*?\r?\n---[ \t]*(\r?\n|$)/.exec(text);
    return match ? text.slice(match[0].length).replace(/^\s*\n/, "") : text;
}

/** A plugin's guide chapter is read whole into an answer; past this it is not served. */
export const AGENT_PLUGIN_GUIDE_MAX_BYTES = 256 * 1024;

/**
 * Where a plugin's guide chapter is on disk, or null when the declared path would leave the plugin's
 * package. The manifest validator already refused such a path at install; this is the second look a
 * path from a file on disk gets before main reads it.
 */
export function pluginGuideFile(installPath: string, relative: string): string | null {
    const root = path.resolve(installPath);
    const file = path.resolve(root, ...relative.split(/[\\/]+/).filter(Boolean));
    const inside = path.relative(root, file);
    if (!inside || inside.startsWith("..") || path.isAbsolute(inside) || !file.toLowerCase().endsWith(".md")) {
        return null;
    }
    return file;
}
