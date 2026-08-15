import { describe, expect, it } from "vitest";
import { resolveCompositeInput, type CompositeInputState } from "./compositeInput";

/**
 * Before layers existed, a surface layer derived both pointer interactivity and keyboard ownership
 * from one comparison: `entry.key === activeEntry.key`. Every topology reachable without layers has
 * to keep answering exactly that, which is what the first block checks - one assertion per entry, so
 * a drift shows up as the entry it happened to.
 */
function legacyAnswer(state: CompositeInputState, key: string): boolean {
    return key === state.activePageKey;
}

function expectMatchesLegacy(state: CompositeInputState): void {
    const resolution = resolveCompositeInput(state);
    for (const entry of state.pageEntries) {
        expect(resolution.interactiveKeys.has(entry.key), `interactive: ${entry.key}`)
            .toBe(legacyAnswer(state, entry.key));
        expect(resolution.keyboardOwnerKey === entry.key, `keyboard: ${entry.key}`)
            .toBe(legacyAnswer(state, entry.key));
    }
}

describe("resolveCompositeInput - equivalence with no layers", () => {
    it("single page: the one entry is interactive and owns the keyboard", () => {
        const state: CompositeInputState = {
            pageEntries: [{ key: "menu:1" }],
            activePageKey: "menu:1",
            layers: [],
        };
        expectMatchesLegacy(state);
        const resolution = resolveCompositeInput(state);
        expect([...resolution.interactiveKeys]).toEqual(["menu:1"]);
        expect(resolution.keyboardOwnerKey).toBe("menu:1");
    });

    it("mid-transition, two entries mounted: only the arriving one takes input", () => {
        // The open update's ordinary shape: [incoming, outgoing], the incoming one already on top of
        // the page stack.
        const state: CompositeInputState = {
            pageEntries: [{ key: "config:2" }, { key: "menu:1" }],
            activePageKey: "config:2",
            layers: [],
        };
        expectMatchesLegacy(state);
        expect([...resolveCompositeInput(state).interactiveKeys]).toEqual(["config:2"]);
    });

    it("exitBehind: the held page is inert while the arriving page enters over it", () => {
        // `holdCurrentUntilEnterComplete` keeps the outgoing entry mounted UNDER the incoming one
        // ([outgoing(exitBehind), incoming]), which is the one topology where the inert entry is
        // listed first.
        const state: CompositeInputState = {
            pageEntries: [{ key: "menu:1" }, { key: "config:2" }],
            activePageKey: "config:2",
            layers: [],
        };
        expectMatchesLegacy(state);
        expect([...resolveCompositeInput(state).interactiveKeys]).toEqual(["config:2"]);
    });

    it("back: the page being returned to takes input, the one leaving does not", () => {
        expectMatchesLegacy({
            pageEntries: [{ key: "menu:1" }, { key: "config:2" }],
            activePageKey: "menu:1",
            layers: [],
        });
    });

    it("nothing mounted: no interactive entry, and ownership still names the active page", () => {
        // A `waitForExit` transition empties the lane while the incoming page prepaints. Ownership is
        // a fact about the stack; whether that entry has painted is a separate gate the page lane
        // applies itself.
        const resolution = resolveCompositeInput({
            pageEntries: [],
            activePageKey: "config:2",
            layers: [],
        });
        expect(resolution.interactiveKeys.size).toBe(0);
        expect(resolution.keyboardOwnerKey).toBe("config:2");
    });

    it("no active page at all: nothing is interactive and nobody owns the keyboard", () => {
        const resolution = resolveCompositeInput({ pageEntries: [], activePageKey: null, layers: [] });
        expect(resolution.interactiveKeys.size).toBe(0);
        expect(resolution.keyboardOwnerKey).toBeNull();
    });
});

describe("resolveCompositeInput - layers", () => {
    it("a non-modal layer leaves the page lane exactly as it was", () => {
        const resolution = resolveCompositeInput({
            pageEntries: [{ key: "menu:1" }],
            activePageKey: "menu:1",
            layers: [{ key: "layer:hud:1", modal: false }],
        });
        expect([...resolution.interactiveKeys].sort()).toEqual(["layer:hud:1", "menu:1"]);
        expect(resolution.keyboardOwnerKey).toBe("menu:1");
    });

    it("a modal layer makes the page lane inert and takes the keyboard", () => {
        const resolution = resolveCompositeInput({
            pageEntries: [{ key: "menu:1" }, { key: "config:2" }],
            activePageKey: "config:2",
            layers: [{ key: "layer:confirm:1", modal: true }],
        });
        expect([...resolution.interactiveKeys]).toEqual(["layer:confirm:1"]);
        expect(resolution.keyboardOwnerKey).toBe("layer:confirm:1");
    });

    it("modal below, non-modal above: both are live and the keys stay with the modal", () => {
        // The counter-intuitive one, and it is deliberate. The floor is the topmost MODAL layer, so
        // nothing above it is inert; ownership is that same layer, not the top of the stack. Anyone
        // "tidying" this into "the top layer owns the keyboard" breaks it.
        const resolution = resolveCompositeInput({
            pageEntries: [{ key: "menu:1" }],
            activePageKey: "menu:1",
            layers: [
                { key: "layer:confirm:1", modal: true },
                { key: "layer:toast:2", modal: false },
            ],
        });
        expect([...resolution.interactiveKeys].sort()).toEqual(["layer:confirm:1", "layer:toast:2"]);
        expect(resolution.keyboardOwnerKey).toBe("layer:confirm:1");
    });

    it("two modals: the floor and the owner are both the upper one", () => {
        const resolution = resolveCompositeInput({
            pageEntries: [{ key: "menu:1" }],
            activePageKey: "menu:1",
            layers: [
                { key: "layer:a:1", modal: true },
                { key: "layer:b:2", modal: true },
            ],
        });
        expect([...resolution.interactiveKeys]).toEqual(["layer:b:2"]);
        expect(resolution.keyboardOwnerKey).toBe("layer:b:2");
    });

    it("non-modal below a modal is inert", () => {
        const resolution = resolveCompositeInput({
            pageEntries: [{ key: "menu:1" }],
            activePageKey: "menu:1",
            layers: [
                { key: "layer:hud:1", modal: false },
                { key: "layer:confirm:2", modal: true },
            ],
        });
        expect([...resolution.interactiveKeys]).toEqual(["layer:confirm:2"]);
        expect(resolution.keyboardOwnerKey).toBe("layer:confirm:2");
    });

    it("only layers, no page: the modal still owns the keyboard", () => {
        const resolution = resolveCompositeInput({
            pageEntries: [],
            activePageKey: null,
            layers: [{ key: "layer:confirm:1", modal: true }],
        });
        expect([...resolution.interactiveKeys]).toEqual(["layer:confirm:1"]);
        expect(resolution.keyboardOwnerKey).toBe("layer:confirm:1");
    });

    it("never reports a key that was not handed in", () => {
        const resolution = resolveCompositeInput({
            pageEntries: [{ key: "menu:1" }],
            // A page the lane is settling on that is not mounted this frame stays out of the set.
            activePageKey: "config:2",
            layers: [{ key: "layer:hud:1", modal: false }],
        });
        expect([...resolution.interactiveKeys]).toEqual(["layer:hud:1"]);
    });
});
