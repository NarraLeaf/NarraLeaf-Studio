import { describe, expect, it } from "vitest";
import { DownloadTaskBridge } from "./downloadTasks";
import { StudioTaskScheduler } from "./StudioTaskScheduler";

describe("DownloadTaskBridge", () => {
    it("shows a transfer another process is running, from start to end", async () => {
        const scheduler = new StudioTaskScheduler();
        const bridge = new DownloadTaskBridge(scheduler, "build-1");

        bridge.accept({ phase: "start", id: "dist", kind: "toolchainDownload" });
        await Promise.resolve();
        expect(scheduler.getOverview().active?.kind).toBe("toolchainDownload");

        bridge.accept({ phase: "advance", id: "dist", done: 3, total: 12 });
        expect(scheduler.getOverview().active?.progress).toEqual({ done: 3, total: 12, unit: "byte" });

        bridge.accept({ phase: "end", id: "dist" });
        await Promise.resolve();
        expect(scheduler.getOverview().active).toBeNull();
    });

    it("stays silent about a fraction when the server did not say how many bytes are coming", async () => {
        const scheduler = new StudioTaskScheduler();
        const bridge = new DownloadTaskBridge(scheduler, "build-1");

        bridge.accept({ phase: "start", id: "dist", kind: "toolchainDownload" });
        await Promise.resolve();
        bridge.accept({ phase: "advance", id: "dist", done: 4096, total: null });

        // A spinner, not a bar filled against a number nobody has.
        expect(scheduler.getOverview().active?.progress).toBeNull();
        bridge.accept({ phase: "end", id: "dist" });
    });

    it("closes what is still open when the thing it was watching goes away", async () => {
        const scheduler = new StudioTaskScheduler();
        const bridge = new DownloadTaskBridge(scheduler, "build-1");

        bridge.accept({ phase: "start", id: "dist", kind: "toolchainDownload" });
        bridge.accept({ phase: "start", id: "nsis", kind: "toolchainDownload" });
        await Promise.resolve();

        // A killed worker sends no closing event; without this the strip would claim a download for
        // the life of the app.
        bridge.endAll();
        await Promise.resolve();

        expect(scheduler.getOverview().active).toBeNull();
        expect(scheduler.getOverview().queued).toBe(0);
    });

    it("keeps two builds' transfers apart even when they carry the same id", async () => {
        const scheduler = new StudioTaskScheduler();
        const first = new DownloadTaskBridge(scheduler, "build-1");
        const second = new DownloadTaskBridge(scheduler, "build-2");

        first.accept({ phase: "start", id: "dist", kind: "toolchainDownload" });
        second.accept({ phase: "start", id: "dist", kind: "toolchainDownload" });
        await Promise.resolve();

        // Two windows building two projects pull two files; the key describes the output, and these
        // are different files on their way to different places.
        const overview = scheduler.getOverview();
        expect(overview.active).not.toBeNull();
        expect(overview.queued).toBe(1);

        first.endAll();
        second.endAll();
    });

    it("ignores an event for a transfer it never heard start", () => {
        const scheduler = new StudioTaskScheduler();
        const bridge = new DownloadTaskBridge(scheduler, "build-1");

        expect(() => {
            bridge.accept({ phase: "advance", id: "ghost", done: 1, total: 2 });
            bridge.accept({ phase: "end", id: "ghost" });
        }).not.toThrow();
        expect(scheduler.getOverview().active).toBeNull();
    });
});
