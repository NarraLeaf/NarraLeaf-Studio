// @vitest-environment jsdom
/**
 * Converting an asset already in the library, from the mark in the asset browser.
 *
 * The converted file goes in through the replace Replace File… takes, as one step of undo named after
 * the asset; the bytes coming back on Ctrl+Z are `AssetsService.test.ts`. What is asserted here is the
 * dialog's half: which path the swap takes, and that a swap the library refused says why.
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Asset } from "@/lib/workspace/services/assets/types";
import type { MediaAssetSupportRecord } from "@/lib/workspace/services/media/mediaAssetSupport";
import { MediaConvertAssetDialog } from "./MediaConvertAssetDialog";

const ASSET = { id: "0f8a2c4e-1b3d-4e5f-8a9b-0c1d2e3f4a5b", name: "intro.avi", type: "video", source: "local" } as unknown as Asset;
const RECORD = { state: "convertible", target: "webm", lossy: true, durationUs: 1_000_000 } as unknown as MediaAssetSupportRecord;

/** What the library answers the swap with in a case. */
let replaceAnswer: unknown = { success: true, data: ASSET };
const replaceAssetContentUndoably = vi.fn(async () => replaceAnswer);
const replaceAssetContent = vi.fn(async () => ({ success: true, data: ASSET }));
const refresh = vi.fn(async () => undefined);

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
        fs: {
            createDir: async () => ({ success: true, data: { ok: true, data: undefined } }),
            deleteDir: async () => ({ success: true, data: { ok: true, data: undefined } }),
        },
        mediaConvert: { start: vi.fn(), cancel: vi.fn(), getStatus: vi.fn() },
    }),
}));

vi.mock("../state/runMediaConversion", () => ({
    MEDIA_CONVERT_POLL_MS: 0,
    runMediaConversion: async () => ({ status: "done", outputPath: "P/.nlstudio/convert/run/intro.webm" }),
}));

vi.mock("@/apps/workspace/context", () => ({
    useWorkspace: () => ({
        context: {
            project: { resolve: (...parts: (string | string[])[]) => ["P", ...parts.flat()].join("/") },
            services: {
                get: (id: string) => (id === "mediaSupport" ? { refresh } : { replaceAssetContentUndoably, replaceAssetContent }),
            },
        },
    }),
}));

afterEach(() => {
    cleanup();
    replaceAnswer = { success: true, data: ASSET };
    replaceAssetContentUndoably.mockClear();
    replaceAssetContent.mockClear();
    refresh.mockClear();
});

async function convert(onConverted = vi.fn()) {
    render(<MediaConvertAssetDialog asset={ASSET} record={RECORD} onClose={() => undefined} onConverted={onConverted} />);
    await act(async () => {
        fireEvent.click(screen.getByText("assets.support.convertAction"));
    });
    return onConverted;
}

describe("MediaConvertAssetDialog", () => {
    it("puts the converted file in place as one step of undo, named after the asset", async () => {
        const onConverted = await convert();

        expect(replaceAssetContentUndoably).toHaveBeenCalledWith(ASSET, "P/.nlstudio/convert/run/intro.webm", {
            key: "assets.history.convert",
            params: { name: "intro.avi" },
        });
        expect(replaceAssetContent).not.toHaveBeenCalled();
        expect(onConverted).toHaveBeenCalledTimes(1);
    });

    it("says why the file was not put in place when the original could not be kept for undo", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        replaceAnswer = { success: false, error: "log only", refusal: { kind: "notKept" } };
        try {
            const onConverted = await convert();

            expect(onConverted).not.toHaveBeenCalled();
            // The headline and the reason, in place of the bare "could not convert".
            expect(screen.getByText("assets.reference.withReason")).not.toBeNull();
            expect(screen.queryByText("assets.mediaConvert.state.failed")).toBeNull();
        } finally {
            warn.mockRestore();
        }
    });
});
