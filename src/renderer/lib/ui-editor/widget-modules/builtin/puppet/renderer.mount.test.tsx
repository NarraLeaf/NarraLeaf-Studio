// @vitest-environment jsdom
/**
 * The one thing the pure-unit budget tests cannot say: **a configured puppet widget, alone on a
 * visible canvas, actually gets a lease and mounts.**
 *
 * `surfacePuppetContextBudget.test.ts` drives the queue directly and passes while the widget above it
 * is broken, because it never renders the widget. This renders it, with the same observer and opener
 * seams a real canvas supplies, and asserts on what an author sees.
 */
import React from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UI_DOCUMENT_SCHEMA_VERSION, type UIDocument, type UIElement } from "@shared/types/ui-editor/document";
import { UI_PUPPET_ELEMENT_TYPE } from "@shared/types/ui-editor/puppet";
import type { UIHostAdapter } from "@/lib/ui-editor/runtime/types";
import {
    SURFACE_PUPPET_CONTEXT_BUDGET,
    __resetSurfacePuppetContextBudget,
    surfacePuppetContextsGranted,
} from "@/lib/ui-editor/runtime/game/surfacePuppetContextBudget";
import { __resetDevModePuppetHost, registerDevModePuppetHost } from "@/lib/ui-editor/runtime/game/surfacePuppetHosts";
import { PuppetRenderer } from "./renderer";

/**
 * An observer that reports the box as visible.
 *
 * jsdom has no IntersectionObserver at all, and the renderer's own fallback ("no observer means treat
 * everything as near") would make this test pass without ever exercising the gate. So one is installed
 * and it answers the way a real one does for a box in the viewport.
 */
function installIntersectionObserver(intersecting: boolean): void {
    class Stub {
        private readonly callback: IntersectionObserverCallback;
        constructor(callback: IntersectionObserverCallback) {
            this.callback = callback;
        }
        observe(target: Element): void {
            // Real observers deliver the first record asynchronously, which is exactly the ordering the
            // lease has to survive: the widget renders, then learns it is visible.
            queueMicrotask(() => {
                this.callback(
                    [{ isIntersecting: intersecting, target } as unknown as IntersectionObserverEntry],
                    this as unknown as IntersectionObserver,
                );
            });
        }
        unobserve(): void {}
        disconnect(): void {}
        takeRecords(): IntersectionObserverEntry[] { return []; }
    }
    vi.stubGlobal("IntersectionObserver", Stub as unknown as typeof IntersectionObserver);
}

function createDocument(props: Record<string, unknown>): UIDocument {
    return {
        schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
        id: "doc",
        name: "Doc",
        surfaces: [{
            id: "surface",
            name: "Splash Screen",
            host: "app",
            kind: "appSurface",
            designSize: { width: 1920, height: 1080 },
            rootElementId: "root",
        }],
        elements: {
            root: {
                id: "root",
                type: "nl.root",
                parentId: null,
                childrenIds: ["puppet"],
                layout: { x: 0, y: 0, width: 1920, height: 1080 },
            },
            puppet: {
                id: "puppet",
                type: UI_PUPPET_ELEMENT_TYPE,
                name: "Model",
                parentId: "root",
                childrenIds: [],
                layout: { x: 990, y: 308, width: 360, height: 540, opacity: 1, visible: true },
                props,
            },
        },
    };
}

const EDITOR: UIHostAdapter = { host: "app" };

function renderWidget(props: Record<string, unknown>) {
    const document = createDocument(props);
    return render(
        <PuppetRenderer
            element={document.elements.puppet as UIElement}
            document={document}
            surface={document.surfaces[0]!}
            hostAdapter={EDITOR}
        />,
    );
}

/** Let the observer's microtask, the claim effect, and the notified re-render all land. */
async function settle(): Promise<void> {
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); });
}

beforeEach(() => {
    __resetSurfacePuppetContextBudget();
    __resetDevModePuppetHost();
});

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    __resetSurfacePuppetContextBudget();
    __resetDevModePuppetHost();
});

describe("a configured puppet widget on a visible canvas", () => {
    it("takes a lease and does not claim the budget is full", async () => {
        installIntersectionObserver(true);
        const view = renderWidget({ assetId: "hiyori", backend: "live2d" });

        await settle();

        expect(view.container.textContent ?? "").not.toContain("Not drawn");
        expect(surfacePuppetContextsGranted()).toBe(1);
    });

    it("asks its host to mount once it holds the lease", async () => {
        installIntersectionObserver(true);
        // The Dev Mode arm is the cheapest real arm to stand up: two lookups, no workspace services.
        // Without a granted lease the seam is handed `enabled: false` and never calls either.
        const listBackendModules = vi.fn(async () => []);
        registerDevModePuppetHost({
            kind: "dev-mode",
            listBackendModules,
            resolveModelBundleUrl: async () => null,
        });

        renderWidget({ assetId: "hiyori", backend: "live2d" });
        await settle();

        expect(listBackendModules).toHaveBeenCalled();
    });

    it("still spends no context while the box is off screen", async () => {
        // The other half of the gate, which must keep working once the above is fixed.
        installIntersectionObserver(false);
        const view = renderWidget({ assetId: "hiyori", backend: "live2d" });

        await settle();

        expect(surfacePuppetContextsGranted()).toBe(0);
        // Silent, not "Not drawn": a box nobody can see must not accuse anything.
        expect(view.container.textContent ?? "").not.toContain("Not drawn");
    });

    /**
     * The defect the coordinator hit in the running app, and the one every passing budget unit test
     * missed: one element drawn by two renderer instances at once (the canvas and a Surface panel
     * preview) shared a single element-keyed claim, so the first instance to unmount revoked the
     * survivor's lease - and since the claim is a one-shot effect keyed on values that did not change,
     * it never came back. A fully configured model sat at "not drawn" for the life of the window with
     * nothing logged.
     */
    it("keeps drawing when another instance of the same element unmounts", async () => {
        installIntersectionObserver(true);
        const canvas = renderWidget({ assetId: "hiyori", backend: "live2d" });
        const preview = renderWidget({ assetId: "hiyori", backend: "live2d" });
        await settle();
        // Two instances mount two backends, so they hold two contexts. The element-keyed version
        // counted one - undercounting the budget by exactly the amount that made it look safe.
        expect(surfacePuppetContextsGranted()).toBe(2);

        preview.unmount();
        await settle();

        expect(surfacePuppetContextsGranted()).toBe(1);
        expect(canvas.container.textContent ?? "").not.toContain("Not drawn");
    });

    it("counts what is drawn when it does have to refuse one", async () => {
        // The message used to interpolate the budget constant, so the first honest denial would have
        // been the second time it misinformed. It reads the live count now.
        installIntersectionObserver(true);
        const views = Array.from(
            { length: SURFACE_PUPPET_CONTEXT_BUDGET + 1 },
            () => renderWidget({ assetId: "hiyori", backend: "live2d" }),
        );
        await settle();

        expect(surfacePuppetContextsGranted()).toBe(SURFACE_PUPPET_CONTEXT_BUDGET);
        const refused = views[SURFACE_PUPPET_CONTEXT_BUDGET]!;
        expect(refused.container.textContent ?? "")
            .toContain(`${SURFACE_PUPPET_CONTEXT_BUDGET} models are already drawn`);

        // And it follows the count down rather than repeating the constant: releasing two leases leaves
        // the refused widget promoted, so nobody is left reading a number that is no longer true.
        views[0]!.unmount();
        await settle();
        expect(refused.container.textContent ?? "").not.toContain("Not drawn");
    });
});
