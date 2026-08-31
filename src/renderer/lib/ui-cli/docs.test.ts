/**
 * `project/app/ui.md` and the built-in `--help`, held to the catalogue they describe.
 *
 * The whole claim this tool makes is that there is no second catalogue to fall behind, and prose is
 * a second catalogue the moment it names a widget type or copies an output. So the guide is read
 * here rather than trusted: a widget type it names must exist, the block it shows as the answer to
 * `widget nl.switch` must be that answer character for character, and a command or flag can be in
 * one of the guide, the usage text and the code only by being in all three.
 *
 * Comments in English per project convention.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { UI_STAGE_SLOT_IDS } from "@shared/types/ui-editor/stageSlots";
import { describeWidget, formatWidgetDetail, listWidgetModules } from "./catalog";
import { COMMANDS, USAGE } from "./cli";

const GUIDE_PATH = path.resolve(__dirname, "../../../../project/app/ui.md");
const GUIDE = fs.readFileSync(GUIDE_PATH, "utf8");

/** The widget type the guide shows a whole `widget <type>` answer for. */
const SAMPLE_TYPE = "nl.switch";

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

describe("the interface guide", () => {
    it("names only widget types that exist", () => {
        const mentioned = new Set([...GUIDE.matchAll(/\bnl\.[a-z][A-Za-z.]*/g)].map(match => match[0]));
        expect(mentioned.size).toBeGreaterThan(3);
        const known = new Set(listWidgetModules().map(module => module.type));
        expect([...mentioned].filter(type => !known.has(type))).toEqual([]);
    });

    it("shows the answer the command actually gives", () => {
        const shown = fencedBlockStartingWith(SAMPLE_TYPE);
        const detail = describeWidget(SAMPLE_TYPE);
        expect(detail).not.toBeNull();
        // Regenerate with: node project/app/ui.js widget nl.switch
        expect(shown).toBe(formatWidgetDetail(detail as NonNullable<typeof detail>));
    });

    it("names every stage slot there is, and no others", () => {
        const listed = [...GUIDE.matchAll(/`(onStage|dialog|notification|choice|nvl|sidebar|hud)`/g)].map(
            match => match[1],
        );
        expect([...new Set(listed)].sort()).toEqual([...UI_STAGE_SLOT_IDS].sort());
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

    it("names only diagnostic codes the checker can emit", () => {
        // Both halves matter: a code the guide explains and nothing emits is prose about a finding
        // nobody will ever see, and it reads as a promise.
        const inGuide = new Set([...GUIDE.matchAll(/`(ui\.[a-z_]+)`/g)].map(match => match[1]));
        const sources = ["dsl/compile.ts", "check.ts"]
            .map(file => fs.readFileSync(path.resolve(__dirname, file), "utf8"))
            .join("\n");
        const emitted = new Set([...sources.matchAll(/"(ui\.[a-z_]+)"/g)].map(match => match[1]));
        expect([...inGuide].filter(code => !emitted.has(code))).toEqual([]);
    });
});
