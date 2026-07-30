import { describe, expect, it } from "vitest";
import type { VcsHistoryEntry } from "@shared/types/vcs";
import { RAIL_SELECTOR_WIDTH } from "./dockLayoutModel";
import {
    VERSION_RAIL_COLLAPSED_WIDTH,
    VERSION_RAIL_EXPANDED_WIDTH,
    collapseCheckpoints,
    flattenFirstParent,
    hiddenCheckpointCount,
    isVersionSurfaceVisible,
    resolveVersionSurfaceState,
    revisionLabel,
    shortRevision,
    unavailableReasonKey,
    versionRailWidth,
    type VersionSurfaceInputs,
} from "./versionRailModel";

const inputs = (overrides: Partial<VersionSurfaceInputs> = {}): VersionSurfaceInputs => ({
    availability: { available: true },
    isRepository: true,
    head: "aaaa1111",
    headNumber: 4,
    shownRevision: null,
    ...overrides,
});

/** `parents` first-parent-first, exactly as the backend orders it. */
const entry = (number: number, revision: string, parents: string[] = [], kind?: "commit" | "checkpoint"): VcsHistoryEntry =>
    ({ revision, number, parents, kind });

describe("versionRailWidth", () => {
    it("is zero when the rail is not shown, so the solver reserves nothing for it", () => {
        expect(versionRailWidth(false, false)).toBe(0);
        expect(versionRailWidth(false, true)).toBe(0);
    });

    it("matches the sidebar selector rail when collapsed", () => {
        expect(versionRailWidth(true, false)).toBe(RAIL_SELECTOR_WIDTH);
        expect(VERSION_RAIL_COLLAPSED_WIDTH).toBe(RAIL_SELECTOR_WIDTH);
    });

    it("is the plan's 320px expanded", () => {
        expect(versionRailWidth(true, true)).toBe(VERSION_RAIL_EXPANDED_WIDTH);
        expect(VERSION_RAIL_EXPANDED_WIDTH).toBe(320);
    });
});

describe("resolveVersionSurfaceState", () => {
    it("probes before availability has answered", () => {
        expect(resolveVersionSurfaceState(inputs({ availability: null }))).toEqual({ kind: "probing" });
    });

    it("probes before isRepository has answered, rather than claiming there is no repository", () => {
        // The wrong answer here would offer "enable version control" for a project that already has
        // a repository - one click from an error the author cannot undo.
        expect(resolveVersionSurfaceState(inputs({ isRepository: null }))).toEqual({ kind: "probing" });
    });

    it("reports unavailability with its reason, ahead of every other question", () => {
        const state = resolveVersionSurfaceState(inputs({
            availability: { available: false, reason: "unsupported-platform" },
            isRepository: true,
        }));
        expect(state).toEqual({ kind: "unavailable", reason: "unsupported-platform", detail: undefined });
    });

    it("offers to enable version control when the backend works but the project has no repository", () => {
        expect(resolveVersionSurfaceState(inputs({ isRepository: false }))).toEqual({ kind: "not-a-repository" });
    });

    it("is empty for a repository with no revisions", () => {
        expect(resolveVersionSurfaceState(inputs({ head: null }))).toEqual({ kind: "empty" });
    });

    it("reports the working tree with the head's number", () => {
        expect(resolveVersionSurfaceState(inputs())).toEqual({ kind: "current", head: "aaaa1111", number: 4 });
    });

    it("still reports the working tree when info has not answered yet", () => {
        expect(resolveVersionSurfaceState(inputs({ headNumber: null })))
            .toEqual({ kind: "current", head: "aaaa1111", number: null });
    });

    it("lets a shown revision win over an unread head, so a frozen workspace always names its cause", () => {
        // Reachable for real: showRevision freezes BEFORE reading, so there is a window where the
        // editors are frozen on a revision and nothing else has answered yet. Reporting "empty" there
        // would leave the author frozen with no visible reason.
        const state = resolveVersionSurfaceState(inputs({
            head: null,
            headNumber: null,
            isRepository: null,
            shownRevision: "bbbb2222",
            shownLabel: "#3",
        }));
        expect(state).toEqual({ kind: "revision", revision: "bbbb2222", label: "#3" });
    });

    it("does not let a shown revision override an unavailable backend", () => {
        // A stale freeze plus a backend that stopped loading must not render a rail that cannot work.
        const state = resolveVersionSurfaceState(inputs({
            availability: { available: false, reason: "backend-load-failed" },
            shownRevision: "bbbb2222",
        }));
        expect(state.kind).toBe("unavailable");
    });
});

describe("isVersionSurfaceVisible", () => {
    it("hides the surface entirely when version control is unavailable", () => {
        expect(isVersionSurfaceVisible({ kind: "unavailable", reason: "backend-missing" })).toBe(false);
    });

    it("shows it in every other state, including while probing", () => {
        // Probing is a fraction of a second on a supported host; hiding then showing would flash a
        // column in and out of the layout on every project open.
        expect(isVersionSurfaceVisible({ kind: "probing" })).toBe(true);
        expect(isVersionSurfaceVisible({ kind: "not-a-repository" })).toBe(true);
        expect(isVersionSurfaceVisible({ kind: "empty" })).toBe(true);
        expect(isVersionSurfaceVisible({ kind: "current", head: "a", number: 1 })).toBe(true);
        expect(isVersionSurfaceVisible({ kind: "revision", revision: "a" })).toBe(true);
    });
});

