// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { StoryActionPayload } from "@shared/types/story";
import { CharacterActionEditor } from "./StorySceneActionInspector";

/**
 * The order of a character row's inspector.
 *
 * A `/char` row changes a character's look, and the transition is the setting an author reaches for
 * with it. It sat below 变换, whose fields fill the panel, so a look change's 转场 was under the fold
 * and reached only by scrolling. It now comes before 变换; the rows that have no transition (an
 * entrance, an exit, a move) are drawn as they were.
 */

vi.mock("@/lib/i18n", async importOriginal => ({
    ...(await importOriginal<typeof import("@/lib/i18n")>()),
    useTranslation: () => ({ t: (key: string) => key }),
}));

// No workspace is mounted: the transform card reads the project's presets through it, and a workspace
// that is not ready yet is the state it already handles (no presets to offer).
vi.mock("@/apps/workspace/context", async importOriginal => ({
    ...(await importOriginal<typeof import("@/apps/workspace/context")>()),
    useWorkspace: () => ({ context: null, isInitialized: false }),
}));

function markupFor(payload: Extract<StoryActionPayload, { action: "character" }>): string {
    return renderToStaticMarkup(
        <CharacterActionEditor
            payload={payload}
            storyId="story-1"
            sceneId="scene-1"
            blockId="block-1"
            storyName="Story"
            characters={[]}
            onChange={() => undefined}
        />,
    );
}

describe("a character row's inspector", () => {
    it("puts a look change's transition above its transform", () => {
        const markup = markupFor({ action: "character", operation: "expression", characterId: "mio" });
        const transition = markup.indexOf("storyInspector.section.transition");
        const transform = markup.indexOf("storyInspector.section.transform");
        expect(transition).toBeGreaterThan(-1);
        expect(transform).toBeGreaterThan(-1);
        expect(transition).toBeLessThan(transform);
    });

    it("shows no transition on the rows that take none", () => {
        for (const operation of ["enter", "exit", "move"] as const) {
            const markup = markupFor({ action: "character", operation, characterId: "mio" });
            expect(markup, operation).not.toContain("storyInspector.section.transition");
            expect(markup, operation).toContain("storyInspector.section.transform");
        }
    });
});
