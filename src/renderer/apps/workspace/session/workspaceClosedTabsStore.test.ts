import { afterEach, describe, expect, it } from "vitest";
import type { EditorTabDefinition } from "@/apps/workspace/registry/types";
import {
    clearClosedTabs,
    hasClosedTabs,
    popClosedTab,
    recordClosedTabs,
} from "./workspaceClosedTabsStore";

// Serializable via trySerializeTab's surface branch without needing a workspace.
function surfaceTab(surfaceId: string): EditorTabDefinition {
    return {
        id: `ui-editor:surface:${surfaceId}`,
        title: surfaceId,
        component: () => null,
    } as unknown as EditorTabDefinition;
}

// No serialization strategy → must be skipped by recordClosedTabs.
function transientTab(id: string): EditorTabDefinition {
    return {
        id,
        title: id,
        component: () => null,
    } as unknown as EditorTabDefinition;
}

afterEach(() => {
    clearClosedTabs();
});

describe("workspaceClosedTabsStore", () => {
    it("records serializable tabs and pops them most-recent-first", () => {
        recordClosedTabs([{ tab: surfaceTab("a"), index: 0 }], "group-1");
        recordClosedTabs([{ tab: surfaceTab("b"), index: 3 }], "group-1");

        expect(hasClosedTabs()).toBe(true);
        expect(popClosedTab()).toMatchObject({ entry: { kind: "surface", surfaceId: "b" }, index: 3 });
        expect(popClosedTab()).toMatchObject({ entry: { kind: "surface", surfaceId: "a" }, index: 0 });
        expect(popClosedTab()).toBeNull();
    });

    it("skips tabs that have no serialization strategy", () => {
        recordClosedTabs([{ tab: transientTab("some-transient-tab"), index: 0 }], "group-1");
        expect(hasClosedTabs()).toBe(false);
    });

    it("keeps a bulk close in visual order so popping restores right-to-left", () => {
        recordClosedTabs(
            [
                { tab: surfaceTab("left"), index: 0 },
                { tab: surfaceTab("right"), index: 1 },
            ],
            "group-1",
        );
        expect(popClosedTab()).toMatchObject({ entry: { surfaceId: "right" } });
        expect(popClosedTab()).toMatchObject({ entry: { surfaceId: "left" } });
    });

    /*
     * The pop-order tests above pass even when the stored indices are wrong —
     * order only comes back right once the recorded index is fed through the
     * insert. These drive the round trip end to end instead.
     */
    describe("reopening restores the original order", () => {
        // Mirrors UIStore.openEditorTabInGroup's insert: clamp, then splice.
        function reopenAll(): string[] {
            const tabs: string[] = [];
            for (let record = popClosedTab(); record; record = popClosedTab()) {
                const at = Math.max(0, Math.min(record.index, tabs.length));
                tabs.splice(at, 0, record.entry.kind === "surface" ? record.entry.surfaceId : "?");
            }
            return tabs;
        }

        // Close a subset of [A,B,C,D] the way Registry does: positions are the
        // ones held before the batch ran.
        function closeFrom(open: string[], closing: string[]): void {
            recordClosedTabs(
                open
                    .map((id, index) => ({ tab: surfaceTab(id), index }))
                    .filter(({ tab }) => closing.some(id => tab.id.endsWith(`:${id}`))),
                "group-1",
            );
        }

        const open = ["a", "b", "c", "d"];

        it("close all", () => {
            closeFrom(open, ["a", "b", "c", "d"]);
            expect(reopenAll()).toEqual(["a", "b", "c", "d"]);
        });

        it("close others (keeping b)", () => {
            closeFrom(open, ["a", "c", "d"]);
            // b survived the close, so it is already sitting at index 0.
            const tabs = ["b"];
            for (let record = popClosedTab(); record; record = popClosedTab()) {
                const at = Math.max(0, Math.min(record.index, tabs.length));
                tabs.splice(at, 0, record.entry.kind === "surface" ? record.entry.surfaceId : "?");
            }
            expect(tabs).toEqual(["a", "b", "c", "d"]);
        });

        it("close to the right of b", () => {
            closeFrom(open, ["c", "d"]);
            const tabs = ["a", "b"];
            for (let record = popClosedTab(); record; record = popClosedTab()) {
                const at = Math.max(0, Math.min(record.index, tabs.length));
                tabs.splice(at, 0, record.entry.kind === "surface" ? record.entry.surfaceId : "?");
            }
            expect(tabs).toEqual(["a", "b", "c", "d"]);
        });

        it("close all, three tabs", () => {
            closeFrom(["a", "b", "c"], ["a", "b", "c"]);
            expect(reopenAll()).toEqual(["a", "b", "c"]);
        });

        it("a tab that cannot be serialized still shifts the rest", () => {
            recordClosedTabs(
                [
                    { tab: surfaceTab("a"), index: 0 },
                    { tab: transientTab("gone"), index: 1 },
                    { tab: surfaceTab("c"), index: 2 },
                ],
                "group-1",
            );
            // "gone" is unrecoverable; a and c must still come back in order.
            expect(reopenAll()).toEqual(["a", "c"]);
        });
    });

    it("is bounded — old entries fall off, newest survive", () => {
        for (let i = 0; i < 30; i++) {
            recordClosedTabs([{ tab: surfaceTab(`s${i}`), index: i }], "group-1");
        }
        let count = 0;
        let last: string | undefined;
        for (let record = popClosedTab(); record; record = popClosedTab()) {
            count++;
            if (record.entry.kind === "surface") {
                last = record.entry.surfaceId;
            }
        }
        expect(count).toBe(20);
        expect(last).toBe("s10");
    });
});
