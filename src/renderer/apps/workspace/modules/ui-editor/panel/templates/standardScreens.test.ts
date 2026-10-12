import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { anchorSurfaceId } from "@shared/blueprint/ownerShape";
import { migrateBlueprintDocumentToLatest } from "@shared/blueprint/migrateBlueprintDocument";
import type { BlueprintDocument } from "@shared/types/blueprint/document";
import { BLUEPRINT_NODE_TYPE_GAME_START_STORY } from "@shared/types/blueprint/graph";
import { MAIN_APP_SURFACE_ID } from "@shared/constants/ui-editor";
import type { UIDocument } from "@shared/types/ui-editor/document";
import { resolveEntrySurfaceId } from "@shared/types/ui-editor/entrySurface";
import { blueprintNodeRegistry } from "@/lib/ui-editor/blueprint-nodes/BlueprintNodeRegistry";
import { registerCoreBlueprintNodes } from "@/lib/ui-editor/blueprint-nodes/registerCoreBlueprintNodes";
import { blueprintGraphs } from "./starterTitlePage";
import { planStandardScreens } from "./standardScreens";

/**
 * The skeleton's whole interface, planned for a project that already exists - read from the template
 * as it ships, so the test is about the screens authors actually get.
 */

const CONTENT = path.resolve(__dirname, "../../../../../../../../resources/templates/skeleton/content/editor/ui");

function readTemplate(): { document: UIDocument; blueprints: BlueprintDocument } {
    const document = JSON.parse(fs.readFileSync(path.join(CONTENT, "uidoc.json"), "utf8")) as UIDocument;
    const graphs = JSON.parse(fs.readFileSync(path.join(CONTENT, "uigraphs.json"), "utf8")) as { blueprintDocument: unknown };
    return { document, blueprints: migrateBlueprintDocumentToLatest(graphs.blueprintDocument) };
}

const START = { storyId: "story-of-the-project", sceneId: "its-first-scene" };

function startNodes(blueprints: BlueprintDocument) {
    return Object.values(blueprints.blueprints)
        .flatMap(blueprint => blueprintGraphs(blueprint))
        .flatMap(graph => Object.values(graph.nodes ?? {}))
        .filter(node => node.type === BLUEPRINT_NODE_TYPE_GAME_START_STORY && node.params?.storyId);
}

beforeAll(() => {
    registerCoreBlueprintNodes();
});

describe("the standard screens", () => {
    it("come whole to a project that runs everything they need, with Start pointed at its own story", () => {
        const template = readTemplate();
        const before = JSON.stringify(template);
        const plan = planStandardScreens({ ...template, startTarget: START, knowsNode: () => true, knowsWidget: () => true });

        expect(plan.leftOut).toEqual([]);
        expect(plan.cutControls).toEqual([]);
        expect(plan.document.surfaces.map(surface => surface.id)).toEqual(template.document.surfaces.map(surface => surface.id));
        expect(plan.entrySurfaceId).toBe(resolveEntrySurfaceId(template.document));
        expect(plan.titleSurfaceId).toBe(MAIN_APP_SURFACE_ID);
        expect([...plan.stageSlots].sort()).toEqual(["choice", "dialog", "notification", "onStage"]);
        expect(plan.assetIds.length).toBeGreaterThan(0);
        expect(plan.brandColorIds.length).toBeGreaterThan(0);
        const starts = startNodes(plan.blueprints);
        expect(starts.length).toBeGreaterThan(0);
        expect(starts.every(node => node.params?.storyId === START.storyId && node.params?.sceneId === START.sceneId)).toBe(true);
        // The template's own documents are read, never changed.
        expect(JSON.stringify(template)).toBe(before);
    });

    it("leave out a page whose logic needs a plugin the project lacks, and the control that opened it", () => {
        const template = readTemplate();
        const plan = planStandardScreens({
            ...template,
            startTarget: START,
            knowsNode: type => Boolean(blueprintNodeRegistry.get(type)),
            knowsWidget: () => true,
        });

        expect(plan.leftOut).toHaveLength(1);
        const [extra] = plan.leftOut;
        expect(extra.needs.length).toBeGreaterThan(0);
        expect(extra.needs.every(type => type.startsWith("narraleaf.gallery."))).toBe(true);
        expect(plan.document.surfaces.some(surface => surface.id === extra.id)).toBe(false);
        // Nothing that comes still opens it or belongs to it.
        expect(JSON.stringify(plan.blueprints)).not.toContain(extra.id);
        expect(JSON.stringify(plan.document)).not.toContain(extra.id);
        expect(Object.values(plan.blueprints.blueprints).some(blueprint => anchorSurfaceId(blueprint.owner) === extra.id)).toBe(false);
        // The title's button that only opened it went with its logic.
        expect(plan.cutControls.length).toBeGreaterThan(0);
        expect(plan.cutControls.every(control => control.surface === "Title")).toBe(true);
        const ownerKeys = Object.keys(plan.blueprints.ownerRecords);
        for (const key of ownerKeys) {
            expect(plan.blueprints.blueprints[plan.blueprints.ownerRecords[key].blueprintId]).toBeDefined();
        }
    });
});
