import { describe, expect, it } from "vitest";
import type { LintLocation, LintReportEntry } from "@/lib/lint";
import { editorSubjectOf, filterEntriesByScope } from "./problemsScope";

function entry(location: LintLocation): LintReportEntry {
    return {
        ruleId: "text/empty",
        messageKey: "lint.rule.textEmpty.message" as LintReportEntry["messageKey"],
        location,
        severity: "warning",
    };
}

const sceneRow = entry({ kind: "story", storyId: "s1", storyName: "One", sceneId: "a", sceneName: "A", blockId: "b1", line: 3 });
const otherScene = entry({ kind: "story", storyId: "s1", storyName: "One", sceneId: "b", sceneName: "B" });
const otherStory = entry({ kind: "story", storyId: "s2", storyName: "Two", sceneId: "a", sceneName: "A" });
const page = entry({ kind: "surface", surfaceId: "title", surfaceName: "Title", elementId: "start" });
const component = entry({ kind: "component", componentId: "c1", componentName: "Card" });
const blueprint = entry({ kind: "blueprint", blueprintId: "bp1", blueprintName: "Quit" });
const character = entry({ kind: "character", characterId: "aoi", characterName: "Aoi" });
const asset = entry({ kind: "asset", assetId: "img1", assetName: "bg.png" });
const project = entry({ kind: "project" });

const ALL = [sceneRow, otherScene, otherStory, page, component, blueprint, character, asset, project];

describe("editorSubjectOf", () => {
    it("reads what each kind of editor tab shows", () => {
        expect(editorSubjectOf({ id: "story:scene:s1:a", payload: { storyId: "s1", sceneId: "a" } }))
            .toEqual({ kind: "storyScene", storyId: "s1", sceneId: "a" });
        expect(editorSubjectOf({ id: "story:scene:s1:a" })).toEqual({ kind: "storyScene", storyId: "s1", sceneId: "a" });
        expect(editorSubjectOf({ id: "story:flow:s1" })).toEqual({ kind: "story", storyId: "s1" });
        expect(editorSubjectOf({ id: "ui-editor:surface:title", payload: { surfaceId: "title" } }))
            .toEqual({ kind: "surface", surfaceId: "title" });
        expect(editorSubjectOf({ id: "ui-editor:component:c1" })).toEqual({ kind: "component", componentId: "c1" });
        expect(editorSubjectOf({ id: "blueprint-entry:bp1:~:~:~", payload: { blueprintId: "bp1" } }))
            .toEqual({ kind: "blueprint", blueprintId: "bp1" });
        expect(editorSubjectOf({ id: "narraleaf-studio:character-editor-aoi" })).toEqual({ kind: "character", characterId: "aoi" });
        expect(editorSubjectOf({ id: "narraleaf-studio:assets:image-preview-img1" })).toEqual({ kind: "asset", assetId: "img1" });
    });

    it("answers nothing for a tab that is not about one thing", () => {
        expect(editorSubjectOf({ id: "narraleaf-studio:dashboard" })).toBeNull();
        expect(editorSubjectOf({ id: "narraleaf-studio:help" })).toBeNull();
        // A blueprint tab whose payload is missing cannot say which blueprint it is.
        expect(editorSubjectOf({ id: "blueprint-entry:bp1:~:~:~" })).toBeNull();
    });
});

describe("filterEntriesByScope", () => {
    it("lists the whole report for the project scope", () => {
        expect(filterEntriesByScope(ALL, "project", [], null)).toEqual(ALL);
    });

    it("lists only the findings about what the open tabs show", () => {
        const tabs = [
            { id: "story:scene:s1:a", payload: { storyId: "s1", sceneId: "a" } },
            { id: "ui-editor:surface:title" },
            { id: "blueprint-entry:bp1:~:~:~", payload: { blueprintId: "bp1" } },
            { id: "narraleaf-studio:dashboard" },
        ];
        expect(filterEntriesByScope(ALL, "openEditors", tabs, null)).toEqual([sceneRow, page, blueprint]);
    });

    it("lists a whole story's findings for its flow map", () => {
        expect(filterEntriesByScope(ALL, "openEditors", [{ id: "story:flow:s1" }], null)).toEqual([sceneRow, otherScene]);
    });

    it("lists the active tab's findings for the current-editor scope", () => {
        const active = { id: "narraleaf-studio:character-editor-aoi" };
        expect(filterEntriesByScope(ALL, "activeEditor", [active, { id: "ui-editor:surface:title" }], active)).toEqual([character]);
    });

    it("lists nothing when no editor is open, rather than the whole project", () => {
        expect(filterEntriesByScope(ALL, "openEditors", [], null)).toEqual([]);
        expect(filterEntriesByScope(ALL, "activeEditor", [{ id: "story:flow:s1" }], null)).toEqual([]);
    });
});
