import { describe, expect, it } from "vitest";
import { isVersioned } from "@shared/vcs/workingSet";
import { shouldExcludeProjectPackagePath } from "@shared/utils/projectPackage";
import { SCRIPT_API_DECLARATIONS } from "./scriptApiDeclarations.generated";
import {
    PROJECT_DECLARATIONS_PATH,
    SCRIPT_API_DECLARATIONS_PATH,
    renderProjectDeclarations,
    type ScriptProjectFacts,
} from "./scriptDeclarations";

const EMPTY: ScriptProjectFacts = {
    surfaces: [],
    components: [],
    characters: [],
    stories: [],
    scenes: [],
    savedVariables: [],
    persistentVariables: [],
    audioTracks: [],
    inputActions: [],
    locales: [],
};

function facts(overrides: Partial<ScriptProjectFacts>): ScriptProjectFacts {
    return { ...EMPTY, ...overrides };
}

describe("the project's own names, as types", () => {
    it("names what the project holds, sorted and deduplicated", () => {
        const rendered = renderProjectDeclarations(
            facts({
                characters: [{ id: "yuki", name: "Yuki" }, { id: "aoi", name: "Aoi" }, { id: "yuki", name: "Yuki" }],
                locales: ["en", "ja"],
            }),
        );
        expect(rendered).toContain('type CharacterId = "aoi" | "yuki";');
        expect(rendered).toContain('type LocaleCode = "en" | "ja";');
    });

    it("refuses every argument for a kind the project declares none of", () => {
        // `never` rather than `string`. A project with no characters should refuse every id, not
        // accept any - and "not assignable to never" tells the author which of the two they hit.
        const rendered = renderProjectDeclarations(EMPTY);
        expect(rendered).toContain("type CharacterId = never;");
        expect(rendered).toContain("type SavedVariableId = never;");
        expect(rendered).toContain("type SurfaceId = never;");
    });

    it("gives each element a context alias of its own widget type", () => {
        const rendered = renderProjectDeclarations(
            facts({
                surfaces: [
                    {
                        id: "surface-1",
                        name: "Quick menu",
                        elements: [
                            { id: "el-1", name: "Volume", type: "nl.slider" },
                            { id: "el-2", name: "Save", type: "nl.button" },
                        ],
                    },
                ],
            }),
        );
        // A script on the slider gets the slider's events; asking a button for them is a type error
        // where it used to be a handler nothing ever called.
        expect(rendered).toContain('type QuickMenuVolumeCtx = WidgetCtx<"nl.slider">;');
        expect(rendered).toContain('type QuickMenuSaveCtx = WidgetCtx<"nl.button">;');
        expect(rendered).toContain('type QuickMenuElement = "el-1" | "el-2";');
    });

    it("uses the component context for a component definition's elements", () => {
        const rendered = renderProjectDeclarations(
            facts({
                components: [
                    { id: "c-1", name: "Save slot", elements: [{ id: "el-9", name: "Label", type: "nl.text" }] },
                ],
            }),
        );
        expect(rendered).toContain('type SaveSlotLabelCtx = ComponentWidgetCtx<"nl.text">;');
    });

    it("writes every alias exactly once, whatever the author named things", () => {
        const rendered = renderProjectDeclarations(
            facts({
                surfaces: [
                    { id: "a", name: "Title", elements: [] },
                    // The same name twice, and a name with nothing usable in it at all.
                    { id: "b", name: "Title", elements: [] },
                    { id: "c", name: "!!!", elements: [] },
                ],
            }),
        );
        expect(rendered).toContain("type TitleElement =");
        expect(rendered).toContain("type Title2Element =");
        expect(rendered).toContain("type Surface3Element =");
        const declared = [...rendered.matchAll(/^ {4}type (\w+) =/gm)].map(match => match[1]);
        expect(declared.length).toBe(new Set(declared).size);
    });

    it("declares the module a script imports its types from", () => {
        expect(renderProjectDeclarations(EMPTY)).toContain('declare module "@narraleaf/script" {');
    });

    it("is never carried anywhere a shipped game could read it", () => {
        // The one thing that separates this from the id-indexed table this product refuses to ship.
        // It is authoring-time only: excluded from version control, excluded from an export, and
        // holding nothing but types, which are erased before a byte is bundled.
        for (const generated of [PROJECT_DECLARATIONS_PATH, SCRIPT_API_DECLARATIONS_PATH]) {
            expect(isVersioned(generated), generated).toBe(false);
            expect(shouldExcludeProjectPackagePath(generated), generated).toBe(true);
            expect(generated.endsWith(".d.ts"), generated).toBe(true);
        }
    });
});

describe("the host API half of the declarations", () => {
    it("declares the same module the project half extends", () => {
        // Two files, one ambient module: the API half declares it and the project half adds this
        // project's names to it. Different specifiers would leave an author importing from one and
        // missing everything in the other.
        expect(SCRIPT_API_DECLARATIONS).toContain('declare module "@narraleaf/script" {');
        expect(renderProjectDeclarations(EMPTY)).toContain('declare module "@narraleaf/script" {');
    });

    it("exports every name a starter script and the documented forms use", () => {
        for (const name of [
            "GlobalCtx",
            "SurfaceCtx",
            "WidgetCtx",
            "ComponentWidgetCtx",
            "StoryCtx",
            "ValueCtx",
            "ScriptEvent",
            "WidgetHandler",
        ]) {
            // A name Studio writes into a starter file and the declarations do not export is a
            // fresh script blueprint that does not compile.
            expect(SCRIPT_API_DECLARATIONS, name).toContain(`export type ${name}`);
        }
    });

    it("resolves with nothing installed", () => {
        // No `import ... from` at all: an author's `scripts/` folder has no packages in it, and a
        // declaration that imports one resolves to `any` there rather than to an error.
        expect(SCRIPT_API_DECLARATIONS).not.toMatch(/^\s+import .*from /m);
    });
});
