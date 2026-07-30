import { describe, expect, it } from "vitest";
import type { UIElement } from "@shared/types/ui-editor/document";
import { UI_VIDEO_ELEMENT_TYPE } from "@shared/types/ui-editor/video";
import { UI_PUPPET_ELEMENT_TYPE } from "@shared/types/ui-editor/puppet";
import { createInitialImageAppearanceFromProps } from "@/lib/ui-editor/widget-modules/shared/appearance/initialAppearanceModel";
import { SURFACE_PUPPET_CONTEXT_BUDGET } from "@/lib/ui-editor/runtime/game/surfacePuppetContextBudget";
import { collectResourceDiagnostics } from "./resourceDiagnostics";

function createImageElement(props: Record<string, unknown>): UIElement {
    return {
        id: "image-1",
        type: "nl.image",
        name: "Image",
        parentId: null,
        childrenIds: [],
        layout: {
            x: 0,
            y: 0,
            width: 100,
            height: 100,
            opacity: 1,
            visible: true,
        },
        props,
    };
}

function puppet(id: string, props: Record<string, unknown>): UIElement {
    return {
        id,
        type: UI_PUPPET_ELEMENT_TYPE,
        name: "Heroine",
        parentId: null,
        childrenIds: [],
        layout: { x: 0, y: 0, width: 360, height: 540, opacity: 1, visible: true },
        props,
    };
}

describe("collectResourceDiagnostics", () => {
    it("does not warn when an image asset is stored in appearance", () => {
        const element = createImageElement({
            fillType: "image",
            imageFill: { mode: "cover", assetId: null },
            appearance: createInitialImageAppearanceFromProps({
                fillType: "image",
                imageFill: { mode: "cover", assetId: "appearance-asset" },
            }),
        });

        expect(collectResourceDiagnostics([element])).toEqual([]);
    });

    it("warns when an image fill has no effective asset", () => {
        const element = createImageElement({
            fillType: "image",
            imageFill: { mode: "cover", assetId: null },
            appearance: createInitialImageAppearanceFromProps({
                fillType: "image",
                imageFill: { mode: "cover", assetId: null },
            }),
        });

        expect(collectResourceDiagnostics([element])).toEqual([
            expect.objectContaining({
                id: "res:image:image-1",
                severity: "warning",
                message: "Image widget “Image” has no image asset",
            }),
        ]);
    });

    it("warns when a video widget has no clip", () => {
        const element: UIElement = {
            id: "video-1",
            type: UI_VIDEO_ELEMENT_TYPE,
            name: "Intro",
            parentId: null,
            childrenIds: [],
            layout: { x: 0, y: 0, width: 480, height: 270, opacity: 1, visible: true },
            props: { assetId: null },
        };

        expect(collectResourceDiagnostics([element])).toEqual([
            expect.objectContaining({
                id: "res:video:video-1",
                severity: "warning",
                message: "Video widget “Intro” has no clip",
            }),
        ]);
    });

    it("does not treat a missing poster as a missing resource", () => {
        // The poster is optional by design; warning about it would train authors to ignore the rule.
        const element: UIElement = {
            id: "video-2",
            type: UI_VIDEO_ELEMENT_TYPE,
            name: "Intro",
            parentId: null,
            childrenIds: [],
            layout: { x: 0, y: 0, width: 480, height: 270, opacity: 1, visible: true },
            props: { assetId: "clip-1", posterAssetId: null },
        };

        expect(collectResourceDiagnostics([element])).toEqual([]);
    });

    it("names both halves a puppet widget can be missing", () => {
        // Different mistakes with different fixes - no model bundle chosen, or no runtime named - so
        // one message covering both would name neither.
        expect(collectResourceDiagnostics([puppet("p1", {})])).toEqual([
            expect.objectContaining({
                id: "res:puppet:p1",
                severity: "warning",
                message: "Model widget “Heroine” has no model bundle",
            }),
            expect.objectContaining({
                id: "res:puppet-backend:p1",
                severity: "warning",
                message: "Model widget “Heroine” names no runtime",
            }),
        ]);

        expect(collectResourceDiagnostics([puppet("p2", { assetId: "m" })]).map(d => d.id))
            .toEqual(["res:puppet-backend:p2"]);
        expect(collectResourceDiagnostics([puppet("p3", { backend: "b" })]).map(d => d.id))
            .toEqual(["res:puppet:p3"]);
        expect(collectResourceDiagnostics([puppet("p4", { assetId: "m", backend: "b" })])).toEqual([]);
    });

    it("reports the WebGL context budget rather than truncating silently", () => {
        // Each drawable model is one WebGL context and this build keeps 16 alive (measured; see
        // `surfacePuppetContextBudget.ts`). Past the budget the losing widgets draw an explanatory box,
        // but that box is only seen by whoever is looking at that part of the canvas - so the document
        // fact has to be said once, here, or a Surface that cannot draw what it asks for looks fine.
        const configured = Array.from(
            { length: SURFACE_PUPPET_CONTEXT_BUDGET + 1 },
            (_, index) => puppet(`p${index}`, { assetId: "m", backend: "b" }),
        );

        expect(collectResourceDiagnostics(configured)).toEqual([
            expect.objectContaining({
                id: "res:puppet-context-budget",
                severity: "warning",
                message: `This Surface draws ${SURFACE_PUPPET_CONTEXT_BUDGET + 1} models at once; `
                    + `only ${SURFACE_PUPPET_CONTEXT_BUDGET} can be drawn`,
            }),
        ]);

        expect(collectResourceDiagnostics(configured.slice(0, SURFACE_PUPPET_CONTEXT_BUDGET))).toEqual([]);
    });

    it("counts only the puppets that would actually draw against the budget", () => {
        // An unconfigured widget mounts nothing, so it spends no context. Counting it would put a
        // budget warning on a Surface holding one real model and eight empty boxes.
        const unconfigured = Array.from(
            { length: SURFACE_PUPPET_CONTEXT_BUDGET + 4 },
            (_, index) => puppet(`p${index}`, { backend: "b" }),
        );

        expect(collectResourceDiagnostics(unconfigured).map(d => d.id))
            .not.toContain("res:puppet-context-budget");
    });
});
