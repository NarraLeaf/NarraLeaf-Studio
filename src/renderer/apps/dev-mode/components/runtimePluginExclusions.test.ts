import { describe, expect, it } from "vitest";
import type { BlueprintDocument } from "@shared/types/blueprint/document";
import type { RuntimePluginExclusion } from "@shared/types/plugins";
import type { StoryDocument } from "@shared/types/story";
import type { UIDocument } from "@shared/types/ui-editor/document";
import {
    pluginsReferencedByBundle,
    reportableRuntimePluginExclusions,
    type PluginReferenceSources,
} from "./runtimePluginExclusions";

const QUICK_SAVE: RuntimePluginExclusion = {
    pluginId: "narraleaf.quick-save",
    pluginName: "Quick Save",
    reason: "notDeclared",
};

function blueprints(...types: string[]): BlueprintDocument {
    return {
        blueprints: {
            title: {
                graphs: {
                    events: {
                        main: { graph: { nodes: Object.fromEntries(types.map((type, index) => [`n${index}`, { type }])) } },
                    },
                },
            },
        },
    } as unknown as BlueprintDocument;
}

function page(...types: string[]): UIDocument {
    return {
        elements: Object.fromEntries(types.map((type, index) => [`e${index}`, { type }])),
    } as unknown as UIDocument;
}

function storyWithPluginRow(pluginId: string, actionId: string): StoryDocument {
    return {
        scenes: {
            s1: {
                blocks: {
                    b1: { id: "b1", kind: "nodeAction", payload: { action: "narration" } },
                    b2: { id: "b2", kind: "action", payload: { action: "plugin", pluginId, actionId, params: {} } },
                },
            },
        },
    } as unknown as StoryDocument;
}

/** What a project made from the skeleton carries, as far as plugins go: Gallery nodes and Studio's own. */
function skeletonLike(): PluginReferenceSources {
    return {
        ui: {
            uidoc: page("nl.text", "nl.button", "nl.list"),
            localBlueprints: blueprints("blueprint.event.init", "narraleaf.gallery.getEntries", "blueprint.sound.play"),
        },
        storyLibrary: { documents: {} },
    };
}

describe("reportableRuntimePluginExclusions", () => {
    it("says nothing about an enabled plugin the project never uses", () => {
        expect(reportableRuntimePluginExclusions({
            excluded: [QUICK_SAVE],
            runningPluginIds: ["narraleaf.gallery"],
            bundle: skeletonLike(),
        })).toEqual([]);
    });

    it("says nothing for a project with no plugin references at all", () => {
        expect(reportableRuntimePluginExclusions({
            excluded: [QUICK_SAVE, { pluginId: "narraleaf.menu-bar", pluginName: "Menu Bar", reason: "notDeclared" }],
            runningPluginIds: [],
            bundle: {
                ui: { uidoc: page("nl.text"), localBlueprints: blueprints("blueprint.event.init") },
            },
        })).toEqual([]);
    });

    it("reports a left-out plugin whose blueprint node the project placed", () => {
        const bundle = skeletonLike();
        bundle.ui.localBlueprints = blueprints("blueprint.event.init", "narraleaf.quick-save.save");
        expect(reportableRuntimePluginExclusions({
            excluded: [QUICK_SAVE],
            runningPluginIds: ["narraleaf.gallery"],
            bundle,
        })).toEqual([QUICK_SAVE]);
    });

    it("reports a left-out plugin whose widget sits on a page or inside a component", () => {
        const widget: RuntimePluginExclusion = { pluginId: "acme.kit", pluginName: "Kit", reason: "notDeclared" };
        const onPage = skeletonLike();
        onPage.ui.uidoc = page("nl.text", "acme.kit.card");
        expect(reportableRuntimePluginExclusions({ excluded: [widget], runningPluginIds: [], bundle: onPage }))
            .toEqual([widget]);

        const inComponent = skeletonLike();
        inComponent.ui.uidoc = {
            elements: {},
            components: [{ elements: { c: { type: "acme.kit.card" } } }],
        } as unknown as UIDocument;
        expect(reportableRuntimePluginExclusions({ excluded: [widget], runningPluginIds: [], bundle: inComponent }))
            .toEqual([widget]);
    });

    it("reports a left-out plugin whose story row a story in the session carries", () => {
        const action: RuntimePluginExclusion = { pluginId: "acme.rps", pluginName: "RPS", reason: "notDeclared" };
        const inLibrary = skeletonLike();
        inLibrary.storyLibrary = { documents: { main: storyWithPluginRow("acme.rps", "acme.rps.play") } };
        expect(reportableRuntimePluginExclusions({ excluded: [action], runningPluginIds: [], bundle: inLibrary }))
            .toEqual([action]);

        const asTheStory = skeletonLike();
        asTheStory.story = storyWithPluginRow("acme.rps", "acme.rps.play");
        expect(reportableRuntimePluginExclusions({ excluded: [action], runningPluginIds: [], bundle: asTheStory }))
            .toEqual([action]);
    });

    it("always reports a plugin the table names that still cannot run", () => {
        const held: RuntimePluginExclusion = { pluginId: "narraleaf.gallery", pluginName: "Gallery", reason: "unusable" };
        expect(reportableRuntimePluginExclusions({
            excluded: [held, QUICK_SAVE],
            runningPluginIds: [],
            bundle: { ui: { uidoc: page(), localBlueprints: blueprints() } },
        })).toEqual([held]);
    });

    it("leaves a running plugin's types to it when an excluded id is nested inside its id", () => {
        const outer: RuntimePluginExclusion = { pluginId: "acme.fx", pluginName: "FX", reason: "notDeclared" };
        const bundle = skeletonLike();
        bundle.ui.localBlueprints = blueprints("acme.fx.pro.glow");
        expect(reportableRuntimePluginExclusions({ excluded: [outer], runningPluginIds: ["acme.fx.pro"], bundle }))
            .toEqual([]);
    });
});

describe("pluginsReferencedByBundle", () => {
    it("does not read a plugin id out of a type that only shares its leading characters", () => {
        const bundle = skeletonLike();
        bundle.ui.localBlueprints = blueprints("narraleaf.quick-saver.thing", "narraleaf.quick-save");
        expect([...pluginsReferencedByBundle(bundle, ["narraleaf.quick-save"])]).toEqual([]);
    });
});
