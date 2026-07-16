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
