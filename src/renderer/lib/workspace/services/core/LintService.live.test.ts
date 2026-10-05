import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LintContext } from "@/lib/lint/context";
import type { LintRunOptions } from "@/lib/lint/engine";
import type { LintReport } from "@/lib/lint/types";
import { LIVE_LINT_MIN_QUIET_MS } from "@/lib/lint/liveScheduler";
import { Services, type WorkspaceContext } from "../services";
import { LintService } from "./LintService";

/**
 * The background half of `LintService`: the sweeps that keep the Problems panel current, and how a
 * sweep somebody asked for takes the floor from them.
 *
 * The engine is replaced with a recorder that can be held open, because what is under test is the
 * order of events - which sweep ran, which one was abandoned, whose report was published - and not
 * what the rules found.
 */

const engine = vi.hoisted(() => {
    type Call = { options: LintRunOptions; finish: (report?: Partial<LintReport>) => void };
    const calls: Call[] = [];
    let hold = false;
    return {
        calls,
        setHold: (value: boolean) => {
            hold = value;
        },
        run: (_ctx: unknown, options: LintRunOptions = {}): Promise<LintReport> => {
            const base: LintReport = {
                startedAt: 0,
                finishedAt: 0,
                entries: [],
                counts: { error: 0, warning: 0, info: 0 },
                rulesRun: [],
                skipped: [],
            };
            if (!hold) {
                calls.push({ options, finish: () => undefined });
                return Promise.resolve(base);
            }
            return new Promise(resolve => {
                calls.push({ options, finish: report => resolve({ ...base, ...report }) });
            });
        },
    };
});

vi.mock("@/lib/lint/engine", () => ({ runLintRules: engine.run }));

/** Every change source the service watches, so a test can announce an edit through any of them. */
function changeSources() {
    const listeners = new Map<string, Set<() => void>>();
    const on = (name: string) => (handler: () => void) => {
        const set = listeners.get(name) ?? new Set();
        set.add(handler);
        listeners.set(name, set);
        return () => set.delete(handler);
    };
    return {
        listeners,
        emit: (name: string) => {
            for (const handler of listeners.get(name) ?? []) {
                handler();
            }
        },
        on,
    };
}

function mount() {
    const sources = changeSources();
    const consoleLines: string[] = [];
    const ctx = {
        project: { resolve: (...parts: string[]) => parts.join("/") },
        services: {
            get: (id: Services) => {
                switch (id) {
                    case Services.Console:
                        return {
                            setProgress: () => undefined,
                            append: (_channel: string, line: { message: string }) => consoleLines.push(line.message),
                        };
                    case Services.Story:
                        return {
                            onDocumentChanged: sources.on("story"),
                            onLibraryChanged: sources.on("library"),
                            onAnimationsChanged: sources.on("animations"),
                        };
                    case Services.UIDocument:
                        return { onDocumentChanged: sources.on("uidoc") };
                    case Services.UIGraph:
                        return { onGraphsChanged: sources.on("graphs") };
                    case Services.Project:
                        return { onConfigChanged: sources.on("config") };
                    case Services.Reference:
                        return { onIndexChanged: sources.on("references") };
                    default:
                        // Every other source is attempted on its own; one that is missing costs only
                        // itself, which is also what this exercises.
                        throw new Error(`no ${String(id)} in this harness`);
                }
            },
        },
    } as unknown as WorkspaceContext;

    const service = new LintService();
    service.setContext(ctx);
    vi.spyOn(service as unknown as { assembleContext: () => Promise<unknown> }, "assembleContext").mockResolvedValue({
        ctx: {} as LintContext,
        contextFindings: [],
    });
    return { service, sources, consoleLines };
}

async function settle(): Promise<void> {
    for (let i = 0; i < 10; i++) {
        await Promise.resolve();
    }
}

beforeEach(() => {
    vi.useFakeTimers();
    engine.calls.length = 0;
    engine.setHold(false);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe("LintService live sweeps", () => {
    it("sweeps as soon as it starts, and silently", async () => {
        const { service, consoleLines } = mount();
        const reports: Array<LintReport | null> = [];
        service.onReportChanged(report => reports.push(report));

        service.startLive();
        await vi.advanceTimersByTimeAsync(0);
        await settle();

        expect(engine.calls).toHaveLength(1);
        expect(reports).toHaveLength(1);
        // A background sweep runs after every pause in editing; it writes nothing to the console.
        expect(consoleLines).toEqual([]);
        expect(service.getState()).toMatchObject({ live: true, pending: false, requestedRunning: false });
    });

    it("sweeps again after an edit, once the project has been left alone", async () => {
        const { service, sources } = mount();
        service.startLive();
        await vi.advanceTimersByTimeAsync(0);
        await settle();
        expect(engine.calls).toHaveLength(1);

        sources.emit("story");
        sources.emit("graphs");
        expect(service.getState().pending).toBe(true);
        await vi.advanceTimersByTimeAsync(LIVE_LINT_MIN_QUIET_MS - 1);
        expect(engine.calls).toHaveLength(1);
        await vi.advanceTimersByTimeAsync(1);
        await settle();
        expect(engine.calls).toHaveLength(2);
        expect(service.getState().pending).toBe(false);
    });

    it("abandons a background sweep for a requested one, and publishes only the requested report", async () => {
        const { service, consoleLines } = mount();
        const reports: Array<LintReport | null> = [];
        service.onReportChanged(report => reports.push(report));
        engine.setHold(true);

        service.startLive();
        await vi.advanceTimersByTimeAsync(0);
        await settle();
        expect(engine.calls).toHaveLength(1);
        const live = engine.calls[0];

        const requested = service.run();
        await settle();
        expect(live.options.signal?.aborted).toBe(true);
        expect(service.getState().requestedRunning).toBe(true);

        // The abandoned sweep comes back; what it found is older than what is about to be read.
        live.finish({ counts: { error: 9, warning: 0, info: 0 } });
        await settle();
        expect(engine.calls).toHaveLength(2);
        engine.calls[1].finish({ counts: { error: 1, warning: 0, info: 0 } });
        const report = await requested;

        expect(report.counts.error).toBe(1);
        expect(reports.map(entry => entry?.counts.error)).toEqual([1]);
        // A requested sweep says it ran.
        expect(consoleLines.length).toBeGreaterThan(0);
        expect(service.getState().requestedRunning).toBe(false);
    });

    it("joins a second request to the sweep already running", async () => {
        const { service } = mount();
        engine.setHold(true);
        const first = service.run();
        const second = service.run();
        expect(second).toBe(first);
        await settle();
        engine.calls[0].finish();
        await first;
        expect(engine.calls).toHaveLength(1);
    });

    it("stops watching the project when the last holder lets go", async () => {
        const { service, sources } = mount();
        const releaseA = service.startLive();
        const releaseB = service.startLive();
        await vi.advanceTimersByTimeAsync(0);
        await settle();

        releaseA();
        expect(service.getState().live).toBe(true);
        releaseB();
        expect(service.getState().live).toBe(false);
        expect([...sources.listeners.values()].every(set => set.size === 0)).toBe(true);

        sources.emit("story");
        await vi.advanceTimersByTimeAsync(10_000);
        expect(engine.calls).toHaveLength(1);
    });
});