describe("unavailableReasonKey", () => {
    it("blames the machine for an unsupported platform", () => {
        expect(unavailableReasonKey("unsupported-platform"))
            .toBe("workspace.shell.versionControl.unavailable.platform");
    });

    it("blames the installation for both backend failures", () => {
        // Two reasons, one message: the author's fix is the same (reinstall), and the difference
        // between "not shipped in this build" and "would not load" is ours to debug, not theirs.
        expect(unavailableReasonKey("backend-missing"))
            .toBe("workspace.shell.versionControl.unavailable.installation");
        expect(unavailableReasonKey("backend-load-failed"))
            .toBe("workspace.shell.versionControl.unavailable.installation");
    });
});

describe("flattenFirstParent", () => {
    it("answers nothing for an empty history", () => {
        expect(flattenFirstParent([])).toEqual([]);
    });

    it("walks a linear history newest to oldest", () => {
        const history = [entry(3, "c", ["b"]), entry(2, "b", ["a"]), entry(1, "a")];
        expect(flattenFirstParent(history).map(row => row.revision)).toEqual(["c", "b", "a"]);
    });

    it("starts at the highest revision number even when the input is not sorted", () => {
        const history = [entry(1, "a"), entry(3, "c", ["b"]), entry(2, "b", ["a"])];
        expect(flattenFirstParent(history).map(row => row.number)).toEqual([3, 2, 1]);
    });

    it("marks a merge and follows only its first parent", () => {
        // m merges the side branch s into the main line b -> a. The rail is linear by decision, so s
        // is dropped and m carries the marker that says a second ancestry exists.
        const history = [
            entry(4, "m", ["b", "s"]),
            entry(3, "s", ["a"]),
            entry(2, "b", ["a"]),
            entry(1, "a"),
        ];
        const flat = flattenFirstParent(history);
        expect(flat.map(row => row.revision)).toEqual(["m", "b", "a"]);
        expect(flat.map(row => row.merge)).toEqual([true, false, false]);
    });

    it("stops where a paged read ends instead of failing on the missing parent", () => {
        const page = [entry(9, "i", ["h"]), entry(8, "h", ["g"])];
        expect(flattenFirstParent(page).map(row => row.revision)).toEqual(["i", "h"]);
    });

    it("terminates on a cycle rather than walking forever", () => {
        // Not producible by a sane backend; a rail that hung the renderer would be the worst way to
        // find out it happened.
        const bogus = [entry(2, "b", ["a"]), entry(1, "a", ["b"])];
        expect(flattenFirstParent(bogus).map(row => row.revision)).toEqual(["b", "a"]);
    });

    it("carries the kind through untouched, absent included", () => {
        const history = [entry(2, "b", ["a"], "checkpoint"), entry(1, "a")];
        const flat = flattenFirstParent(history);
        expect(flat[0].kind).toBe("checkpoint");
        expect(flat[1].kind).toBeUndefined();
    });
});

describe("collapseCheckpoints", () => {
    const flat = flattenFirstParent([
        entry(4, "d", ["c"], "commit"),
        entry(3, "c", ["b"], "checkpoint"),
        entry(2, "b", ["a"], "checkpoint"),
        // The repository's first commit records no kind at all - initRepository predates them.
        entry(1, "a"),
    ]);

    it("drops checkpoints by default", () => {
        expect(collapseCheckpoints(flat).map(row => row.revision)).toEqual(["d", "a"]);
    });

    it("keeps a revision that records no kind, because absent is not a checkpoint", () => {
        // Getting this backwards hides the repository's oldest revision - the one an author looks for
        // first when they want to know what the project used to be.
        expect(collapseCheckpoints(flat).some(row => row.revision === "a")).toBe(true);
    });

    it("shows everything when asked", () => {
        expect(collapseCheckpoints(flat, { showCheckpoints: true }).map(row => row.revision))
            .toEqual(["d", "c", "b", "a"]);
    });

    it("never drops a kept revision, so the row the author is standing on cannot vanish", () => {
        const kept = collapseCheckpoints(flat, { keep: new Set(["b"]) });
        expect(kept.map(row => row.revision)).toEqual(["d", "b", "a"]);
    });

    it("does not mutate its input", () => {
        const before = flat.map(row => row.revision);
        collapseCheckpoints(flat, { showCheckpoints: true });
        collapseCheckpoints(flat);
        expect(flat.map(row => row.revision)).toEqual(before);
    });

    it("counts what it hid, so the list can offer to show them", () => {
        expect(hiddenCheckpointCount(flat)).toBe(2);
        expect(hiddenCheckpointCount(flat, { showCheckpoints: true })).toBe(0);
        expect(hiddenCheckpointCount(flat, { keep: new Set(["b"]) })).toBe(1);
    });
});

describe("labels", () => {
    it("shortens a revision to something a person can compare by eye", () => {
        expect(shortRevision("a91f3c8d2e4b6")).toBe("a91f3c8");
        expect(shortRevision("abc")).toBe("abc");
    });

    it("leads with the revision number, which is the part that means anything", () => {
        expect(revisionLabel(4)).toBe("#4");
    });
});
