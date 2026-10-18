/**
 * The agent skills Studio ships (`resources/agent/skills/`), held to the code they describe.
 *
 * The same text is the guide `agent_guide` serves, so a stale sentence in it is an agent writing what
 * Studio refuses - or what Studio accepts and does something else with. Prose can say anything; what
 * is checked here is the part that names the code: tools, refusal codes, guide chapters and story
 * commands. The skills are mirrored from the public NarraLeaf/Skills repository, so a failure here is
 * also a change to send back there.
 *
 * Comments in English per project convention.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { AGENT_ERROR_CODES } from "@shared/agent/protocol";
import { AGENT_GUIDE_CHAPTERS, AGENT_TOOLS } from "@shared/agent/tools";
import { commandI18nStore } from "@/lib/i18n/commandLocale";
import { listCommandDefs } from "@/apps/workspace/modules/story/scene-editor/commands/registry";

const SKILLS = path.resolve(__dirname, "../../../../../../resources/agent/skills");
const MAKE_GAME = path.join(SKILLS, "narraleaf-make-game");

function markdownFiles(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
        const full = path.join(dir, entry.name);
        return entry.isDirectory() ? markdownFiles(full) : entry.name.endsWith(".md") ? [full] : [];
    });
}

const DOCS = markdownFiles(SKILLS).map(file => ({
    file: path.relative(SKILLS, file).replace(/\\/g, "/"),
    text: fs.readFileSync(file, "utf8"),
}));

const TOOL_NAMES = new Set(AGENT_TOOLS.map(tool => tool.name));

describe("the agent skills", () => {
    it("are on disk", () => {
        expect(DOCS.length).toBeGreaterThan(10);
    });

    it("name only tools that exist", () => {
        // A tool is written in backticks, and every tool name starts with the word for what it works
        // on (`story_`, `ui_`, `character_` ...). Anything else in snake case that starts the same way
        // is a tool that was renamed or never existed; asset and variable names in the examples
        // (`bg_classroom_day`, `trust_aoi`) start with other words and are left alone.
        const families = new Set([...TOOL_NAMES].filter(name => name.includes("_")).map(name => name.split("_")[0]));
        const unknown = DOCS.flatMap(({ file, text }) =>
            [...text.matchAll(/`([a-z]+(?:_[a-z]+)+)(?=[\s`{(])/g)]
                .map(match => match[1])
                .filter(name => families.has(name.split("_")[0]) && !TOOL_NAMES.has(name))
                .map(name => `${file}: ${name}`));
        expect(unknown).toEqual([]);
    });

    it("mention every tool", () => {
        const all = DOCS.map(doc => doc.text).join("\n");
        const missing = [...TOOL_NAMES].filter(name => !new RegExp(`\\b${name}\\b`).test(all));
        expect(missing).toEqual([]);
    });

    it("list every refusal code in troubleshooting, and no other", () => {
        const chapter = fs.readFileSync(path.join(MAKE_GAME, "references", "troubleshooting.md"), "utf8");
        const listed = [...chapter.matchAll(/^\| `([a-z_]+)` \|/gm)].map(match => match[1]);
        expect([...listed].sort()).toEqual([...AGENT_ERROR_CODES].sort());
    });

    it("have a file for every chapter agent_guide serves", () => {
        // `agentGuide.ts`: `workflow` is SKILL.md, every other chapter a file under `references/`,
        // under its own name or a longer one.
        for (const chapter of AGENT_GUIDE_CHAPTERS) {
            const candidates = chapter === "workflow"
                ? [path.join(MAKE_GAME, "SKILL.md")]
                : [`${chapter}.md`, `${chapter}-guide.md`].map(name => path.join(MAKE_GAME, "references", name));
            expect(candidates.some(file => fs.existsSync(file)), `no file for the "${chapter}" chapter`).toBe(true);
        }
    });

    it("name only story commands that exist", () => {
        // Written as in the story guide: `/` and a word, after a space, a bracket or a backtick, or at
        // the start of a line in an example. The README is left out: its `/mcp` and `/make_game` are
        // the agents' own commands, typed into Claude Code or Gemini CLI.
        commandI18nStore.setPreference(false);
        const known = new Set(listCommandDefs().flatMap(def => [def.token, ...(def.aliases ?? [])]));
        const unknown = DOCS.filter(({ file }) => file !== "README.md").flatMap(({ file, text }) =>
            [...text.matchAll(/(?:^|[\s(`])\/([a-z][a-z-]*)\b/gm)]
                .map(match => match[1])
                .filter(token => !known.has(token))
                .map(token => `${file}: /${token}`));
        expect([...new Set(unknown)]).toEqual([]);
    });
});
