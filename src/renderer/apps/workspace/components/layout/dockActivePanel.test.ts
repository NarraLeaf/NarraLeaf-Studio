import { describe, it, expect } from "vitest";
import { firstDrawablePanelId, resolveActivePanelId, type DockPanelEntry } from "./dockActivePanel";

const panel = (id: string): DockPanelEntry => ({ id });
const railAction = (id: string): DockPanelEntry => ({ id, railAction: () => undefined });

describe("firstDrawablePanelId", () => {
    it("takes the first panel in rail order", () => {
        expect(firstDrawablePanelId([panel("a"), panel("b")])).toBe("a");
    });

    it("skips rail actions, which have no body", () => {
        expect(firstDrawablePanelId([railAction("run"), panel("b")])).toBe("b");
    });

    it("skips panels switched off from the rail", () => {
        expect(firstDrawablePanelId([panel("a"), panel("b")], { visibility: { a: false } })).toBe("b");
    });

    it("skips panels folded into the collapse group", () => {
        expect(firstDrawablePanelId([panel("a"), panel("b")], { collapsed: ["a"] })).toBe("b");
    });

    it("answers null when the dock offers nothing", () => {
        expect(firstDrawablePanelId([])).toBeNull();
        expect(firstDrawablePanelId([railAction("run")])).toBeNull();
        expect(firstDrawablePanelId([panel("a")], { visibility: { a: false } })).toBeNull();
    });
});

describe("resolveActivePanelId", () => {
    it("keeps a stored id that names a registered panel", () => {
        expect(resolveActivePanelId("b", [panel("a"), panel("b")])).toBe("b");
    });

    it("keeps a stored id whose icon the author switched off, or folded away", () => {
        // Rail state, not a statement about the panel: the author goes on reading what they had
        // open until something moves them off it.
        expect(resolveActivePanelId("b", [panel("a"), panel("b")], { visibility: { b: false } })).toBe("b");
        expect(resolveActivePanelId("b", [panel("a"), panel("b")], { collapsed: ["b"] })).toBe("b");
    });

    it("falls back when the stored id names a panel this window does not have", () => {
        // A plugin that is not installed here, or one whose dependency this project does not meet.
        expect(resolveActivePanelId("acme.panel", [panel("a"), panel("b")])).toBe("a");
    });

    it("falls back past a rail action, which cannot be what a dock shows", () => {
        expect(resolveActivePanelId("run", [railAction("run"), panel("b")])).toBe("b");
    });

    it("answers null for a dock with nothing to fall back to", () => {
        expect(resolveActivePanelId("acme.panel", [])).toBeNull();
    });

    it("answers null when nothing is stored, rather than choosing for the author", () => {
        expect(resolveActivePanelId(null, [panel("a")])).toBeNull();
        expect(resolveActivePanelId(undefined, [panel("a")])).toBeNull();
    });

    it("takes the stored panel back as soon as it registers", () => {
        const before = [panel("a")];
        const after = [panel("a"), panel("acme.panel")];
        expect(resolveActivePanelId("acme.panel", before)).toBe("a");
        expect(resolveActivePanelId("acme.panel", after)).toBe("acme.panel");
    });
});
