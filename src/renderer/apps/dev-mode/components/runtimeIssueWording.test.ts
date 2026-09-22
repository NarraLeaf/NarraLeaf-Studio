import { afterEach, describe, expect, it } from "vitest";
import { CATALOGS, createTranslator, type TranslationKey } from "@shared/i18n";
import type { StoryActionPayload, StoryBlock, StoryDocument } from "@shared/types/story";
import { STORY_DOCUMENT_SCHEMA_VERSION } from "@shared/types/story";
import type { BlueprintDebugEvent } from "@shared/types/blueprint/debug";
import { containsGeneratedId } from "@shared/utils/generatedId";
import { i18nStore } from "@/lib/i18n";
import type { GameAppRuntimeIssue } from "@/lib/ui-editor/runtime/app/GameAppHost";
import { compileStudioStoryToNlr } from "@/lib/ui-editor/runtime/game/storyCompiler";
import { needsRunningGame, refusal } from "@/lib/ui-editor/runtime/app/runtimeRefusals";
import { storyResumeNotice } from "@/lib/ui-editor/runtime/app/hotReloadResume";
import type { AssetResolutionSite } from "@/lib/ui-editor/runtime/assetResolution";
import {
    assetResolutionIssues,
    blueprintDebugEventIssue,
    locateRuntimeIssue,
    runtimePluginFailureIssue,
    surfacePlaceHeading,
    type StoryRowBundle,
} from "./runtimeIssueModel";

/**
 * The guard over everything that can put a sentence in Dev Mode's issue strip and Issues panel.
 *
 * Each message family is built the way its host builds it - a blueprint stop, a plugin that would not
 * load, a picture that did not come, a story row that did not compile, a node the game app refused -
 * from inputs that are real UUIDs, then located the way `DevModeContent` locates it. What reaches the
 * list must carry no generated id in any catalog language, and in Chinese and Japanese must not be
 * English. The interface never shows a UUID: an id with nothing behind it names nothing an author
 * can find.
 */

const LOCALES = ["en", "zh", "ja"] as const;
type Locale = typeof LOCALES[number];

const SURFACE = "2f6c1d8e-5a4b-4c3d-9e8f-7a6b5c4d3e2f";
const DELETED_SURFACE = "8e7d6c5b-4a39-4281-9f0e-1d2c3b4a5f6e";
const ELEMENT = "b1c2d3e4-f5a6-4b7c-8d9e-0f1a2b3c4d5e";
const ASSET = "43d15d55-9a7e-4c1b-8f3a-2e6d5c4b3a21";
const CHARACTER = "5b0c1e7a-3f7d-4e0a-9d7e-1c2b3a4d5e6f";
const POSE = "8a1d2c3b-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

function story(): StoryDocument {
    const row = (id: string, payload: StoryActionPayload): StoryBlock => ({ id, kind: "action", parentId: null, childrenIds: [], payload });
    const blocks: Record<string, StoryBlock> = {
        enter: row("enter", { action: "character", operation: "enter", characterId: CHARACTER, pose: POSE }),
        bg: row("bg", { action: "setBackground", assetId: ASSET }),
        jump: { id: "jump", kind: "jump", parentId: null, childrenIds: [], payload: { targetSceneId: DELETED_SURFACE } },
    };
    return {
        schemaVersion: STORY_DOCUMENT_SCHEMA_VERSION,
        id: "c0ffee00-1111-4222-8333-444455556666",
        name: "Story",
        chapters: [{ id: "c1", name: "Chapter", sceneIds: ["s1"] }],
        scenes: { s1: { id: "s1", name: "走廊", runtimeName: "corridor", rootBlockIds: Object.keys(blocks), blocks } },
    };
}

const bundle = {
    storyLibrary: {
        documents: { story: story() },
        characters: [],
        assetNames: {},
        animations: {},
        index: { stories: [] },
    },
    ui: {
        uidoc: { surfaces: [{ id: SURFACE, name: "标题" }] },
        savedVariables: {},
        persistentVariables: {},
    },
} as unknown as StoryRowBundle;

