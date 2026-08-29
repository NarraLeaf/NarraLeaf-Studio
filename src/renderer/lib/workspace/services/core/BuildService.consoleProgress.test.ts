import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GameBuildStateSnapshot } from "@shared/types/gameBuild";
import type { ConsoleProgressInput } from "./ConsoleService";
import { Services, type WorkspaceContext } from "../services";
import { BuildService } from "./BuildService";

/**
 * What the console's progress bar is told while a build runs.
 *
 * The rule this file exists to hold: the bar is determinate exactly where a step of the build
 * counted itself, and animates everywhere else. Most of a build is everywhere else - handing
 * electron-builder a target reports nothing at all until it comes back - and a bar that filled
 * across that stretch would be describing a guess.
 */

const gameBuild = vi.hoisted(() => ({
    getStatus: vi.fn(async () => ({ success: false })),
    start: vi.fn(),
    cancel: vi.fn(),
    exportPatch: vi.fn(),
    preflight: vi.fn(),
}));

vi.mock("@/lib/app/bridge", () => ({
    getInterface: () => ({ gameBuild }),
}));

vi.mock("@/lib/i18n", () => ({
    translate: (key: string) => key,
    translateN: (key: string) => key,
}));

const PROJECT_PATH = "D:/projects/demo";

function mount() {
    const updates: (ConsoleProgressInput | null)[] = [];
    let current: ConsoleProgressInput | null = null;

    const ctx = {
        project: { getConfig: () => ({ projectPath: PROJECT_PATH }) },
        services: {
            get: (id: Services) => {
                if (id === Services.Console) {
                    return {
                        log: () => undefined,
                        setProgress: (_channel: string, input: ConsoleProgressInput | null) => {
                            updates.push(input);
                            current = input;
                        },
                        getProgress: () => current,
                    };
                }
                throw new Error(`Unexpected service lookup: ${id}`);
            },
        },
    } as unknown as WorkspaceContext;

    const service = new BuildService();
    service.setContext(ctx);
    return { service, updates };
}

/** Feed the service one snapshot, the way its poll does. */
async function poll(service: BuildService, state: GameBuildStateSnapshot): Promise<void> {
    gameBuild.getStatus.mockResolvedValue({ success: true, data: { state } } as never);
    await service.refreshState();
}

beforeEach(() => {
    vi.useFakeTimers();
    gameBuild.getStatus.mockReset();
});

afterEach(() => {
    vi.useRealTimers();
});

describe("the build's console progress bar", () => {
    it("animates through a phase that counts nothing", async () => {
        const { service, updates } = mount();

        await poll(service, { status: "preparing", progress: null });

        expect(updates.at(-1)).toMatchObject({ indeterminate: true });
    });

    it("fills to the fraction a step reported", async () => {
        const { service, updates } = mount();

        await poll(service, { status: "compiling", progress: null });
        await poll(service, { status: "compiling", progress: { done: 3, total: 4, unit: "file" } });

        expect(updates.at(-1)).toMatchObject({ value: 0.75, indeterminate: false });
    });

    it("goes back to animating, and back to empty, when the count ends", async () => {
        const { service, updates } = mount();

        await poll(service, { status: "compiling", progress: { done: 4, total: 4, unit: "file" } });
        await poll(service, { status: "packaging", progress: null });

        // Empty as well as animated: the next countable step is a count of its own, and starting it
        // part-full would carry the last step's answer into it.
        expect(updates.at(-1)).toMatchObject({ value: 0, indeterminate: true });
    });

    it("says nothing new while a count stands still, however long the step takes", async () => {
        const { service, updates } = mount();

        await poll(service, { status: "compiling", progress: { done: 1, total: 9, unit: "file" } });
        const afterFirst = updates.length;
        await poll(service, { status: "compiling", progress: { done: 1, total: 9, unit: "file" } });
        await poll(service, { status: "compiling", progress: { done: 1, total: 9, unit: "file" } });

        expect(updates).toHaveLength(afterFirst);
    });

    it("refuses a count with no denominator rather than dividing by it", async () => {
        const { service, updates } = mount();

        await poll(service, { status: "compiling", progress: { done: 0, total: 0, unit: "file" } });

        expect(updates.at(-1)).toMatchObject({ indeterminate: true });
    });

    it("snaps to full on the status saying so, not on a counter reaching its total", async () => {
        const { service, updates } = mount();

        await poll(service, { status: "packaging", progress: { done: 2, total: 2, unit: "file" } });
        expect(updates.at(-1)).toMatchObject({ value: 1, indeterminate: false });
        // Still running: the bar is at its end because a step is, and the build is not finished
        // until it says it is.
        expect(service.getState().status).toBe("packaging");

        await poll(service, { status: "done", progress: null });
        expect(updates.at(-1)).toMatchObject({ value: 1, indeterminate: false, error: false });
    });

    it("turns the bar warning on a failure, whatever the last count said", async () => {
        const { service, updates } = mount();

        await poll(service, { status: "packaging", progress: { done: 1, total: 5, unit: "file" } });
        await poll(service, { status: "error", progress: null });

        expect(updates.at(-1)).toMatchObject({ value: 1, indeterminate: false, error: true });
    });

    it("drops the previous run's bar when a new one opens", async () => {
        const { service, updates } = mount();

        await poll(service, { status: "error", progress: null });
        await poll(service, { status: "preparing", progress: null });

        // A cleared bar first: without it the new run would inherit the warning colour of the one
        // before it, on the channel that is meant to describe this build.
        expect(updates.at(-2)).toBeNull();
        expect(updates.at(-1)).toMatchObject({ indeterminate: true });
    });
});
