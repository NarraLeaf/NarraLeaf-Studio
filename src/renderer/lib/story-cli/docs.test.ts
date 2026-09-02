/**
 * `project/app/story.md` and the built-in `--help`, held to the catalogue they describe.
 *
 * The whole claim this tool makes is that there is no second catalogue to fall behind, and prose is
 * a second catalogue the moment it names a command or copies an output. So the guide is read here
 * rather than trusted: a command token it names must exist, the block it shows as the answer to
 * `command say` must be that answer character for character, and a command or flag can be in one of
 * the guide, the usage text and the code only by being in all three.
 *
 * Comments in English per project convention.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { commandI18nStore } from "@/lib/i18n/commandLocale";
import { listCommandDefs } from "@/apps/workspace/modules/story/scene-editor/commands/registry";
import { describeCommand, formatCommandDetail, queryCommands } from "./catalog";
import { COMMANDS, USAGE } from "./cli";

const GUIDE_PATH = path.resolve(__dirname, "../../../../project/app/story.md");
const GUIDE = fs.readFileSync(GUIDE_PATH, "utf8");

/** The command the guide shows a whole `command <token>` answer for. */
const SAMPLE_TOKEN = "say";

/**
 * Fenced blocks of the guide, by the first line inside them.
 *
 * Which block is which cannot be a line number, or the test breaks every time a paragraph moves.
 */
function fencedBlockStartingWith(firstLine: string): string | null {
    const lines = GUIDE.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
        if (!lines[index].startsWith("```") || lines[index + 1] !== firstLine) {
            continue;
        }
        const end = lines.indexOf("```", index + 1);
        return lines.slice(index + 1, end).join("\n");
    }
    return null;
}

describe("the story guide", () => {
    // Every printed token is the canonical English one, which is what the CLI pins at startup.
    commandI18nStore.setPreference(false);

    it("names only commands that exist", () => {
        const known = new Set(listCommandDefs().flatMap(def => [def.token, ...(def.aliases ?? [])]));
        // `/` followed by a word, anywhere in the guide - which is how a command is written in it.
        const mentioned = new Set(
            [...GUIDE.matchAll(/(?:^|[\s(`])\/([a-z][a-z-]*)\b/gm)].map(match => match[1]),
        );
        expect(mentioned.size).toBeGreaterThan(5);
        expect([...mentioned].filter(token => !known.has(token))).toEqual([]);
    });

    it("shows the answer the command actually gives", () => {
        const shown = fencedBlockStartingWith(`/${SAMPLE_TOKEN}`);
        const detail = describeCommand(SAMPLE_TOKEN);
        expect(detail).not.toBeNull();
        // Regenerate with: node project/app/story.js command say
        expect(shown).toBe(formatCommandDetail(detail as NonNullable<typeof detail>));
    });

    it("says how many commands there are, and is right", () => {
        const claimed = GUIDE.match(/all (\d+), by category/);
        expect(claimed).not.toBeNull();
        expect(Number(claimed![1])).toBe(queryCommands().length);
    });

    it("agrees with the usage text about which commands there are", () => {
        // The command column of the usage text: two spaces, a word, then its arguments. The flag
        // lines under "Common flags" are indented the same way and start with a dash instead.
        const inUsage = [...USAGE.matchAll(/^ {2}([a-z][a-z-]*) /gm)].map(match => match[1]);
        expect([...new Set(inUsage)].sort()).toEqual(Object.keys(COMMANDS).sort());
    });

    it("documents every flag a command takes", () => {
        for (const [command, spec] of Object.entries(COMMANDS)) {
            for (const flag of Object.keys(spec.flags)) {
                expect(USAGE, `${command} --${flag} is not in the usage text`).toContain(`--${flag}`);
                expect(GUIDE, `${command} --${flag} is not in the guide`).toContain(`--${flag}`);
            }
        }
    });

    it("says out loud that this is not a way for an author to write a story", () => {
        // The one sentence that must survive every edit to this file. The format exists because an
        // agent needs one; Studio deliberately offers an author no text-based authoring surface, and
        // a guide that stopped saying so would be read as announcing one.
        expect(GUIDE).toContain("This is a tool format, not a product feature.");
        expect(GUIDE).toContain("A green `check` is not a played scene.");
    });
});
