import { afterEach, describe, expect, it } from "vitest";
import type { Blueprint, BlueprintDocument } from "@shared/types/blueprint/document";
import type { DevModeBundle } from "@shared/types/devMode";
import { mountBlueprintCompiledScripts, type BlueprintScriptIssue } from "./mountBlueprintScripts";
import { unmountCompiledScripts } from "./script/scriptRuntime";

/**
 * What an author is told when a script blueprint will not run.
 *
 * Three failures used to look the same on screen - nothing happened. The compile diagnostic was
 * written into the bundle and never read, a module that threw while loading went to the console,
 * and a module whose handler is misspelled was noticed by nothing at all. Each one now names the
 * author's file and says which of the three it is.
 */

const SURFACE_ID = "surface-1";
const SLIDER_ID = "el-slider";

function scriptBlueprint(id: string, scriptRef: string, owner: Blueprint["owner"]): Blueprint {
    return {
        id,
        name: id,
        owner,
        frontend: "typescript",
        programKind: "scriptModule",
        program: { kind: "scriptModule", scriptRef },
        members: { variables: {}, fields: {}, functions: {} },
        bindings: {},
    } as unknown as Blueprint;
}

function bundle(scripts: DevModeBundle["ui"]["scripts"], blueprints: Record<string, Blueprint>): DevModeBundle {
    return {
        ui: {
            uidoc: {
                surfaces: [{ id: SURFACE_ID, name: "Title", rootElementId: "el-root" }],
                elements: {
                    "el-root": { id: "el-root", type: "nl.container", childrenIds: [SLIDER_ID] },
                    [SLIDER_ID]: { id: SLIDER_ID, type: "nl.slider", childrenIds: [] },
                },
            },
            localBlueprints: { blueprints } as unknown as BlueprintDocument,
            scripts,
        },
    } as unknown as DevModeBundle;
}

const sliderOwner: Blueprint["owner"] = {
    kind: "widgetMain",
    surfaceId: SURFACE_ID,
    elementId: SLIDER_ID,
} as Blueprint["owner"];

function loader(modules: Record<string, Record<string, unknown>>) {
    return async (url: string) => {
        const module = modules[url];
        if (!module) {
            throw new Error(`no module for ${url}`);
        }
        return module;
    };
}

/** Mounts with an injected loader, since these run in Node with no host serving a URL. */
async function mountAndCollect(
    input: DevModeBundle,
    modules: Record<string, Record<string, unknown>>,
): Promise<string[]> {
    const issues: BlueprintScriptIssue[] = [];
    await mountBlueprintCompiledScripts(input, issue => issues.push(issue), loader(modules));
    return issues.map(issue => issue.message);
}

afterEach(() => {
    unmountCompiledScripts();
});

describe("a script that will not run says so", () => {
    it("reports the compile diagnostic the bundle was already carrying", async () => {
        const messages = await mountAndCollect(
            bundle(
                {
                    "bp-1": {
                        scriptRef: "scripts/title.ts",
                        diagnostics: [
                            {
                                severity: "error",
                                message: "scripts/title.ts could not be compiled: Unexpected \"}\"",
                                code: "script.compile",
                            },
                        ],
                    },
                },
                { "bp-1": scriptBlueprint("bp-1", "scripts/title.ts", sliderOwner) },
            ),
            {},
        );
        expect(messages).toEqual(['scripts/title.ts could not be compiled: Unexpected "}"']);
    });

    it("reports a module that throws while loading, naming the file", async () => {
        const messages = await mountAndCollect(
            bundle(
                { "bp-1": { scriptRef: "scripts/title.ts", url: "file:///missing.mjs" } },
                { "bp-1": scriptBlueprint("bp-1", "scripts/title.ts", sliderOwner) },
            ),
            {},
        );
        expect(messages).toHaveLength(1);
        expect(messages[0]).toContain("scripts/title.ts could not be loaded");
    });

    it("names the handler the author wrote and the ones this slot calls", async () => {
        const messages = await mountAndCollect(
            bundle(
                { "bp-1": { scriptRef: "scripts/volume.ts", url: "file:///a.mjs" } },
                { "bp-1": scriptBlueprint("bp-1", "scripts/volume.ts", sliderOwner) },
            ),
            // The exact shape of the original defect: the declarations say `onSliderValueChanged`,
            // and an author who guessed from the slot name writes this instead.
            { "file:///a.mjs": { onValueChanged: () => undefined } },
        );
        expect(messages).toHaveLength(1);
        expect(messages[0]).toContain("scripts/volume.ts exports onValueChanged");
        expect(messages[0]).toContain("onSliderValueChanged");
    });

    it("says nothing about a script whose handler this slot does call", async () => {
        const messages = await mountAndCollect(
            bundle(
                { "bp-1": { scriptRef: "scripts/volume.ts", url: "file:///a.mjs" } },
                { "bp-1": scriptBlueprint("bp-1", "scripts/volume.ts", sliderOwner) },
            ),
            { "file:///a.mjs": { onSliderValueChanged: () => undefined } },
        );
        expect(messages).toEqual([]);
    });

    it("says nothing about a story row, whose own compiler reports against the block", async () => {
        const messages = await mountAndCollect(
            bundle(
                { "bp-story": { scriptRef: "scripts/intro.ts", url: "file:///b.mjs" } },
                {
                    "bp-story": scriptBlueprint("bp-story", "scripts/intro.ts", {
                        kind: "storyAction",
                        blueprintId: "bp-story",
                    } as Blueprint["owner"]),
                },
            ),
            { "file:///b.mjs": {} },
        );
        expect(messages).toEqual([]);
    });
});
