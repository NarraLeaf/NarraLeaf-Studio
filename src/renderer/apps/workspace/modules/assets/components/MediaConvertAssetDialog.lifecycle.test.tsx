// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Asset } from "@/lib/workspace/services/assets/types";
import type { MediaAssetSupportRecord } from "@/lib/workspace/services/media/mediaAssetSupport";
import { MediaConvertAssetDialog } from "./MediaConvertAssetDialog";

const io = vi.hoisted(() => ({
    createDir: vi.fn(),
    deleteDir: vi.fn(),
    start: vi.fn(),
    cancel: vi.fn(),
    getStatus: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
}));

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
        fs: { createDir: io.createDir, deleteDir: io.deleteDir },
        mediaConvert: { start: io.start, cancel: io.cancel, getStatus: io.getStatus },
    }),
}));
vi.mock("@/apps/workspace/context", () => ({
    useWorkspace: () => ({
        context: {
            project: { resolve: (...parts: (string | string[])[]) => ["P", ...parts.flat()].join("/") },
            services: { get: (id: string) => id === "mediaSupport"
                ? { refresh: io.refresh }
                : { replaceAssetContentUndoably: io.replace } },
        },
    }),
}));

const asset = { id: "0f8a2c4e-1b3d-4e5f-8a9b-0c1d2e3f4a5b", name: "intro.avi", type: "video", source: "local" } as unknown as Asset;
const record = {
    state: "convertible", target: { kind: "remux", container: "mp4", audioOnly: false }, durationUs: 1_000_000,
} as unknown as MediaAssetSupportRecord;
const reply = (state: object) => ({ success: true, data: { state } });

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(done => { resolve = done; });
    return { promise, resolve };
}

beforeEach(() => {
    io.createDir.mockResolvedValue({ success: true, data: { ok: true } });
    io.deleteDir.mockResolvedValue({ success: true, data: { ok: true } });
    io.cancel.mockResolvedValue({ success: true });
    io.replace.mockResolvedValue({ success: true, data: asset });
    io.refresh.mockResolvedValue(undefined);
});
afterEach(() => {
    cleanup();
    Object.values(io).forEach(mock => mock.mockReset());
});

function openDialog() {
    const onConverted = vi.fn();
    render(<MediaConvertAssetDialog asset={asset} record={record} onClose={() => undefined} onConverted={onConverted} />);
    return onConverted;
}

describe("converting an existing asset", () => {
    it("allows another attempt after a conversion fails", async () => {
        io.start
            .mockResolvedValueOnce(reply({ jobId: "first", status: "error" }))
            .mockResolvedValueOnce(reply({ jobId: "second", status: "done", outputPath: "converted.mp4" }));
        const onConverted = openDialog();

        fireEvent.click(screen.getByText("assets.support.convertAction"));
        await screen.findByText("assets.mediaConvert.state.failed");
        fireEvent.click(screen.getByText("assets.support.convertAction"));

        await waitFor(() => expect(onConverted).toHaveBeenCalledTimes(1));
        expect(io.start).toHaveBeenCalledTimes(2);
        expect(io.replace).toHaveBeenCalledTimes(1);
    });

    it("cancels a job when stop is pressed before its id arrives", async () => {
        const pending = deferred<unknown>();
        io.start.mockReturnValue(pending.promise);
        io.getStatus.mockResolvedValue(reply({ jobId: "job", status: "cancelled" }));
        const onConverted = openDialog();

        fireEvent.click(screen.getByText("assets.support.convertAction"));
        await waitFor(() => expect(io.start).toHaveBeenCalledTimes(1));
        fireEvent.click(screen.getByText("assets.mediaConvert.stopAction"));
        await act(async () => pending.resolve(reply({ jobId: "job", status: "converting" })));

        await waitFor(() => expect(io.cancel).toHaveBeenCalledWith("job"));
        await screen.findByText("assets.mediaConvert.state.stopped");
        expect(io.replace).not.toHaveBeenCalled();
        expect(onConverted).not.toHaveBeenCalled();
    });

    it("does not start a job if stop is pressed while preparing its directory", async () => {
        const pending = deferred<unknown>();
        io.createDir.mockReturnValue(pending.promise);
        openDialog();

        fireEvent.click(screen.getByText("assets.support.convertAction"));
        await waitFor(() => expect(io.createDir).toHaveBeenCalledTimes(1));
        fireEvent.click(screen.getByText("assets.mediaConvert.stopAction"));
        await act(async () => pending.resolve({ success: true, data: { ok: true } }));

        await screen.findByText("assets.mediaConvert.state.stopped");
        expect(io.start).not.toHaveBeenCalled();
        expect(io.deleteDir).toHaveBeenCalledTimes(1);
    });

    it("does not replace the asset when stop precedes a completed start response", async () => {
        const pending = deferred<unknown>();
        io.start.mockReturnValue(pending.promise);
        const onConverted = openDialog();

        fireEvent.click(screen.getByText("assets.support.convertAction"));
        await waitFor(() => expect(io.start).toHaveBeenCalledTimes(1));
        fireEvent.click(screen.getByText("assets.mediaConvert.stopAction"));
        await act(async () => pending.resolve(reply({ jobId: "job", status: "done", outputPath: "converted.mp4" })));

        await screen.findByText("assets.mediaConvert.state.stopped");
        expect(io.replace).not.toHaveBeenCalled();
        expect(onConverted).not.toHaveBeenCalled();
        expect(io.deleteDir).toHaveBeenCalledTimes(1);
    });
});
