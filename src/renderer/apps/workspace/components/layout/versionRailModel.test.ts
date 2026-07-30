import { describe, expect, it } from "vitest";
import type { VcsHistoryEntry } from "@shared/types/vcs";
import { RAIL_SELECTOR_WIDTH } from "./dockLayoutModel";
import {
    VERSION_RAIL_COLLAPSED_WIDTH,
    VERSION_RAIL_EXPANDED_WIDTH,
    canCommit,
    collapseCheckpoints,
    findRevisionRow,
    flattenFirstParent,
    focusedRevision,
    hiddenCheckpointCount,
    isCommitFormPresent,
    isVersionSurfaceVisible,
    resolveVersionRailPresence,
    resolveVersionSurfaceState,
    revisionLabel,
    shortRevision,
    unavailableReasonKey,
    versionRailWidth,
    type VersionRailPresence,
    type VersionSurfaceInputs,
    type VersionSurfaceState,
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
    it("is zero when the rail is absent, so the solver reserves nothing for it", () => {
        expect(versionRailWidth("absent")).toBe(0);
    });

    it("matches the sidebar selector rail as a strip", () => {
        expect(versionRailWidth("strip")).toBe(RAIL_SELECTOR_WIDTH);
        expect(VERSION_RAIL_COLLAPSED_WIDTH).toBe(RAIL_SELECTOR_WIDTH);
    });

    it("is the plan's 320px as a panel", () => {
        expect(versionRailWidth("panel")).toBe(VERSION_RAIL_EXPANDED_WIDTH);
        expect(VERSION_RAIL_EXPANDED_WIDTH).toBe(320);
    });
});

/**
 * The presence rule, enumerated.
 *
 * Every surface state crossed with every combination of "the author has the panel open" and "project
 * data is frozen" - because the correction being implemented is precisely that two of these used to
 * answer `strip` and now have to answer `absent`, and a rule stated in prose is a rule that drifts back.
 *
 * The two lines worth reading twice: `current` + not frozen + not open is **absent** (no strip at HEAD,
 * and 0 in the dock account), and `current` + frozen is **strip** (a MANUAL freeze, which leaves the
 * state on `current` - a frozen workspace with no visible way out is worse than a strip nobody asked
 * for).
 */
describe("resolveVersionRailPresence", () => {
    const states: Record<string, VersionSurfaceState> = {
        probing: { kind: "probing" },
        unavailable: { kind: "unavailable", reason: "unsupported-platform" },
        "not-a-repository": { kind: "not-a-repository" },
        empty: { kind: "empty" },
        current: { kind: "current", head: "aaaa1111", number: 4 },
        revision: { kind: "revision", revision: "bbbb2222", label: "#3" },
    };

    // [state, expanded, frozen] -> presence. All 24 combinations, none omitted.
    const table: [keyof typeof states, boolean, boolean, VersionRailPresence][] = [
        ["probing", false, false, "absent"],
        ["probing", false, true, "strip"],
        ["probing", true, false, "panel"],
        ["probing", true, true, "panel"],
        // An unsupported host: never a column, whatever a stale preference or a stale latch says.
        ["unavailable", false, false, "absent"],
        ["unavailable", false, true, "absent"],
        ["unavailable", true, false, "absent"],
        ["unavailable", true, true, "absent"],
        ["not-a-repository", false, false, "absent"],
        ["not-a-repository", false, true, "strip"],
        ["not-a-repository", true, false, "panel"],
        ["not-a-repository", true, true, "panel"],
        ["empty", false, false, "absent"],
        ["empty", false, true, "strip"],
        ["empty", true, false, "panel"],
        ["empty", true, true, "panel"],
        ["current", false, false, "absent"],
        ["current", false, true, "strip"],
        ["current", true, false, "panel"],
        ["current", true, true, "panel"],
        ["revision", false, false, "absent"],
        ["revision", false, true, "strip"],
        ["revision", true, false, "panel"],
        ["revision", true, true, "panel"],
    ];

    it.each(table)("%s / expanded %s / frozen %s -> %s", (stateKey, expanded, frozen, presence) => {
        expect(resolveVersionRailPresence({ state: states[stateKey], expanded, frozen })).toBe(presence);
    });

    it("contributes nothing to the dock account wherever it is absent", () => {
        for (const [stateKey, expanded, frozen, presence] of table) {
            if (presence !== "absent") continue;
            expect(versionRailWidth(resolveVersionRailPresence({ state: states[stateKey], expanded, frozen })))
                .toBe(0);
        }
    });

    it("is never dismissible into nothing while the workspace is frozen", () => {
        // The escape hatch argument: closing the panel while frozen has to leave the strip, because a
        // way out the author can hide is not a way out. Asserted over every state that can be frozen
        // at all rather than over the revision preview alone - the manual freeze is the one that would
        // otherwise leave a project silently refusing to save.
        for (const stateKey of ["probing", "not-a-repository", "empty", "current", "revision"] as const) {
            expect(resolveVersionRailPresence({ state: states[stateKey], expanded: false, frozen: true }))
                .toBe("strip");
        }
    });
});

/**
 * The commit rule, enumerated.
 *
 * Every surface state crossed with "project data is frozen" and "something is already running",
 * because this is the decision a screenshot cannot check: a form that is merely absent looks exactly
 * like a form that was never written, and the two states that MUST NOT offer it - a frozen workspace
 * and a project with no repository - are the two an author reaches by accident.
 *
 * The lines worth reading twice: `current` + frozen is **no form** (a manual freeze leaves the state
 * on `current`, and an inert Commit button on a workspace that refuses to save is the one thing
 * `freezeGuard` forbids), and `empty` + writable **does** offer one - a repository with no revisions
 * in it is exactly where a first commit belongs.
 */
