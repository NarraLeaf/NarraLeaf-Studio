import { describe, expect, it, vi } from "vitest";
import type { MediaConvertRequest, MediaConvertStateSnapshot } from "@shared/types/mediaConvert";
import { runMediaConversion, type MediaConvertBridge } from "./runMediaConversion";

const REQUEST: MediaConvertRequest = {
    sourcePath: "C:/media/clip.avi",
    targetPath: "C:/project/.nlstudio/convert/run/0/clip.mp4",
    target: { kind: "remux", container: "mp4", audioOnly: false },
    durationUs: 5_000_000,
};

/** A bridge that answers `start` once and then walks the given snapshots, one per poll. */
function bridgeOver(snapshots: readonly MediaConvertStateSnapshot[]): MediaConvertBridge {
    const queue = [...snapshots];
    return {
        start: async () => queue.shift() ?? null,
        cancel: async () => undefined,
        getStatus: async () => queue.shift() ?? null,
    };
}

function hooks() {
    const fractions: (number | null)[] = [];
    return {
        fractions,
        spy: {
            onStarted: vi.fn(),
            onProgress: (fraction: number | null) => { fractions.push(fraction); },
            wait: async () => undefined,
        },
    };
}

describe("runMediaConversion", () => {
    /**
     * The measured case this whole module is shaped around: a fast remux emitted one progress block
     * at 0.72 and then exited zero. A loop that waited for the fraction to reach 1 would never stop.
     */
    it("ends on the status, not on the fraction reaching 1", async () => {
        const { spy, fractions } = hooks();
        const outcome = await runMediaConversion(REQUEST, bridgeOver([
            { jobId: "j", status: "converting" },
            {
                jobId: "j",
                status: "converting",
                progress: { outTimeUs: 3_600_000, durationUs: 5_000_000, fraction: 0.72 },
            },
            { jobId: "j", status: "done", outputPath: "C:/project/.nlstudio/convert/run/0/clip.mp4" },
        ]), spy);

        expect(outcome).toEqual({ status: "done", outputPath: "C:/project/.nlstudio/convert/run/0/clip.mp4" });
        // The last thing the caller heard was 0.72; filling the bar is the caller's job, from `done`.
        expect(fractions.at(-1)).toBe(0.72);
    });

    it("passes a missing duration through as null rather than zero", async () => {
        const { spy, fractions } = hooks();
        await runMediaConversion({ ...REQUEST, durationUs: null }, bridgeOver([
            { jobId: "j", status: "converting" },
            { jobId: "j", status: "converting", progress: { outTimeUs: 1, durationUs: null, fraction: null } },
            { jobId: "j", status: "done", outputPath: "out.png" },
        ]), spy);

        expect(fractions).toEqual([null]);
        expect(fractions).not.toContain(0);
    });

    it("hands back the job id before any polling, so a stop can reach it", async () => {
        const { spy } = hooks();
        await runMediaConversion(REQUEST, bridgeOver([
            { jobId: "job-7", status: "converting" },
            { jobId: "job-7", status: "cancelled" },
        ]), spy);

        expect(spy.onStarted).toHaveBeenCalledWith("job-7");
    });

    it("distinguishes a stop, a missing converter and a failure", async () => {
        const { spy } = hooks();
        await expect(runMediaConversion(REQUEST, bridgeOver([
            { jobId: "j", status: "converting" },
            { jobId: "j", status: "cancelled" },
        ]), spy)).resolves.toEqual({ status: "stopped" });

        await expect(runMediaConversion(REQUEST, bridgeOver([
            { jobId: "j", status: "unavailable", error: "no ffmpeg" },
        ]), spy)).resolves.toEqual({ status: "unavailable", detail: "no ffmpeg" });

        await expect(runMediaConversion(REQUEST, bridgeOver([
            { jobId: "j", status: "converting" },
            { jobId: "j", status: "error", error: "ffmpeg exited with 1" },
        ]), spy)).resolves.toEqual({ status: "failed", detail: "ffmpeg exited with 1" });
    });

    /** `done` without an output path is a contradiction; treating it as success would import nothing. */
    it("refuses to report success without a file", async () => {
        const { spy } = hooks();
        await expect(runMediaConversion(REQUEST, bridgeOver([
            { jobId: "j", status: "done" },
        ]), spy)).resolves.toEqual({ status: "failed", detail: undefined });
    });

    it("treats an IPC failure as a failed conversion rather than throwing into the dialog", async () => {
        const { spy } = hooks();
        await expect(runMediaConversion(REQUEST, {
            start: async () => { throw new Error("bridge gone"); },
            cancel: async () => undefined,
            getStatus: async () => null,
        }, spy)).resolves.toEqual({ status: "failed" });
    });
});
