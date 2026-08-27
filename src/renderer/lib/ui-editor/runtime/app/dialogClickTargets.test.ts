import { describe, expect, it } from "vitest";
import { createDialogClickTargets } from "./dialogClickTargets";

/**
 * A dialog box, reduced to the one thing the registry asks it: is it still on the stage.
 *
 * The registry never touches anything else on an element, which is what lets the rules below be
 * stated as an order of claims and departures rather than as a DOM.
 */
function makeBox(name: string) {
    return { name, isConnected: true } as unknown as HTMLElement & { name: string; isConnected: boolean };
}

describe("dialog click targets", () => {
    it("has nothing before a box is mounted", () => {
        expect(createDialogClickTargets().current()).toBeNull();
    });

    it("answers with the newest box", () => {
        const targets = createDialogClickTargets();
        const first = makeBox("first");
        const second = makeBox("second");
        targets.set(first);
        targets.set(second);
        expect(targets.current()).toBe(second);
    });

    it("keeps the box that is live when a box that left clears itself", () => {
        // The scene call, in the order React commits it: the called scene's box is attached while
        // the caller's is still on screen, and the caller's release arrives afterwards. A single
        // slot answered that release by forgetting the box the story was actually in.
        const targets = createDialogClickTargets();
        const caller = makeBox("caller");
        const called = makeBox("called");
        targets.set(caller);
        targets.set(called);

        caller.isConnected = false;
        targets.set(null);

        expect(targets.current()).toBe(called);
    });

    it("keeps the box that is live when the newest one leaves", () => {
        // The return: the called scene's box goes, and the caller's - claimed first, and never
        // re-claimed while it was parked - is the only one left to take the click.
        const targets = createDialogClickTargets();
        const caller = makeBox("caller");
        const called = makeBox("called");
        targets.set(caller);
        targets.set(called);

        called.isConnected = false;

        expect(targets.current()).toBe(caller);
    });

    it("drops a box that left without saying so", () => {
        const targets = createDialogClickTargets();
        const box = makeBox("box");
        targets.set(box);
        box.isConnected = false;
        expect(targets.current()).toBeNull();
    });

    it("does not answer with a box that is still claimed but off the document", () => {
        const targets = createDialogClickTargets();
        const gone = makeBox("gone");
        const live = makeBox("live");
        targets.set(gone);
        gone.isConnected = false;
        targets.set(live);
        expect(targets.current()).toBe(live);
    });

    it("re-claiming a box makes it the newest rather than a duplicate", () => {
        const targets = createDialogClickTargets();
        const first = makeBox("first");
        const second = makeBox("second");
        targets.set(first);
        targets.set(second);
        targets.set(first);
        expect(targets.current()).toBe(first);

        first.isConnected = false;
        expect(targets.current()).toBe(second);
    });

    it("forgets everything when the session ends", () => {
        const targets = createDialogClickTargets();
        targets.set(makeBox("box"));
        targets.clear();
        expect(targets.current()).toBeNull();
    });
});
