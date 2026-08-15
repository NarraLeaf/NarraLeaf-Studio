import { describe, expect, it } from "vitest";
import type { VcsFileChange, VcsHistoryEntry } from "@shared/types/vcs";
import { VCS_DEFAULT_BRANCH } from "@shared/types/vcs";
import {
    composeRestoreMessage,
    VCS_CHECKPOINT_MESSAGES,
    VCS_SYSTEM_MESSAGES,
} from "@shared/vcs/systemRevisionMessage";
import { RAIL_SELECTOR_WIDTH } from "./dockLayoutModel";
import {
    MANUAL_SERVER,
    NO_SERVER,
    VERSION_BRANCH_MAX_CHARS,
    VERSION_CHANGE_LIST_LIMIT,
    VERSION_RAIL_COLLAPSED_WIDTH,
    VERSION_RAIL_EXPANDED_WIDTH,
    buildChangeList,
    canCommit,
    collapseCheckpoints,
    filterHistoryRows,
    findRevisionRow,
    historyDayKey,
    historyDayLabel,
    flattenFirstParent,
    focusedRevision,
    hasMoreHistory,
    hiddenCheckpointCount,
    historyRowHeadline,
    initialServerChoice,
    nextHistoryLimit,
    isCommitFormPresent,
    isVersionSurfaceVisible,
    resolveVersionRailPresence,
    resolveVersionSurfaceState,
    revisionLabel,
    shortRevision,
    sortFileChanges,
    splitChangePath,
    unavailableReasonKey,
    versionFace,
    versionRailWidth,
    type FlatHistoryEntry,
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

    it("is 320px as a panel", () => {
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

    /**
     * The difference between "we have not looked" and "we looked and there was nothing".
     *
     * Both used to leave the button live, and on a clean tree that meant the one button this panel
     * exists for answered with a refusal. The asymmetry is deliberate rather than tidy: looking is a
     * scan, a scan writes staged state (docs §4.17), and a button that scanned to decide whether to
     * be enabled is the thing that rule forbids.
     */
    it.each([
        [undefined, true],
        [null, true],
        [0, false],
        [1, true],
        [40, true],
    ] as const)("changedFiles %s -> pressable %s", (changedFiles, pressable) => {
        expect(canCommit({ state: states.current, frozen: false, busy: false, changedFiles }))
            .toBe(pressable);
    });

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

/**
 * The path split, which is the part a screenshot cannot check: a directory that came back with the
 * other separator renders as one long file name with no directory at all, and it looks deliberate.
 */
describe("splitChangePath", () => {
    it("gives a repository-root file no directory, rather than an empty one", () => {
        // Real and ordinary - `nl.config.json` lives at the root - and the renderer branches on null,
        // so an empty string here would draw a bare `/` in front of every root file.
        expect(splitChangePath("nl.config.json")).toEqual({ directory: null, name: "nl.config.json" });
    });

    it("splits a deep path at its LAST separator, keeping the file name whole", () => {
        expect(splitChangePath("editor/story/chapter-01.json"))
            .toEqual({ directory: "editor/story", name: "chapter-01.json" });
    });

    it("reads a backslash path, because the type does not say which separator a scan produced", () => {
        // docs §4.16 / §4.20: status answers repository-relative paths and the backend is not uniform
        // about the slash on Windows. Both are `string` and the compiler will not object either way.
        expect(splitChangePath("editor\\story\\chapter-01.json"))
            .toEqual({ directory: "editor/story", name: "chapter-01.json" });
        expect(splitChangePath("assets\\images/bg.png"))
            .toEqual({ directory: "assets/images", name: "bg.png" });
    });

    it("collapses repeated separators and ignores a trailing one", () => {
        expect(splitChangePath("assets//images/bg.png"))
            .toEqual({ directory: "assets/images", name: "bg.png" });
        expect(splitChangePath("assets/images/")).toEqual({ directory: "assets", name: "images" });
    });

    it("keeps a dotfile's name intact instead of reading the leading dot as an extension boundary", () => {
        expect(splitChangePath(".loreignore")).toEqual({ directory: null, name: ".loreignore" });
        expect(splitChangePath("project/.gitignore")).toEqual({ directory: "project", name: ".gitignore" });
    });

    it("does not care what alphabet the path is in", () => {
        expect(splitChangePath("剧本/第一章/开场.json"))
            .toEqual({ directory: "剧本/第一章", name: "开场.json" });
    });

    it("answers something renderable for the degenerate inputs rather than throwing", () => {
        expect(splitChangePath("")).toEqual({ directory: null, name: "" });
        expect(splitChangePath("/")).toEqual({ directory: null, name: "" });
    });
});

/**
 * The order and the cap.
 *
 * Both are decisions a screenshot of a short list cannot check: a conflict sorted correctly looks the
 * same as one that happened to be scanned first, and a cap that drops the wrong rows only shows itself
 * on a project big enough that nobody is reading the list row by row anyway.
 */
describe("buildChangeList", () => {
    const change = (path: string, overrides: Partial<VcsFileChange> = {}): VcsFileChange => ({
        path,
        kind: "modified",
        directory: false,
        size: 1,
        staged: false,
        dirty: true,
        conflicted: false,
        conflictUnresolved: false,
        ...overrides,
    });

    it("puts an unresolved conflict first, because it is the only change that blocks a commit", () => {
        const files = [
            change("a.json"),
            change("z.json", { conflicted: true, conflictUnresolved: true }),
            change("b.json"),
        ];
        expect(buildChangeList(files).rows.map(row => row.path)).toEqual(["z.json", "a.json", "b.json"]);
    });

    it("does not promote a conflict that is already resolved", () => {
        // `conflicted` alone still commits; only the unresolved flag stops it, so only that one earns
        // the top of the list.
        const files = [change("a.json"), change("z.json", { conflicted: true })];
        expect(buildChangeList(files).rows.map(row => row.path)).toEqual(["a.json", "z.json"]);
    });

    it("orders everything else by path, so one folder's files stay together", () => {
        const files = [
            change("editor/story/chapter-02.json"),
            change("assets/bg.png"),
            change("editor/story/chapter-01.json"),
        ];
        expect(buildChangeList(files).rows.map(row => row.path)).toEqual([
            "assets/bg.png",
            "editor/story/chapter-01.json",
            "editor/story/chapter-02.json",
        ]);
    });

    it("ignores case when ordering, and still puts the two spellings in a fixed order", () => {
        // Total, not merely case-insensitive: two paths differing only in case must not come out in
        // whatever order the scan happened to hand them over, or the list reshuffles between refreshes.
        const one = buildChangeList([change("B.json"), change("a.json"), change("b.json")]);
        const other = buildChangeList([change("b.json"), change("B.json"), change("a.json")]);
        expect(one.rows.map(row => row.path)).toEqual(other.rows.map(row => row.path));
        expect(one.rows[0].path).toBe("a.json");
    });

    it("drops directory entries, which the backend reports as changes in their own right", () => {
        // One new folder holding one file is TWO entries in a scan; the author wrote one file.
        const view = buildChangeList([
            change("assets", { directory: true, kind: "added" }),
            change("assets/bg.png", { kind: "added" }),
        ]);
        expect(view.rows.map(row => row.path)).toEqual(["assets/bg.png"]);
        expect(view.total).toBe(1);
    });

    it("caps the list and says how many rows it did not show", () => {
        const files = Array.from({ length: 130 }, (_, index) => change(`f${String(index).padStart(3, "0")}.json`));
        const view = buildChangeList(files, 50);
        expect(view.rows).toHaveLength(50);
        expect(view.hidden).toBe(80);
        expect(view.total).toBe(130);
    });

    it("sorts before capping, so the conflict can never be the row that got cut", () => {
        // The load-bearing one. Capping a scan-ordered list would hide the change that is stopping the
        // author's commit, and the panel would show a Commit button refusing with no visible cause.
        const files = [
            ...Array.from({ length: 60 }, (_, index) => change(`a${String(index).padStart(3, "0")}.json`)),
            change("zz-last.json", { conflicted: true, conflictUnresolved: true }),
        ];
        const view = buildChangeList(files, 50);
        expect(view.rows[0].path).toBe("zz-last.json");
        expect(view.hidden).toBe(11);
    });

    it("hides nothing when everything fits, so the list only ever admits a real cut", () => {
        const view = buildChangeList([change("a.json"), change("b.json")], 50);
        expect(view.hidden).toBe(0);
        expect(view.rows).toHaveLength(2);
    });

    it("counts the files it was given whether or not they all fit", () => {
        // The summary line reads `total`, and it has to keep meaning "how much changed" once the rows
        // below it stop being all of them.
        const files = Array.from({ length: 70 }, (_, index) => change(`f${index}.json`));
        expect(buildChangeList(files, 10).total).toBe(70);
    });

    it("answers an empty view for a clean tree, which is not the same as never having looked", () => {
        // Null (nobody scanned) is the caller's business; `[]` reaching here is a scan that found
        // nothing, and it must not produce a phantom row or a non-zero count.
        expect(buildChangeList([])).toEqual({ rows: [], hidden: 0, total: 0 });
    });

    it("does not mutate the snapshot it was handed", () => {
        // `status.files` is React state shared with every other reader of the surface; sorting it in
        // place would reorder a snapshot nobody asked to have reordered.
        const files = [change("z.json"), change("a.json")];
        const before = files.map(file => file.path);
        buildChangeList(files);
        sortFileChanges(files);
        expect(files.map(file => file.path)).toEqual(before);
    });

    it("defaults to a bound that is positive and finite", () => {
        // A cap that fell to zero or NaN would render an empty list on a dirty tree and read as clean.
        expect(Number.isInteger(VERSION_CHANGE_LIST_LIMIT)).toBe(true);
        expect(VERSION_CHANGE_LIST_LIMIT).toBeGreaterThan(0);
        expect(buildChangeList([change("a.json")]).rows).toHaveLength(1);
    });
});

/**
 * The paging judgement, which is the one thing in this feature that is easy to get quietly wrong.
 *
 * "Is there more history" is answered from the RAW entry count, never from the rows on screen, and
 * the two are nowhere near each other: a read of fifty entries can draw three rows. Getting it
 * backwards does not look like a bug - it looks like a project that ends where it does not, and the
 * author has no way to tell it is lying.
 */
describe("hasMoreHistory", () => {
    it("offers more when the read filled its limit", () => {
        expect(hasMoreHistory({ limit: 50, received: 50 })).toBe(true);
    });

    it("stops when the read came back short, which is how a history ends", () => {
        expect(hasMoreHistory({ limit: 50, received: 37 })).toBe(false);
    });

    it("stops on an empty read", () => {
        expect(hasMoreHistory({ limit: 50, received: 0 })).toBe(false);
    });

    it("stops when the read asked for everything, because there is no 'more' than all", () => {
        // 0 is `VersionControlService.getHistory`'s "all of them", so a full answer is the whole
        // history and a `received >= limit` comparison against it would be true forever.
        expect(hasMoreHistory({ limit: 0, received: 0 })).toBe(false);
        expect(hasMoreHistory({ limit: 0, received: 400 })).toBe(false);
    });

    it("keeps offering when a full page of entries collapses to three rows", () => {
        // The regression this predicate exists for. Fifty revisions, forty-seven of them the
        // 15-minute timer's - which is an ORDINARY writing day, not a corner case. The rail draws
        // three rows; counting them would tell the author their project starts here while hundreds
        // of revisions sit unread behind it.
        const page: VcsHistoryEntry[] = [];
        for (let number = 50; number >= 1; number--) {
            const parents = number > 1 ? [`r${number - 1}`] : [];
            // Three real commits, at the top, the middle and the bottom of the page.
            const kind = number === 50 || number === 25 || number === 1 ? "commit" : "checkpoint";
            page.push(entry(number, `r${number}`, parents, kind));
        }

        const rows = collapseCheckpoints(flattenFirstParent(page));
        expect(page).toHaveLength(50);
        expect(rows).toHaveLength(3);
        expect(hasMoreHistory({ limit: 50, received: page.length })).toBe(true);
    });

    it("keeps offering when the first-parent walk drops most of the page", () => {
        // The other half of the same trap, and it does not need checkpoints at all: everything
        // reachable only through a second parent is dropped by `flattenFirstParent`, so a page full
        // of a merged-in branch's revisions walks to three rows with no collapse involved.
        const page: VcsHistoryEntry[] = [
            entry(50, "c", ["b", "s48"]),
            entry(49, "b", ["a"]),
            entry(1, "a"),
        ];
        for (let number = 48; number >= 2; number--) {
            page.push(entry(number, `s${number}`, [number > 2 ? `s${number - 1}` : "a"]));
        }

        expect(page).toHaveLength(50);
        expect(flattenFirstParent(page)).toHaveLength(3);
        expect(hasMoreHistory({ limit: 50, received: page.length })).toBe(true);
    });

    it("does not go quiet if a read answers with more than was asked for", () => {
        // A limit is a ceiling the backend honours, not a promise it makes. Being wrong in this
        // direction would hide the way further back outright, so the comparison is >= not ===.
        expect(hasMoreHistory({ limit: 50, received: 51 })).toBe(true);
    });
});

describe("nextHistoryLimit", () => {
    it("grows by a whole step each time", () => {
        expect(nextHistoryLimit(50, 50)).toBe(100);
        expect(nextHistoryLimit(100, 50)).toBe(150);
    });

    it("grows from the limit that was requested, not from what came back", () => {
        // The caller passes the REQUESTED limit. Feeding a short answer's length in here instead
        // would make the window shrink on the very press meant to widen it - which is why the
        // surface keeps the two numbers side by side rather than deriving one from the rows.
        expect(nextHistoryLimit(150, 50)).toBe(200);
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

/**
 * What a history row leads with.
 *
 * The list used to draw an icon, `#12` and a short hash and nothing else, which made every row of a
 * day's work look the same. The message was already on the entry; this is the decision to use it,
 * and the decision about what to say when there is none.
 */
describe("historyRowHeadline", () => {
    /**
     * A translator that answers with the key, so an assertion names the string it expects rather
     * than a sentence that would have to be updated whenever the English is reworded.
     */
    const t = ((key: string, params?: Record<string, string>) => (
        params ? `${key}(${Object.values(params).join(",")})` : key
    )) as unknown as Parameters<typeof historyRowHeadline>[1];

    it("leads with the version's message", () => {
        expect(historyRowHeadline({ revision: "a91f3c8d2e4b6", message: "Chapter 2 opening" }, t))
            .toEqual({ text: "Chapter 2 opening", isIdentity: false, original: null });
    });

    it("names itself with its hash when the revision carries no message", () => {
        // The repository's own first commit, written by `initRepository`, carries none of the three
        // metadata fields - so this is the ordinary case rather than a defensive branch.
        expect(historyRowHeadline({ revision: "a91f3c8d2e4b6" }, t))
            .toEqual({ text: "a91f3c8", isIdentity: true, original: null });
    });

    it("treats a whitespace-only message as none, rather than drawing a blank row", () => {
        expect(historyRowHeadline({ revision: "a91f3c8d2e4b6", message: "   \n " }, t))
            .toEqual({ text: "a91f3c8", isIdentity: true, original: null });
    });

    it("keeps the whole message: the row truncates in CSS, and the title attribute needs all of it", () => {
        const long = "Rewrote the confession scene so it lands before the train leaves";
        expect(historyRowHeadline({ revision: "abc1234567", message: long }, t).text).toBe(long);
    });

    /**
     * The half of the history an author did not write.
     *
     * Every sentence Studio records itself has to come back through a key, or a reader whose Studio
     * is in Chinese sees an English line in a Chinese list - which is what shipped. The whole table
     * is walked rather than sampled: one unrecognised constant is one row that silently reverts, and
     * nothing else in the app would notice. `Create project` is in the table precisely because it
     * was missed the first time round, and only turned up in a real project's history.
     */
    it.each(VCS_SYSTEM_MESSAGES)("reads %s back through %s", (message, key) => {
        const headline = historyRowHeadline({ revision: "a91f3c8d2e4b6", message }, t);
        expect(headline.isIdentity).toBe(false);
        expect(headline.text).toBe(key);
        // The stored bytes stay reachable: they are what a collaborator's client shows.
        expect(headline.original).toBe(message);
    });

    it("has a distinct key for every sentence, so two of them cannot render alike", () => {
        const keys = VCS_SYSTEM_MESSAGES.map(([, key]) => key);
        expect(new Set(keys).size).toBe(keys.length);
        const messages = VCS_SYSTEM_MESSAGES.map(([message]) => message);
        expect(new Set(messages).size).toBe(messages.length);
    });

    it("keeps the version a restore went back to, which is a number rather than language", () => {
        expect(historyRowHeadline({ revision: "a91f3c8d2e4b6", message: composeRestoreMessage("#19") }, t))
            .toEqual({
                text: "workspace.shell.versionControl.systemMessage.restored(#19)",
                isIdentity: false,
                original: "Restore version #19",
            });
    });

    it("leaves an author's own words alone, even when they start like one of ours", () => {
        // Matched exactly rather than by prefix, so someone who names a version after the demo they
        // were about to record keeps the sentence they typed.
        const own = "Checkpoint before the demo";
        expect(historyRowHeadline({ revision: "a91f3c8d2e4b6", message: own }, t))
            .toEqual({ text: own, isIdentity: false, original: null });
    });
});

/**
 * Narrowing a list an author cannot otherwise search.
 *
 * The history is paged and the backend has no cursor verb, so this only ever narrows what has been
 * read - which is why the surface says so and why "Show older versions" stays. What is asserted here
 * is the matching itself, and in particular that it matches what a reader SEES: with the rail in
 * Chinese a checkpoint reads 「检查点」 while its bytes say `Checkpoint`, and a filter that only knew
 * the bytes would find nothing for the word on screen.
 */
describe("filterHistoryRows", () => {
    const t = ((key: string, params?: Record<string, string>) => {
        if (key === "workspace.shell.versionControl.systemMessage.checkpoint") return "检查点";
        return params ? `${key}(${Object.values(params).join(",")})` : key;
    }) as unknown as Parameters<typeof filterHistoryRows>[2];

    const rows: FlatHistoryEntry[] = [
        { revision: "aaa1111", number: 25, message: "Chapter 2 opening", author: "Aria", merge: false },
        { revision: "bbb2222", number: 24, message: VCS_CHECKPOINT_MESSAGES.interval, author: "Aria", merge: false },
        { revision: "ccc3333", number: 3, message: "Rewrote the confession", author: "Kai", merge: false },
    ];

    it("returns everything for an empty query, including one that is only spaces", () => {
        expect(filterHistoryRows(rows, "", t)).toHaveLength(3);
        expect(filterHistoryRows(rows, "   ", t)).toHaveLength(3);
    });

    it("matches the message, case-insensitively", () => {
        expect(filterHistoryRows(rows, "chapter", t).map(row => row.revision)).toEqual(["aaa1111"]);
    });

    it("matches the author", () => {
        expect(filterHistoryRows(rows, "kai", t).map(row => row.revision)).toEqual(["ccc3333"]);
    });

    it("matches the number, with or without the hash the row prints", () => {
        expect(filterHistoryRows(rows, "#25", t).map(row => row.revision)).toEqual(["aaa1111"]);
        expect(filterHistoryRows(rows, "3", t).map(row => row.revision)).toEqual(["ccc3333"]);
    });

    it("matches what the row SHOWS, not only what it stores", () => {
        // The reader is looking at 「检查点」. Typing it has to find the row whose stored message is
        // the English sentence Studio wrote.
        expect(filterHistoryRows(rows, "检查点", t).map(row => row.revision)).toEqual(["bbb2222"]);
        // And the stored bytes still match, because that is what a collaborator's client shows and
        // what the author's `lore` CLI prints.
        expect(filterHistoryRows(rows, "checkpoint", t).map(row => row.revision)).toEqual(["bbb2222"]);
    });

    it("answers with an empty list rather than everything when nothing matches", () => {
        expect(filterHistoryRows(rows, "zzzz", t)).toEqual([]);
    });
});

/**
 * The day a version belongs to.
 *
 * `now` is injected precisely so this is assertable: "today" is the only interesting thing the
 * function does, and it is also the thing that only misbehaves for the few minutes either side of
 * midnight - which nobody is awake to notice and no screenshot records.
 */
describe("history day separators", () => {
    const t = ((key: string) => key) as unknown as Parameters<typeof historyDayLabel>[2];
    const at = (year: number, month: number, day: number, hour = 12) =>
        new Date(year, month, day, hour).getTime();

    it("groups by LOCAL day, so an evening's work does not file itself under tomorrow", () => {
        expect(historyDayKey(at(2026, 7, 11, 23))).toBe(historyDayKey(at(2026, 7, 11, 1)));
        expect(historyDayKey(at(2026, 7, 12, 0))).not.toBe(historyDayKey(at(2026, 7, 11, 23)));
    });

    it("names the two nearest days and dates the rest", () => {
        const now = at(2026, 7, 12);
        expect(historyDayLabel(at(2026, 7, 12, 9), "en", t, now))
            .toBe("workspace.shell.versionControl.today");
        expect(historyDayLabel(at(2026, 7, 11, 9), "en", t, now))
            .toBe("workspace.shell.versionControl.yesterday");
        expect(historyDayLabel(at(2026, 7, 4), "en", t, now)).toBe("August 4");
    });

    it("adds the year only once it stops being this one", () => {
        const now = at(2026, 7, 12);
        expect(historyDayLabel(at(2025, 10, 2), "en", t, now)).toBe("November 2, 2025");
    });

    it("is right across a month boundary, where subtracting a day is the easy thing to get wrong", () => {
        const now = at(2026, 8, 1);
        expect(historyDayLabel(at(2026, 7, 31, 20), "en", t, now))
            .toBe("workspace.shell.versionControl.yesterday");
    });
});

/**
 * The one line the status-bar cell, the switcher menu and the rail's focused block all show.
 *
 * Exhaustive over the six surface states crossed with the branch cases, because this is precisely
 * the kind of judgement a screenshot cannot audit: on the default branch the answer is supposed to
 * be INDISTINGUISHABLE from what shipped before, and "indistinguishable" is not something anyone
 * verifies by looking. The whole point of the feature - a branch name appearing where it matters and
 * nowhere else - is one boolean away from being either useless or noise on every install.
 *
 * `t` is the identity function, so a prose answer asserts as its own key.
 */
describe("versionFace", () => {
    const t = ((key: string) => key) as unknown as Parameters<typeof versionFace>[1];

    const states: Record<string, VersionSurfaceState> = {
        probing: { kind: "probing" },
        unavailable: { kind: "unavailable", reason: "unsupported-platform" },
        "not-a-repository": { kind: "not-a-repository" },
        empty: { kind: "empty" },
        current: { kind: "current", head: "aaaa1111cccc", number: 12 },
        revision: { kind: "revision", revision: "bbbb2222dddd", label: "#3" },
    };

    // [state, branch] -> text. Every state against: the default branch, no branch reported at all,
    // and a branch the author made. None omitted.
    const table: [keyof typeof states, string | null, string][] = [
        ["probing", VCS_DEFAULT_BRANCH, "—"],
        ["probing", null, "—"],
        ["probing", "audio", "—"],
        ["unavailable", VCS_DEFAULT_BRANCH, "—"],
        ["unavailable", null, "—"],
        ["unavailable", "audio", "—"],
        // The two prose states name a repository, not a branch. A branch prefix on "no versions
        // yet" would read as if the emptiness were local to that branch.
        ["not-a-repository", VCS_DEFAULT_BRANCH, "workspace.shell.versionControl.notVersioned"],
        ["not-a-repository", null, "workspace.shell.versionControl.notVersioned"],
        ["not-a-repository", "audio", "workspace.shell.versionControl.notVersioned"],
        ["empty", VCS_DEFAULT_BRANCH, "workspace.shell.versionControl.noHistory"],
        ["empty", null, "workspace.shell.versionControl.noHistory"],
        ["empty", "audio", "workspace.shell.versionControl.noHistory"],
        // The default branch and a backend that did not say are treated alike: neither is worth
        // any width, and this row is what stops the ordinary install from paying for the feature.
        ["current", VCS_DEFAULT_BRANCH, "#12"],
        ["current", null, "#12"],
        ["current", "", "#12"],
        ["current", "audio", "audio · #12"],
        ["revision", VCS_DEFAULT_BRANCH, "#3"],
        ["revision", null, "#3"],
        ["revision", "audio", "audio · #3"],
    ];

    it.each(table)("%s on branch %s reads as %s", (kind, branch, expected) => {
        expect(versionFace({ state: states[kind], branch }, t).text).toBe(expected);
    });

    it("shows the short hash when nothing knows the number, and the rail omits it instead", () => {
        const state: VersionSurfaceState = { kind: "current", head: "aaaa1111cccc", number: null };
        // The two narrow surfaces have nothing else to print, so something that identifies the
        // revision beats nothing.
        expect(versionFace({ state, branch: "audio" }, t).text).toBe("audio · aaaa111");
        // The rail prints the hash on its own line right beside this one; printing it twice would
        // be the only surface where the shared rule made things worse.
        expect(versionFace({ state, branch: "audio", unnumbered: "omit" }, t).text).toBe("");
        // And with nothing to name, the branch goes too - a bare branch name is not a version.
        expect(versionFace({ state, branch: "audio", unnumbered: "omit" }, t).full).toBe("");
    });

    it("falls back to the focused history row when the state carries no number", () => {
        const state: VersionSurfaceState = { kind: "revision", revision: "bbbb2222dddd" };
        expect(versionFace({ state, rowNumber: 7 }, t).text).toBe("#7");
        expect(versionFace({ state, rowNumber: 7, unnumbered: "omit" }, t).text).toBe("#7");
    });

    it("cuts the branch and never the version number, and keeps the whole line for the tooltip", () => {
        const state = states.current;
        const long = "feature/rewrite-the-prologue";
        const face = versionFace({ state, branch: long }, t);
        // The cut lands on the branch: `#12` is the part that says WHICH version, and a status bar
        // that truncated from the end would drop exactly that.
        expect(face.text).toBe(`${long.slice(0, VERSION_BRANCH_MAX_CHARS - 1)}… · #12`);
        expect(face.text).toContain("#12");
        expect(face.full).toBe(`${long} · #12`);
        expect(face.text).not.toBe(face.full);
    });

    it("reports nothing was cut, so a surface knows when no tooltip is owed", () => {
        const face = versionFace({ state: states.current, branch: "audio" }, t);
        expect(face.full).toBe(face.text);
    });

    it("ignores surrounding whitespace rather than rendering an empty branch", () => {
        expect(versionFace({ state: states.current, branch: "   " }, t).text).toBe("#12");
        expect(versionFace({ state: states.current, branch: " audio " }, t).text).toBe("audio · #12");
        // Including on the default branch, which a backend could report padded.
        expect(versionFace({ state: states.current, branch: ` ${VCS_DEFAULT_BRANCH} ` }, t).text).toBe("#12");
    });
});

describe("which server the connect dialog opens on", () => {
    const servers = [{ remoteOrigin: "lore://one.example.lan:41337" }, { remoteOrigin: "lore://two.example.lan:41337" }];

    it("opens on the server this project already uses", () => {
        // The remote a connected project carries: the origin with the name it has there on
        // the end of it. Matched on the origin, or a project that is plainly connected opens
        // as though this installation had never heard of its server.
        expect(initialServerChoice(servers, "lore://two.example.lan:41337/my-game"))
            .toBe("lore://two.example.lan:41337");
    });

    it("opens on that server for a remote with no name on it", () => {
        expect(initialServerChoice(servers, "lore://two.example.lan:41337")).toBe("lore://two.example.lan:41337");
    });

    it("opens on nothing for a project with no server", () => {
        // Not on the first server in the list: the dialog decides where work is sent, and
        // a preselected destination nobody named is one press away from being used.
        expect(initialServerChoice(servers, null)).toBe(NO_SERVER);
        expect(initialServerChoice(servers, "   ")).toBe(NO_SERVER);
    });

    it("opens on the address field where the project's server is not one of these", () => {
        // A bare loreserver, which nobody signs in to and which is therefore in no list. The
        // address field is the only place its address can be read or written.
        expect(initialServerChoice(servers, "lore://plain.example.lan:41337/my-game")).toBe(MANUAL_SERVER);
    });

    it("opens on nothing when no server has been added", () => {
        expect(initialServerChoice([], null)).toBe(NO_SERVER);
    });
});
