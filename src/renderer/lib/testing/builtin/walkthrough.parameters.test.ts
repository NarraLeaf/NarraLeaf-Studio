import { describe, expect, it, vi } from "vitest";
import { STORY_DOCUMENT_SCHEMA_VERSION, type StoryBlock, type StoryDocument } from "@shared/types/story";
import type { ServiceRegistry } from "@/lib/workspace/services/serviceRegistry";
import { Services } from "@/lib/workspace/services/services";
import { resolveTestParameters } from "../parameters";
import { coerceParameter, describeParameter } from "../runCommandLineTest";
import { createWalkthroughTest } from "./walkthrough";

vi.mock("@/lib/app/bridge", () => ({
    getInterface: () => ({}),
    getPrivilegedInterface: () => ({}),
}));

function walkthroughEndings(names: string[]) {
    const blocks = names.map((name, index) => ({
        id: `ending-${index}`,
        kind: "control",
        parentId: null,
        childrenIds: [],
        payload: { control: "ending", name },
    }) as StoryBlock);
    const document: StoryDocument = {
        schemaVersion: STORY_DOCUMENT_SCHEMA_VERSION,
        id: "story",
        name: "Main",
        chapters: [{ id: "chapter", name: "Chapter", sceneIds: ["scene"] }],
        scenes: {
            scene: {
                id: "scene",
                name: "Roof",
                runtimeName: "scene",
                rootBlockIds: blocks.map(block => block.id),
                blocks: Object.fromEntries(blocks.map(block => [block.id, block])),
            },
        },
    } as StoryDocument;
    const services = {
        get: (id: Services) => {
            if (id !== Services.Story) throw new Error(`Unexpected service ${id}`);
            return {
                getLibraryIndex: () => ({ stories: [{ id: "story", name: "Main" }] }),
                getLoadedStoryDocument: () => document,
            };
        },
    } as unknown as ServiceRegistry;
    const definition = createWalkthroughTest({ services: () => services });
    const [parameter] = resolveTestParameters(definition, { projectPath: "project", frozen: false, distrusted: false });
    if (!parameter || parameter.kind !== "select") throw new Error("Expected an ending select");
    return parameter;
}

describe("walkthrough command-line ending names", () => {
    it("resolves each listed ending when an authored name resembles a numbered duplicate", () => {
        const parameter = walkthroughEndings(["End", "End", "Main / Roof / End (2)", "Main / Roof / End (3)"]);
        const listing = describeParameter(parameter);

        for (const [index, option] of (listing.options ?? []).entries()) {
            expect(coerceParameter(parameter, option.value)).toEqual({ ok: true, value: `story/ending-${index}` });
        }
        expect(listing.options?.map(option => option.value)).toEqual([
            "Main / Roof / End", "Main / Roof / End (4)", "Main / Roof / End (2)", "Main / Roof / End (3)",
        ]);
    });

    it("matches Unicode case using the same rules as the listed names", () => {
        const parameter = walkthroughEndings([
            "終幕", "終幕", "Main / Roof / 終幕 (2)", "Été", "ÉTÉ", "é", "e\u0301",
            "İ", "i\u0307", "Main / Roof / İ (2)", "i", "ΟΣ", "ος", "οσ",
        ]);
        const options = describeParameter(parameter).options ?? [];

        expect(options.map(option => option.value)).toEqual([
            "Main / Roof / 終幕", "Main / Roof / 終幕 (3)", "Main / Roof / 終幕 (2)",
            "Main / Roof / Été", "Main / Roof / ÉTÉ (2)", "é", "e\u0301",
            "Main / Roof / İ", "Main / Roof / i\u0307 (3)", "Main / Roof / İ (2)", "i",
            "Main / Roof / ΟΣ", "Main / Roof / ος (2)", "οσ",
        ]);
        for (const [index, option] of options.entries()) {
            expect(coerceParameter(parameter, `  ${option.value.toLowerCase()}  `))
                .toEqual({ ok: true, value: `story/ending-${index}` });
        }
    });
});
