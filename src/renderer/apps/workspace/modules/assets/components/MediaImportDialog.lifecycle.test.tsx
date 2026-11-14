// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MediaImportPlan } from "../state/mediaImportTriage";
import { MediaImportDialog } from "./MediaImportDialog";

const io = vi.hoisted(() => ({ createDir: vi.fn(), start: vi.fn(), cancel: vi.fn(), getStatus: vi.fn() }));

vi.mock("@/lib/i18n", async importOriginal => ({
    ...(await importOriginal<Record<string, unknown>>()),
    useTranslation: () => ({ t: (key: string) => key, tn: (key: string) => key, locale: "en" }),
}));
vi.mock("@/apps/workspace/components/ui/freezeGuard", async () => {
    const actual = await vi.importActual<typeof import("@/apps/workspace/components/ui/freezeGuard")>(
        "@/apps/workspace/components/ui/freezeGuard",
    );
    return { ...actual, useFreezeGuard: () => actual.makeFreezeGuard(false, "") };
});
vi.mock("@/lib/app/bridge", () => ({
    getInterface: () => ({
        fs: { createDir: io.createDir },
        mediaConvert: { start: io.start, cancel: io.cancel, getStatus: io.getStatus },
    }),
}));
vi.mock("@/apps/workspace/context", () => ({
    useWorkspace: () => ({ context: {
        project: { resolve: (...parts: (string | string[])[]) => ["P", ...parts.flat()].join("/") },
    } }),
}));

const plan: MediaImportPlan = {
    ready: ["ready.wav"],
    problems: [{
        path: "intro.avi", group: "lossless", target: { kind: "remux", container: "mp4", audioOnly: false },
        durationUs: 1_000_000, partiallyUsable: false,
    }],
};
const reply = (state: object) => ({ success: true, data: { state } });

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(done => { resolve = done; });
    return { promise, resolve };
}

beforeEach(() => {
    io.createDir.mockResolvedValue({ success: true, data: { ok: true } });
    io.cancel.mockResolvedValue({ success: true });
});
afterEach(() => {
    cleanup();
    Object.values(io).forEach(mock => mock.mockReset());
});

function openDialog() {
    const onResolve = vi.fn();
    render(<MediaImportDialog plan={plan} onCancel={() => undefined} onResolve={onResolve} />);
    return onResolve;
}

describe("media import conversion", () => {
    it("cancels a job when stop is pressed before its id arrives", async () => {
        const pending = deferred<unknown>();
        io.start.mockReturnValue(pending.promise);
        io.getStatus.mockResolvedValue(reply({ jobId: "job", status: "cancelled" }));
        const onResolve = openDialog();

        fireEvent.click(screen.getByText("assets.mediaConvert.convertAction"));
        await waitFor(() => expect(io.start).toHaveBeenCalledTimes(1));
        fireEvent.click(screen.getByText("assets.mediaConvert.stopAction"));
        await act(async () => pending.resolve(reply({ jobId: "job", status: "converting" })));

        await waitFor(() => expect(io.cancel).toHaveBeenCalledWith("job"));
        await waitFor(() => expect(onResolve).toHaveBeenCalledTimes(1));
        expect(onResolve.mock.calls[0][0].paths).toEqual(["ready.wav"]);
    });

    it("does not start a job if stop is pressed while preparing its directory", async () => {
        const pending = deferred<unknown>();
        io.createDir.mockReturnValue(pending.promise);
        const onResolve = openDialog();

        fireEvent.click(screen.getByText("assets.mediaConvert.convertAction"));
        await waitFor(() => expect(io.createDir).toHaveBeenCalledTimes(1));
        fireEvent.click(screen.getByText("assets.mediaConvert.stopAction"));
        await act(async () => pending.resolve({ success: true, data: { ok: true } }));

        await waitFor(() => expect(onResolve).toHaveBeenCalledTimes(1));
        expect(onResolve.mock.calls[0][0].paths).toEqual(["ready.wav"]);
        expect(io.start).not.toHaveBeenCalled();
    });

    it("keeps each converted output linked to its source for import retry", async () => {
        io.start.mockResolvedValue(reply({ jobId: "job", status: "done", outputPath: "scratch/intro.mp4" }));
        const onResolve = openDialog();

        fireEvent.click(screen.getByText("assets.mediaConvert.convertAction"));

        await waitFor(() => expect(onResolve).toHaveBeenCalledTimes(1));
        expect(onResolve.mock.calls[0][0]).toMatchObject({
            paths: ["ready.wav", "scratch/intro.mp4"],
            sourcesByConvertedPath: { "scratch/intro.mp4": "intro.avi" },
        });
    });
});