describe("commit availability", () => {
    const states: Record<string, VersionSurfaceState> = {
        probing: { kind: "probing" },
        unavailable: { kind: "unavailable", reason: "unsupported-platform" },
        "not-a-repository": { kind: "not-a-repository" },
        empty: { kind: "empty" },
        current: { kind: "current", head: "aaaa1111", number: 4 },
        revision: { kind: "revision", revision: "bbbb2222", label: "#3" },
    };

    // [state, frozen, busy] -> [form present, button pressable]. All 24 combinations, none omitted.
    const table: [keyof typeof states, boolean, boolean, boolean, boolean][] = [
        ["probing", false, false, false, false],
        ["probing", false, true, false, false],
        ["probing", true, false, false, false],
        ["probing", true, true, false, false],
        ["unavailable", false, false, false, false],
        ["unavailable", false, true, false, false],
        ["unavailable", true, false, false, false],
        ["unavailable", true, true, false, false],
        // Enable is the offer here, and one panel does not get two calls to action.
        ["not-a-repository", false, false, false, false],
        ["not-a-repository", false, true, false, false],
        ["not-a-repository", true, false, false, false],
        ["not-a-repository", true, true, false, false],
        ["empty", false, false, true, true],
        ["empty", false, true, true, false],
        ["empty", true, false, false, false],
        ["empty", true, true, false, false],
        ["current", false, false, true, true],
        ["current", false, true, true, false],
        ["current", true, false, false, false],
        ["current", true, true, false, false],
        // A revision preview is read-only by construction; the way out is the button above it.
        ["revision", false, false, false, false],
        ["revision", false, true, false, false],
        ["revision", true, false, false, false],
        ["revision", true, true, false, false],
    ];

    it.each(table)(
        "%s / frozen %s / busy %s -> present %s, pressable %s",
        (stateKey, frozen, busy, present, pressable) => {
            const state = states[stateKey];
            expect(isCommitFormPresent({ state, frozen })).toBe(present);
            expect(canCommit({ state, frozen, busy })).toBe(pressable);
        },
    );

    it("never offers a commit while project data is frozen, whatever the state says", () => {
        // The `freezeGuard` rule, asserted separately from the table because it is the reason this
        // seam stayed empty until now: never offer an action the workspace cannot perform. A manual
        // freeze is the case the table alone reads as an accident - it leaves the state on `current`,
        // which is otherwise the one state where committing is the whole point.
        for (const stateKey of Object.keys(states)) {
            expect(isCommitFormPresent({ state: states[stateKey], frozen: true })).toBe(false);
            expect(canCommit({ state: states[stateKey], frozen: true, busy: false })).toBe(false);
        }
    });

    it("never lets the button outlive the form", () => {
        // Pressable implies present, over the whole table: the only thing that may separate the two
        // is `busy`. A state that answered otherwise would be a Commit the author could trigger by
        // keyboard on a panel showing no form.
        for (const [stateKey, frozen, busy, , pressable] of table) {
            if (!pressable) continue;
            expect(isCommitFormPresent({ state: states[stateKey], frozen })).toBe(true);
            expect(busy).toBe(false);
        }
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

    it("carries the message, timestamp and author through", () => {
        const flat = flattenFirstParent([
            { revision: "b", number: 2, parents: ["a"], message: "Chapter 2", timestamp: 1_700_000_000_000, author: "mei" },
            { revision: "a", number: 1, parents: [] },
        ]);
        expect(flat[0].message).toBe("Chapter 2");
        expect(flat[0].timestamp).toBe(1_700_000_000_000);
        expect(flat[0].author).toBe("mei");
    });

    it("leaves a metadata key that was never written ABSENT rather than present-and-undefined", () => {
        // `"message" in row` is the question, not `row.message === undefined`: an explicit undefined is
        // a present key, and the renderer branches on presence. The repository's first commit is
        // written by `initRepository` and carries none of the three, so this is the ordinary row.
        const [row] = flattenFirstParent([{ revision: "a", number: 1, parents: [] }]);
        expect("message" in row).toBe(false);
        expect("timestamp" in row).toBe(false);
        expect("author" in row).toBe(false);
    });

    it("keeps a partial metadata set partial", () => {
        // Another client may write any subset; a missing author must not become a blank one.
        const [row] = flattenFirstParent([{ revision: "a", number: 1, parents: [], message: "init" }]);
        expect(row.message).toBe("init");
        expect("author" in row).toBe(false);
    });
});

describe("focusedRevision / findRevisionRow", () => {
    it("focuses the previewed revision, else the head", () => {
        expect(focusedRevision({ kind: "revision", revision: "bbbb2222" })).toBe("bbbb2222");
        expect(focusedRevision({ kind: "current", head: "aaaa1111", number: 4 })).toBe("aaaa1111");
    });

    it("focuses nothing in the states that have no revision at all", () => {
        expect(focusedRevision({ kind: "empty" })).toBeNull();
        expect(focusedRevision({ kind: "not-a-repository" })).toBeNull();
        expect(focusedRevision({ kind: "probing" })).toBeNull();
        expect(focusedRevision({ kind: "unavailable", reason: "backend-missing" })).toBeNull();
    });

    it("finds the focused row, and answers null rather than throwing when the page does not reach it", () => {
        const rows = flattenFirstParent([entry(2, "b", ["a"]), entry(1, "a")]);
        expect(findRevisionRow(rows, "a")?.number).toBe(1);
        // Both real: nothing has been read until the panel is opened, and the page is bounded.
        expect(findRevisionRow(rows, "zzz")).toBeNull();
        expect(findRevisionRow(null, "a")).toBeNull();
        expect(findRevisionRow(rows, null)).toBeNull();
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
