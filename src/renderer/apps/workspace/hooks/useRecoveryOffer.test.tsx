// @vitest-environment jsdom
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * When the workspace offers to open itself in recovery mode, and when it must not.
 *
 * Recovery mode is for damage nobody can account for. Its first act is to freeze the project,
 * because merely opening a broken one can destroy the evidence - a corrupt asset shard is reset to
 * `{}` on the way in, and the file the author came to diagnose is gone before they have read the
 * error about it. So the offer follows the damage, not the symptom.
 *
 * A merge accounts for itself. Its conflicted files are unparseable by construction, the workspace
 * is already frozen for the reason recovery mode would freeze it, and the way out is to finish or
 * abandon the merge - which the rail is standing there offering, because a merge is one of the two
 * states that make it a persistent column. The offer would point at a door leading away from the
 * only thing that ends it.
 */

const bridge = vi.hoisted(() => ({ setRecoveryMode: vi.fn() }));
vi.mock("@/lib/app/bridge", () => ({
    getInterface: () => ({ workspace: bridge }),
}));

vi.mock("@/lib/i18n", () => ({
    translate: (key: string) => key,
}));

vi.mock("@/lib/workspace/services/core/UIService", () => ({ UIService: class {} }));
vi.mock("@/lib/workspace/services/core/VersionControlService", () => ({ VersionControlService: class {} }));
vi.mock("@/lib/workspace/services/ui/types", () => ({ NotificationType: { Error: "error" } }));

/** Whether the repository reports an unfinished merge, swapped per test. */
const merge = vi.hoisted(() => ({ open: false }));
const sticky = vi.hoisted(() => ({ show: vi.fn() }));

vi.mock("@/lib/workspace/services/services", () => ({
    Services: { UI: "ui", VersionControl: "versionControl" },
}));

vi.mock("../context", () => ({
    useWorkspace: () => ({
        recovery: false,
        context: {
            services: {
                get: (key: string) => (key === "ui"
                    ? { notifications: { showSticky: sticky.show } }
                    : { getMergeState: async () => ({ inProgress: merge.open, conflicts: [] }) }),
            },
        },
    }),
}));

/**
 * The log is a module singleton and so is the hook's once-per-window latch, so each test takes a
 * fresh copy of both. Importing them together keeps the pair matched: a hook from one module
 * generation watching a log from another observes nothing at all.
 */
async function load() {
    vi.resetModules();
    const log = await import("@/lib/workspace/recovery/anomalyLog");
    const hook = await import("./useRecoveryOffer");
    return { ...log, ...hook };
}

const DEGRADED = {
    source: "assets" as const,
    operationKey: "workspace.recovery.operations.preflight" as const,
    severity: "degraded" as const,
    error: new Error("Expected ',' or '}' at position 41"),
};

beforeEach(() => {
    merge.open = false;
    sticky.show.mockReset();
    bridge.setRecoveryMode.mockReset();
});

afterEach(cleanup);

describe("offering recovery mode", () => {
    it("offers it for damage the workspace survived", async () => {
        const { useRecoveryOffer, reportWorkspaceAnomaly } = await load();

        renderHook(() => useRecoveryOffer());
        reportWorkspaceAnomaly(DEGRADED);

        await waitFor(() => expect(sticky.show).toHaveBeenCalledTimes(1));
        expect(sticky.show.mock.calls[0]![0].message).toBe("workspace.recovery.offer.message");
    });

    it("stays silent while a merge is open", async () => {
        const { useRecoveryOffer, reportWorkspaceAnomaly } = await load();
        merge.open = true;

        renderHook(() => useRecoveryOffer());
        reportWorkspaceAnomaly(DEGRADED);

        // The conflicted files are unparseable because the merge left them that way. Recovery mode
        // is a door away from the only thing that ends it.
        await new Promise(resolve => setTimeout(resolve, 20));
        expect(sticky.show).not.toHaveBeenCalled();
        expect(bridge.setRecoveryMode).not.toHaveBeenCalled();
    });

    it("offers again once the merge is over, because silence was not the answer either", async () => {
        const { useRecoveryOffer, reportWorkspaceAnomaly } = await load();
        merge.open = true;

        renderHook(() => useRecoveryOffer());
        reportWorkspaceAnomaly(DEGRADED);
        await new Promise(resolve => setTimeout(resolve, 20));
        expect(sticky.show).not.toHaveBeenCalled();

        // The once-per-window latch must not have been spent on the silence.
        merge.open = false;
        reportWorkspaceAnomaly({ ...DEGRADED, error: new Error("a different file, after the merge") });

        await waitFor(() => expect(sticky.show).toHaveBeenCalledTimes(1));
    });

    it("says nothing for a failure that stopped the workspace starting, which has its own screen", async () => {
        const { useRecoveryOffer, reportWorkspaceAnomaly } = await load();

        renderHook(() => useRecoveryOffer());
        reportWorkspaceAnomaly({ ...DEGRADED, severity: "fatal" as const });

        await new Promise(resolve => setTimeout(resolve, 20));
        expect(sticky.show).not.toHaveBeenCalled();
    });
});