/** Every issue family, built in `locale` the way its host builds it. */
async function everyIssue(locale: Locale): Promise<GameAppRuntimeIssue[]> {
    i18nStore.setLocale(locale);
    const t = createTranslator(locale).t;
    const issues: GameAppRuntimeIssue[] = [];

    // Blueprint stops: a node's own (engine-worded) failure, an unwired input, a runaway loop.
    const events: BlueprintDebugEvent[] = [
        { type: "execution.error", executionId: "x1", message: `Element not found: ${ELEMENT}`, nodeId: ELEMENT, surfaceId: SURFACE },
        { type: "execution.error", executionId: "x2", message: needsRunningGame("blueprint.node.next").message, surfaceId: DELETED_SURFACE },
        { type: "execution.error", executionId: "x3", message: "stopped", surfaceId: SURFACE, stepLimit: { steps: 10000, nodeName: "Branch", headName: "On Click" } },
        { type: "node.input_missing", executionId: "x4", nodeId: ELEMENT, nodeName: "Play Sound", pinLabel: "Asset Id", surfaceId: SURFACE } as BlueprintDebugEvent,
    ];
    for (const event of events) {
        const issue = blueprintDebugEventIssue(event, t);
        if (issue) {
            issues.push(issue);
        }
    }

    // Plugins: one whose entry threw (with an id in its own error), and a list that would not read.
    issues.push(runtimePluginFailureIssue({ pluginName: "com.example.weather", error: `bad node ${ELEMENT}` }, t));
    issues.push(runtimePluginFailureIssue({ pluginName: null, error: `ENOENT ${ASSET}` }, t));

    // A picture a widget asked for and did not get.
    const site: AssetResolutionSite = { surfaceId: SURFACE, elementId: ELEMENT, ownerName: "封面", slot: "imageFill", instanceKey: "" };
    issues.push(...assetResolutionIssues([{ site, requested: ASSET, stage: "resolve" }], {}, t));

    // Story rows that did not compile - the reported case among them: a pose pointing at nothing.
    const compiled = await compileStudioStoryToNlr({
        document: story(),
        sceneId: "s1",
        characters: [{ id: CHARACTER, name: "苏幼晴", appearance: { kind: "preset", poses: [{ id: POSE, name: "微笑", assetId: ASSET }], defaultPoseId: POSE } }],
        resolveAssetUrl: async id => { throw new Error(`Asset not found: ${id}`); },
        assetNames: {},
    });
    for (const diagnostic of compiled.diagnostics) {
        issues.push({ level: diagnostic.level, message: diagnostic.message, origin: "compile", ...(diagnostic.blockId ? { blockId: diagnostic.blockId } : {}) });
    }

    // What the game app refuses a node with, and what a reload says when it cannot put the author back.
    for (const error of [
        needsRunningGame("blueprint.node.setSavedVar"),
        needsRunningGame(null),
        refusal("game.run.storyMissing", "blueprint.node.startGame"),
        refusal("game.run.noChoiceAtIndex", "blueprint.node.selectChoice", { index: "3" }),
    ]) {
        issues.push({ level: "error", message: error.message, origin: "interface", surfaceId: SURFACE });
    }
    for (const notice of [
        storyResumeNotice({ kind: "entry", reason: "sceneMissing" } as never),
        storyResumeNotice({ kind: "previousRow" } as never),
    ]) {
        if (notice) {
            issues.push({ level: "warning", message: notice, origin: "session" });
        }
    }
    return issues;
}

afterEach(() => {
    i18nStore.setLocale("en");
});

describe("what reaches the Dev Mode issue list", () => {
    it.each(LOCALES)("carries no generated id, in the message or in the place, in %s", async locale => {
        const t = createTranslator(locale).t;
        const issues = await everyIssue(locale);
        // The families have to actually produce something, or the guard guards nothing.
        expect(issues.length).toBeGreaterThan(14);
        issues.forEach((issue, index) => {
            const located = locateRuntimeIssue(bundle, issue, `issue-${index}`);
            expect(containsGeneratedId(located.message), located.message).toBe(false);
            if (located.surface) {
                const heading = surfacePlaceHeading(located.surface, t);
                expect(containsGeneratedId(heading), heading).toBe(false);
            }
        });
    });

    it.each(["zh", "ja"] as const)("is not English in %s", async locale => {
        const issues = await everyIssue(locale);
        for (const issue of issues) {
            const message = locateRuntimeIssue(bundle, issue, "issue").message;
            // Three fixtures carry text Studio did not write - the engine's own error, and the two
            // plugin failures' error text - which reaches the list verbatim (with its ids taken out).
            // Only Studio's wording is held to the language here.
            const own = message.replace(/Element not found: …|bad node …|ENOENT …|com\.example\.weather/g, "");
            expect(own, message).not.toMatch(/[A-Za-z]+ [A-Za-z]+ [A-Za-z]+/);
        }
    });

    it("names a page the document no longer has as gone, not by its id", () => {
        const located = locateRuntimeIssue(bundle, { level: "error", message: "x", origin: "interface", surfaceId: DELETED_SURFACE }, "issue");
        expect(located.surface).toEqual({ surfaceId: DELETED_SURFACE, surfaceName: null });
        expect(surfacePlaceHeading(located.surface!, createTranslator("zh").t)).toBe("位于已不在本项目中的界面");
    });

    it("keeps an engine's own sentence, with the id taken out", () => {
        const located = locateRuntimeIssue(bundle, { level: "error", message: `Element not found: ${ELEMENT}`, origin: "interface" }, "issue");
        expect(located.message).toBe("Element not found: …");
    });
});

/**
 * The templates themselves: no runtime issue sentence may be written to take an id. A placeholder
 * named like one (`{assetId}`, `{blockId}`, `{fnRef}`) is where an id would go in.
 */
describe("the runtime issue catalog", () => {
    const FAMILIES = ["story.compile", "story.preview.diagnostics", "game.run", "blueprint.runtimeError", "devMode.issues"];

    function leaves(value: unknown, prefix: string, out: [string, string][]): void {
        if (typeof value === "string") {
            out.push([prefix, value]);
            return;
        }
        if (value && typeof value === "object") {
            for (const [key, child] of Object.entries(value)) {
                leaves(child, prefix ? `${prefix}.${key}` : key, out);
            }
        }
    }

    it.each(LOCALES)("has no id-shaped placeholder in %s", locale => {
        const entries: [string, string][] = [];
        leaves(CATALOGS[locale as keyof typeof CATALOGS], "", entries);
        const family = entries.filter(([key]) => FAMILIES.some(root => key === root || key.startsWith(`${root}.`)));
        expect(family.length).toBeGreaterThan(150);
        for (const [key, template] of family) {
            for (const [, name] of template.matchAll(/\{([A-Za-z]+)\}/g)) {
                expect(/(Id|Ref|^id)$/.test(name!), `${key}: {${name}}`).toBe(false);
            }
        }
    });

    it("gives every family key a translation in zh and ja", () => {
        const en: [string, string][] = [];
        leaves(CATALOGS.en, "", en);
        const t = { zh: createTranslator("zh"), ja: createTranslator("ja") };
        for (const [key] of en.filter(([key]) => FAMILIES.some(root => key.startsWith(`${root}.`)))) {
            for (const locale of ["zh", "ja"] as const) {
                expect(t[locale].has(key as TranslationKey), `${locale} ${key}`).toBe(true);
            }
        }
    });
});
