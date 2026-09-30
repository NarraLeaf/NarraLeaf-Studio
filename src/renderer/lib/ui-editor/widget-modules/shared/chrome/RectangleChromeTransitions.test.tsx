// @vitest-environment jsdom
/**
 * A hover that changes a widget's stroke or fill, with a transition the author declared, has to reach
 * the screen as a tween - not as a jump with a console warning.
 *
 * Both of the defects this file pins were visible only as console noise on the starter template's
 * gallery tiles, and both meant the declared transition was not what played: a `borderColor`
 * shorthand next to the per-side colours motion tweens (React rewrote the sides on every change, and
 * said so), and an invisible fill written as the keyword `transparent`, which motion cannot
 * interpolate and so snapped instead of fading.
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
    UI_DOCUMENT_SCHEMA_VERSION,
    type UIDocument,
    type UIElement,
    type UISurface,
} from "@shared/types/ui-editor/document";
import { DEFAULT_ELEMENT_EFFECT_VALUES } from "@shared/types/ui-editor/effects";
import type { RectangleLikeProps } from "@shared/types/ui-editor/rectangleLike";
import type { AppearanceFieldTransition } from "@shared/types/ui-editor/appearance";
import type { UIHostAdapter } from "@/lib/ui-editor/runtime/types";
import { ensureAnimationFramePolyfill } from "@/lib/ui-editor/runtime/testing/lifecycleTestKit";

vi.mock("@/lib/workspace/hooks/useAssetObjectUrl", () => ({
    useAssetObjectUrl: () => ({ url: null, metadata: null, loading: false, error: null }),
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

beforeAll(() => {
    ensureAnimationFramePolyfill();
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

const SURFACE: UISurface = {
    id: "surface",
    name: "Surface",
    host: "app",
    kind: "appSurface",
    designSize: { width: 320, height: 180 },
    rootElementId: "root",
};

const ELEMENT: UIElement = {
    id: "tile",
    type: "nl.button",
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
            childrenIds: ["tile"],
            layout: { x: 0, y: 0, width: 320, height: 180 },
        },
        tile: ELEMENT,
    },
};

const HOST_ADAPTER: UIHostAdapter = { host: "app" };

const TWEEN: AppearanceFieldTransition = { type: "tween", durationMs: 120, delayMs: 0, easing: "linear" };

/** The starter template's gallery hit area, at rest: a transparent 3px stroke and no fill. */
function atRest(overrides: Partial<RectangleLikeProps> = {}): RectangleLikeProps {
    return {
        backgroundColor: "transparent",
        borderRadius: 0,
        borderRadiusTL: 0,
        borderRadiusTR: 0,
        borderRadiusBL: 0,
        borderRadiusBR: 0,
        borderRadiusLinked: true,
        borderColor: "transparent",
        borderWidth: 3,
        borderStyle: "solid",
        backgroundImage: "",
        backgroundFit: "cover",
        fillType: "color",
        fillVisible: false,
        fillOpacity: 0,
        strokeVisible: true,
        strokeOpacity: 1,
        strokeAlign: "center",
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
    };
}

/** The same hit area hovered: a strong stroke and an 8% wash of the primary colour. */
const HOVERED = atRest({
    borderColor: "#6a7b8c",
    backgroundColor: "#40a8c4",
    fillVisible: true,
    fillOpacity: 0.08,
});

function chrome(props: RectangleLikeProps, transitions: Record<string, AppearanceFieldTransition>) {
    return (
        <RectangleChromeRenderer
            element={ELEMENT}
            surface={SURFACE}
            document={DOCUMENT}
            hostAdapter={HOST_ADAPTER}
            rectangleLike={props}
            appearanceTransitions={transitions}
        />
    );
}

function captureConsole() {
    const lines: string[] = [];
    const record = (...args: unknown[]) => {
        lines.push(args.map(String).join(" "));
    };
    vi.spyOn(console, "error").mockImplementation(record);
    vi.spyOn(console, "warn").mockImplementation(record);
    return lines;
}

describe("chrome transitions on hover", () => {
    it("tweens a stroke colour without mixing shorthand and per-side properties", () => {
        const lines = captureConsole();
        const transitions = { borderColor: TWEEN };
        const view = render(chrome(atRest(), transitions));

        view.rerender(chrome(HOVERED, transitions));
        view.rerender(chrome(atRest(), transitions));

        expect(lines.filter(line => line.includes("conflicting property"))).toEqual([]);
        const stroke = view.container.querySelector<HTMLElement>("[aria-hidden='true']");
        expect(stroke).not.toBeNull();
        // The sides are the only colour properties on the node, so nothing can write over them.
        expect(stroke!.style.getPropertyValue("border-color")).toBe("");
        expect(stroke!.style.borderTopStyle).toBe("solid");
    });

    it("draws the same per-side stroke when nothing transitions", () => {
        const view = render(chrome(HOVERED, {}));
        const stroke = view.container.querySelector<HTMLElement>("[aria-hidden='true']");
        expect(stroke!.style.borderTopWidth).toBe("3px");
        expect(stroke!.style.borderLeftWidth).toBe("3px");
        expect(stroke!.style.borderTopColor).toBe("rgb(106, 123, 140)");
        expect(stroke!.style.borderBottomColor).toBe("rgb(106, 123, 140)");
    });

    it("fades a fill in and out rather than jumping from a keyword", () => {
        const lines = captureConsole();
        const transitions = { fillOpacity: TWEEN, backgroundColor: TWEEN };
        const view = render(chrome(atRest(), transitions));

        view.rerender(chrome(HOVERED, transitions));
        view.rerender(chrome(atRest(), transitions));

        expect(lines.filter(line => line.includes("not an animatable value"))).toEqual([]);
        // No fill is still a colour, at zero alpha, so there is a path between the two.
        expect((view.container.firstElementChild as HTMLElement).style.backgroundColor).not.toBe("transparent");
    });
});
