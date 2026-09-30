/**
 * A reading of the game's processes, built from Electron's process list.
 *
 * Pinned: the units (Electron reports kilobytes, the reading is bytes), what each process is called,
 * which one is the asking page, that Windows-only fields are absent rather than zero elsewhere, and
 * that Dev Mode's narrowing to one window counts that window and nothing else.
 *
 * Comments in English per project convention.
 */
import { describe, expect, it } from "vitest";
import { summarizeGameProcessMemory, type GameProcessMetricInput } from "./gameProcessMemory";

const METRICS: GameProcessMetricInput[] = [
    { pid: 10, type: "Browser", memory: { workingSetSize: 90_000, peakWorkingSetSize: 120_000, privateBytes: 60_000 } },
    { pid: 11, type: "GPU", memory: { workingSetSize: 150_000, peakWorkingSetSize: 180_000, privateBytes: 100_000 } },
    { pid: 12, type: "Tab", memory: { workingSetSize: 300_000, peakWorkingSetSize: 350_000, privateBytes: 250_000 } },
    { pid: 13, type: "Utility", serviceName: "network.mojom.NetworkService", name: "Network Service", memory: { workingSetSize: 20_000, peakWorkingSetSize: 25_000, privateBytes: 10_000 } },
    { pid: 14, type: "Zygote", memory: { workingSetSize: 1_000, peakWorkingSetSize: 1_000, privateBytes: 500 } },
];

describe("a reading of the whole game", () => {
    it("counts every process, in bytes, and marks the asking page's own", () => {
        const reading = summarizeGameProcessMemory(METRICS, { currentPid: 12 });

        expect(reading.scope).toBe("game");
        expect(reading.processes.map(process => process.kind)).toEqual(["main", "gpu", "renderer", "utility", "other"]);
        expect(reading.processes.map(process => process.current)).toEqual([false, false, true, false, false]);
        expect(reading.processes[2]).toEqual({
            kind: "renderer",
            current: true,
            workingSetBytes: 300_000 * 1024,
            peakWorkingSetBytes: 350_000 * 1024,
            privateBytes: 250_000 * 1024,
        });
        expect(reading.workingSetBytes).toBe((90_000 + 150_000 + 300_000 + 20_000 + 1_000) * 1024);
        expect(reading.privateBytes).toBe((60_000 + 100_000 + 250_000 + 10_000 + 500) * 1024);
    });

    it("names a utility process the way the platform does", () => {
        const reading = summarizeGameProcessMemory(METRICS, { currentPid: null });

        expect(reading.processes[3].name).toBe("Network Service");
        expect(reading.processes[0].name).toBeUndefined();
    });

    it("leaves out what the platform does not report, rather than calling it zero", () => {
        const reading = summarizeGameProcessMemory(
            [{ pid: 1, type: "Browser", memory: { workingSetSize: 10, peakWorkingSetSize: 12 } }],
            { currentPid: null },
        );

        expect(reading.processes[0]).not.toHaveProperty("privateBytes");
        expect(reading.privateBytes).toBeNull();
    });

    it("carries nothing a reading does not need: no pid, no path, no command line", () => {
        const reading = summarizeGameProcessMemory(METRICS, { currentPid: 12 });
        const allowed = new Set(["current", "kind", "name", "peakWorkingSetBytes", "privateBytes", "workingSetBytes"]);

        for (const process of reading.processes) {
            expect(Object.keys(process).filter(key => !allowed.has(key))).toEqual([]);
        }
        expect(Object.keys(reading).sort()).toEqual(["privateBytes", "processes", "scope", "workingSetBytes"]);
    });
});

describe("a Dev Mode window's reading", () => {
    it("is that window's renderer and nothing else, because the rest is Studio", () => {
        const reading = summarizeGameProcessMemory(METRICS, { currentPid: 12, onlyPid: 12 });

        expect(reading.scope).toBe("window");
        expect(reading.processes).toHaveLength(1);
        expect(reading.processes[0]).toMatchObject({ kind: "renderer", current: true });
        expect(reading.workingSetBytes).toBe(300_000 * 1024);
    });

    it("is empty rather than wrong when the window's process is not in the list", () => {
        const reading = summarizeGameProcessMemory(METRICS, { currentPid: 99, onlyPid: 99 });

        expect(reading).toEqual({ scope: "window", processes: [], workingSetBytes: 0, privateBytes: null });
    });
});
