// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { useEffect, useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import type { UIDocument } from "@shared/types/ui-editor/document";
import type { SelectionState } from "@/lib/workspace/services/ui/UIStore";
import {
    resolveSurfaceTabSelectionClaim,
    useSurfaceTabSelection,
    type SurfaceTabSelectionHost,
} from "./useSurfaceTabSelection";

/**
 * The workspace has one selection, and every surface editor tab stays mounted while hidden.
 *
 * With a component editor open behind a page, clicking anything on the page left the selection on
 * the component: the hidden tab re-rendered on the selection change, read a new surface object (a
 * component's document is rebuilt every time it is read) and took the selection back. With two
 * component tabs open they took it from each other until React stopped them and the editors crashed.
 */

const PAGE = "page-save";
const OTHER_PAGE = "page-load";
const COMPONENT = "component-editor:save-slot";
const OTHER_COMPONENT = "component-editor:nav-entry";

/** The selection half of `UIStore`: every write is stored and announced, equal or not. */
class FakeSelectionStore implements SurfaceTabSelectionHost {
    public selection: SelectionState = { type: null, data: null };
    public writes: SelectionState[] = [];
    private readonly listeners = new Set<(selection: SelectionState) => void>();

    public getSelection(): SelectionState {
        return this.selection;
    }

    public setSelection(selection: SelectionState): void {
        this.writes.push(selection);
        if (this.writes.length > 200) {
            throw new Error("selection written 200 times: something is fighting over it");
        }
        this.selection = selection;
        for (const listener of [...this.listeners]) {
            listener(selection);
        }
    }

    public on(_event: "selectionChanged", handler: (selection: SelectionState) => void): () => void {
        this.listeners.add(handler);
        return () => {
            this.listeners.delete(handler);
        };
    }
}

function elementSelection(surfaceId: string, ...elementIds: string[]): SelectionState {
    return {
        type: "element",
        data: { editor: "ui", surfaceId, elementIds, primaryId: elementIds[elementIds.length - 1] },
    };
}

function documentWith(...elementIds: string[]): { getDocument(): UIDocument } {
    const elements = Object.fromEntries(elementIds.map(id => [id, { id }]));
    return { getDocument: () => ({ elements }) as unknown as UIDocument };
}

/**
 * Shaped like `UISurfaceEditorTab` where it matters: it re-renders on every selection change, and a
 * component reads its surface from a document rebuilt on every read, so the object is new each time.
 */
function FakeSurfaceTab(props: {
    store: FakeSelectionStore;
    surfaceId: string;
    active: boolean;
    elementIds?: string[];
    rebuildsSurface?: boolean;
}) {
    const { store, surfaceId, active, elementIds = [], rebuildsSurface = false } = props;
    const [, setVersion] = useState(0);
    useEffect(() => store.on("selectionChanged", () => setVersion(v => v + 1)), [store]);
    const [stableSurface] = useState(() => ({ id: surfaceId }));
    const surface = rebuildsSurface ? { id: surfaceId } : stableSurface;
    const [documentService] = useState(() => documentWith(...elementIds));
    useSurfaceTabSelection({ stateService: store, documentService, surfaceId: surface.id, active });
    return null;
}

afterEach(() => {
    cleanup();
});

