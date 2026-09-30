// @vitest-environment jsdom
/**
 * An image fill that draws nothing says why, in a running game - and only there.
 *
 * The chrome is where every rectangle-like widget (image, container, button, text input, list part)
 * resolves its image fill, so it is where a failed one is reported. These drive the real renderer
 * with a stand-in for the asset lookup that answers the way the real one does: blank, then in an
 * effect keyed on the id, with a fresh state object each time.
 */
import { useEffect, useState } from "react";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
    UI_DOCUMENT_SCHEMA_VERSION,
    type UIDocument,
    type UIElement,
    type UISurface,
} from "@shared/types/ui-editor/document";
import { DEFAULT_ELEMENT_EFFECT_VALUES } from "@shared/types/ui-editor/effects";
import type { RectangleLikeProps } from "@shared/types/ui-editor/rectangleLike";
import type { UIHostAdapter } from "@/lib/ui-editor/runtime/types";
import type { AssetResolutionReport } from "@/lib/ui-editor/runtime/assetResolution";
import { AssetResolutionReporterContext } from "@/lib/ui-editor/runtime/useAssetResolutionReport";

const GOOD = "93bad884-1f14-4ad2-85fb-c05d7b5ffef6";
const GONE = "4b645b59-1723-4ac9-98ab-e6859b837bef";

vi.mock("@/lib/workspace/hooks/useAssetObjectUrl", () => ({
    useAssetObjectUrl: (id: string | null) => {
        const [state, setState] = useState<{ url: string | null; metadata: null; loading: boolean; error: string | null }>(
            { url: null, metadata: null, loading: false, error: null },
        );
        useEffect(() => {
            if (!id) {
                setState({ url: null, metadata: null, loading: false, error: null });
                return;
            }
            setState(id === GOOD
                ? { url: "app://fs/good", metadata: null, loading: false, error: null }
                : { url: null, metadata: null, loading: false, error: "Asset not found" });
        }, [id]);
        return state;
    },
}));

vi.mock("@/lib/workspace/services/ui-editor/UIEditorStateService", () => ({
    UIEditorStateService: {
        getInstance: () => ({
            getInteractionOverride: () => null,
            on: () => () => undefined,
        }),
    },
}));

import { RectangleChromeRenderer } from "./RectangleChromeRenderer";

afterEach(cleanup);

const SURFACE: UISurface = {
    id: "surface-title",
    name: "Title",
    host: "app",
    kind: "appSurface",
    designSize: { width: 320, height: 180 },
    rootElementId: "root",
};

const ELEMENT: UIElement = {
    id: "element-art",
    type: "nl.image",
    name: "Art",
    parentId: "root",
    childrenIds: [],
    layout: { x: 0, y: 0, width: 100, height: 80 },
};

const DOCUMENT: UIDocument = {
    schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
    id: "doc",
    name: "Doc",
    surfaces: [SURFACE],
    elements: {
        root: {
            id: "root",
            type: "nl.root",
            parentId: null,
            childrenIds: ["element-art"],
            layout: { x: 0, y: 0, width: 320, height: 180 },
        },
        "element-art": ELEMENT,
    },
};

const HOST_ADAPTER: UIHostAdapter = { host: "app" };

function imageFill(assetId: string | null, overrides: Partial<RectangleLikeProps> = {}): RectangleLikeProps {
    return {
        backgroundColor: "#ffffff",
        borderRadius: 0,
        borderRadiusTL: 0,
        borderRadiusTR: 0,
        borderRadiusBL: 0,
        borderRadiusBR: 0,
        borderRadiusLinked: true,
        borderColor: "transparent",
        borderWidth: 0,
        borderStyle: "solid",
        backgroundImage: "",
        backgroundFit: "cover",
        imageFill: { mode: "cover", assetId },
        fillType: "image",
        fillVisible: true,
        fillOpacity: 1,
        strokeVisible: false,
        strokeOpacity: 1,
        strokeAlign: "none",
        strokeSide: "all",
        borderJoin: "miter",
        cornerAdvanced: false,
        transformOffsetX: 0,
        transformOffsetY: 0,
        transformScale: 1,
        transformRotation: 0,
        transformOpacity: 1,
        effects: DEFAULT_ELEMENT_EFFECT_VALUES,
        ...overrides,
    } as RectangleLikeProps;
}

function chrome(props: RectangleLikeProps, reporter: ((report: AssetResolutionReport) => void) | null) {
    const renderer = (
        <RectangleChromeRenderer
            element={ELEMENT}
            surface={SURFACE}
            document={DOCUMENT}
            hostAdapter={HOST_ADAPTER}
            rectangleLike={props}
            instanceKey="row-2"
        />
    );
    return reporter
        ? <AssetResolutionReporterContext.Provider value={reporter}>{renderer}</AssetResolutionReporterContext.Provider>
        : renderer;
}

function reports(reporter: ReturnType<typeof vi.fn>): AssetResolutionReport[] {
    return reporter.mock.calls.map(([report]) => report as AssetResolutionReport);
}

describe("RectangleChromeRenderer asset reporting", () => {
    it("reports an image fill it could not resolve, naming the element and the slot", () => {
        const reporter = vi.fn();
        render(chrome(imageFill(GONE), reporter));
        expect(reports(reporter)).toEqual([
            {
                type: "outcome",
                drawing: expect.any(String),
                site: {
                    surfaceId: "surface-title",
                    elementId: "element-art",
                    ownerName: "Art",
                    slot: "imageFill",
                    instanceKey: "row-2",
                },
                outcome: { status: "failed", requested: GONE, stage: "resolve" },
            },
        ]);
    });

    it("reports a picture the element could not load, and not the one that loaded before it", () => {
        const reporter = vi.fn();
        const { container } = render(chrome(imageFill(GOOD), reporter));
        const image = container.querySelector("img[data-ui-image-fill]");
        expect(image).not.toBeNull();
        fireEvent.error(image!);
        expect(reports(reporter).map(report => report.type === "outcome" && report.outcome)).toEqual([
            { status: "drawn" },
            { status: "failed", requested: GOOD, stage: "load" },
        ]);
    });

    it("does not report an image fill it is not drawing", () => {
        const reporter = vi.fn();
        render(chrome(imageFill(GONE, { fillType: "color" }), reporter));
        render(chrome(imageFill(GONE, { fillVisible: false }), reporter));
        expect(reports(reporter).map(report => report.type === "outcome" && report.outcome.status))
            .toEqual(["unused", "unused"]);
    });

    it("reports nothing on the editor canvas, which mounts no reporter", () => {
        // Nothing to assert on but the absence of a throw: the hook reads a null context and stops.
        expect(() => render(chrome(imageFill(GONE), null))).not.toThrow();
    });
});
