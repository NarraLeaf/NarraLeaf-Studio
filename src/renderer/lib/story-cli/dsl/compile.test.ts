import { describe, expect, it } from "vitest";
import type { StoryScene } from "@shared/types/story";
import { commandI18nStore } from "@/lib/i18n/commandLocale";
import { buildStoryCommandContext } from "@/apps/workspace/modules/story/scene-editor/storyCommandContext";
import { compileStoryFile } from "./compile";
import { parseStoryFile } from "./parse";

/**
 * What a file that is wrong is told.
 *
 * A refusal is the tool's main output when someone is writing rather than reading, so the message
 * has to name the mistake that was actually made. The indentation pair below is here because the one
 * message used to cover both, and the wrong half sent the reader to inspect a row that was fine.
 */

const SCENE: StoryScene = {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Test",
    rootBlockIds: [],
    blocks: {},
} as unknown as StoryScene;

function check(body: string): string[] {
    commandI18nStore.setPreference(false);
    const source = `#nlstory 1\n#scene Test ⟦${SCENE.id}⟧\n\n${body}\n`;
    const parsed = parseStoryFile(source);
    const context = buildStoryCommandContext({
        assets: undefined,
        characters: [],
        document: null,
        sceneId: SCENE.id,
        scene: SCENE,
    });
    const compiled = compileStoryFile({
        ast: parsed.ast,
        existing: SCENE,
        document: null,
        contextFor: () => context,
        prose: { characterName: () => null, charactersNamed: () => [] },
        conditions: { variableName: () => null },
        mintId: (() => {
            let next = 0;
            return () => `00000000-0000-4000-8000-${String(next++).padStart(12, "0")}`;
        })(),
    });
    return [...parsed.diagnostics, ...compiled.diagnostics].map(d => `${d.code}: ${d.message}`);
}

describe("what a broken file is told", () => {
    it("says how far a line over-indented, rather than blaming the row above", () => {
        // Three levels under a branch that opens two. The row above holds rows perfectly well; the
        // indentation simply skipped a level, which is the ordinary slip.
        const found = check("/if\n  ? true\n      Narra: too deep.");
        expect(found.some(message => /indented 3 levels and the row above it opens 2/.test(message))).toBe(true);
    });

    it("says the row takes no children when that is really the problem", () => {
        const found = check("Narra: a line.\n  Narra: under a line.");
        expect(found.some(message => /takes no children/.test(message))).toBe(true);
        expect(found.some(message => /levels and the row above/.test(message))).toBe(false);
    });

    it("refuses an unknown command instead of reading it as narration", () => {
        // The rule the whole shape test rests on: a `/` line is a command or an error, never prose.
        const found = check("/nosuchcommand hello");
        expect(found.some(message => /No command "\/nosuchcommand"/.test(message))).toBe(true);
    });

    it("names the slot an unfinished line is missing", () => {
        // Studio parks this as a draft row; a file has no draft state, so it has to say what is absent.
        const found = check("/bg");
        expect(found.some(message => /compile\.missing_core.*"image"/.test(message))).toBe(true);
    });

    it("refuses a branch that is not under a condition", () => {
        const found = check("? true");
        expect(found.some(message => /branch only sits under an \/if row/.test(message))).toBe(true);
    });
});