describe("a surface editor tab and the shared selection", () => {
    it("lets a click on a page stand with a component editor open behind it", () => {
        const store = new FakeSelectionStore();
        const tabs = (activePage: boolean) => (
            <>
                <FakeSurfaceTab store={store} surfaceId={PAGE} active={activePage} elementIds={["title"]} />
                <FakeSurfaceTab store={store} surfaceId={COMPONENT} active={!activePage} rebuildsSurface />
            </>
        );
        // Opened the page, then the component, then went back to the page.
        const view = render(tabs(true));
        view.rerender(tabs(false));
        view.rerender(tabs(true));

        act(() => store.setSelection(elementSelection(PAGE, "title")));

        expect(store.selection).toEqual(elementSelection(PAGE, "title"));
    });

    it("does not let two component editors fight over the selection", () => {
        const store = new FakeSelectionStore();
        render(
            <>
                <FakeSurfaceTab store={store} surfaceId={PAGE} active elementIds={["title"]} />
                <FakeSurfaceTab store={store} surfaceId={COMPONENT} active={false} rebuildsSurface />
                <FakeSurfaceTab store={store} surfaceId={OTHER_COMPONENT} active={false} rebuildsSurface />
            </>,
        );
        store.writes = [];

        act(() => store.setSelection(elementSelection(PAGE, "title")));

        expect(store.writes).toEqual([elementSelection(PAGE, "title")]);
        expect(store.selection).toEqual(elementSelection(PAGE, "title"));
    });

    it("hands the inspector to the tab that is switched to", () => {
        const store = new FakeSelectionStore();
        const tabs = (active: string) => (
            <>
                <FakeSurfaceTab store={store} surfaceId={PAGE} active={active === PAGE} elementIds={["title"]} />
                <FakeSurfaceTab store={store} surfaceId={OTHER_PAGE} active={active === OTHER_PAGE} elementIds={["slot"]} />
            </>
        );
        const view = render(tabs(PAGE));
        act(() => store.setSelection(elementSelection(PAGE, "title")));

        view.rerender(tabs(OTHER_PAGE));

        expect(store.selection).toEqual({ type: "scene", data: OTHER_PAGE });
    });

    it("gives back the element that was selected on a page when the author returns to it", () => {
        const store = new FakeSelectionStore();
        const tabs = (activePage: boolean) => (
            <>
                <FakeSurfaceTab store={store} surfaceId={PAGE} active={activePage} elementIds={["title", "slot"]} />
                <FakeSurfaceTab
                    store={store}
                    surfaceId={COMPONENT}
                    active={!activePage}
                    elementIds={["frame"]}
                    rebuildsSurface
                />
            </>
        );
        const view = render(tabs(true));
        act(() => store.setSelection(elementSelection(PAGE, "title", "slot")));
        view.rerender(tabs(false));
        act(() => store.setSelection(elementSelection(COMPONENT, "frame")));

        view.rerender(tabs(true));
        expect(store.selection).toEqual(elementSelection(PAGE, "title", "slot"));

        view.rerender(tabs(false));
        expect(store.selection).toEqual(elementSelection(COMPONENT, "frame"));
    });

    it("never writes the selection from a hidden tab", () => {
        const store = new FakeSelectionStore();
        store.selection = { type: "scene", data: OTHER_PAGE };
        render(
            <>
                <FakeSurfaceTab store={store} surfaceId={PAGE} active={false} />
                <FakeSurfaceTab store={store} surfaceId={COMPONENT} active={false} rebuildsSurface />
            </>,
        );
        act(() => store.setSelection({ type: "scene", data: OTHER_PAGE }));

        expect(store.writes).toEqual([{ type: "scene", data: OTHER_PAGE }]);
    });

    it("waits for its surface to exist before claiming anything", () => {
        const store = new FakeSelectionStore();
        function LateTab({ surfaceId }: { surfaceId: string | undefined }) {
            useSurfaceTabSelection({ stateService: store, documentService: null, surfaceId, active: true });
            return null;
        }
        const view = render(<LateTab surfaceId={undefined} />);
        expect(store.writes).toEqual([]);

        view.rerender(<LateTab surfaceId={PAGE} />);
        expect(store.selection).toEqual({ type: "scene", data: PAGE });
    });
});

describe("resolveSurfaceTabSelectionClaim", () => {
    const hasElement = (known: string[]) => (id: string) => known.includes(id);

    it("leaves a selection that is already on the surface alone", () => {
        expect(
            resolveSurfaceTabSelectionClaim({
                current: elementSelection(PAGE, "title"),
                surfaceId: PAGE,
                owned: null,
                hasElement: hasElement(["title"]),
            }),
        ).toBeNull();
        expect(
            resolveSurfaceTabSelectionClaim({
                current: { type: "scene", data: PAGE },
                surfaceId: PAGE,
                owned: null,
                hasElement: hasElement([]),
            }),
        ).toBeNull();
    });

    it("leaves a selection of another kind alone", () => {
        const character = { type: "character", data: { id: "narra" } } as unknown as SelectionState;
        expect(
            resolveSurfaceTabSelectionClaim({ current: character, surfaceId: PAGE, owned: null, hasElement: hasElement([]) }),
        ).toBeNull();
    });

    it("takes the surface itself when it owns nothing yet", () => {
        expect(
            resolveSurfaceTabSelectionClaim({
                current: elementSelection(OTHER_PAGE, "slot"),
                surfaceId: PAGE,
                owned: null,
                hasElement: hasElement([]),
            }),
        ).toEqual({ type: "scene", data: PAGE });
        expect(
            resolveSurfaceTabSelectionClaim({
                current: { type: null, data: null },
                surfaceId: PAGE,
                owned: null,
                hasElement: hasElement([]),
            }),
        ).toEqual({ type: "scene", data: PAGE });
    });

    it("drops elements that went away while the tab was hidden", () => {
        expect(
            resolveSurfaceTabSelectionClaim({
                current: { type: "scene", data: COMPONENT },
                surfaceId: PAGE,
                owned: elementSelection(PAGE, "title", "gone"),
                hasElement: hasElement(["title"]),
            }),
        ).toEqual(elementSelection(PAGE, "title"));
        expect(
            resolveSurfaceTabSelectionClaim({
                current: { type: "scene", data: COMPONENT },
                surfaceId: PAGE,
                owned: elementSelection(PAGE, "gone"),
                hasElement: hasElement(["title"]),
            }),
        ).toEqual({ type: "scene", data: PAGE });
    });
});
