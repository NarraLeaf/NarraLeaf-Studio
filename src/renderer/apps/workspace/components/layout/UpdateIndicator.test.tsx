// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UpdateState } from "@shared/constants/update";
import { revealUpdatePanel, updateIsOnOffer, updateProgress, updateStatusKey } from "@/lib/app/updatePresentation";
import { UpdateIndicator } from "./UpdateIndicator";

/**
 * The software update in the title bar: drawn only while there is an update, a ring that only
 * moves forward across the download and the unpacking, a panel with the one or two things that can
 * be done, and an opener a notification can use.
 */

vi.mock("@/lib/i18n", async importOriginal => ({
    ...(await importOriginal<Record<string, unknown>>()),
    useTranslation: () => ({
        t: (key: string, params?: Record<string, unknown>) =>
            (params ? `${key}(${Object.values(params).join("|")})` : key),
        has: () => false,
        tn: (key: string, count: number) => `${key}(${count})`,
        locale: "en",
    }),
}));

const bridge = vi.hoisted(() => ({
    state: null as UpdateState | null,
    listener: null as ((state: UpdateState) => void) | null,
    install: vi.fn(() => Promise.resolve({ success: true, data: undefined })),
    cancel: vi.fn(() => Promise.resolve({ success: true, data: { state: null } })),
    download: vi.fn(() => Promise.resolve({ success: true, data: { state: null } })),
}));

vi.mock("@/lib/app/bridge", () => ({
    getInterface: () => ({
        app: {
            openExternal: () => Promise.resolve({ success: true, data: undefined }),
            update: {
                getState: () => Promise.resolve({ success: true, data: { state: bridge.state } }),
                onStateChanged: (handler: (state: UpdateState) => void) => {
                    bridge.listener = handler;
                    return { cancel: () => { bridge.listener = null; } };
                },
                install: bridge.install,
                cancel: bridge.cancel,
                download: bridge.download,
            },
        },
    }),
}));

function state(patch: Partial<UpdateState>): UpdateState {
    return { status: "idle", currentVersion: "1.4.2", canInstall: true, ...patch };
}

async function show(next: UpdateState) {
    bridge.state = next;
    const view = render(<UpdateIndicator />);
    await act(async () => {
        await Promise.resolve();
    });
    return view;
}

beforeEach(() => {
    bridge.state = null;
    bridge.listener = null;
    bridge.install.mockClear();
    bridge.cancel.mockClear();
});

afterEach(cleanup);

describe("updatePresentation", () => {
    it("fills one ring across both steps, never moving backwards", () => {
        expect(updateProgress(state({ status: "downloading", transferredBytes: 0, totalBytes: 100 }))).toBe(0);
        expect(updateProgress(state({ status: "downloading", transferredBytes: 100, totalBytes: 100 }))).toBe(0.5);
        expect(updateProgress(state({ status: "preparing", prepareProgress: 0 }))).toBe(0.5);
        expect(updateProgress(state({ status: "preparing", prepareProgress: 0.5 }))).toBe(0.75);
        expect(updateProgress(state({ status: "ready" }))).toBe(1);
        // A download of unknown size has no position to show.
        expect(updateProgress(state({ status: "downloading" }))).toBeNull();
    });

    it("says a prepared update is ready rather than ready to install", () => {
        expect(updateStatusKey(state({ status: "ready", fastRestart: true }))).toBe("update.status.readyFast");
        expect(updateStatusKey(state({ status: "ready", fastRestart: false }))).toBe("update.status.ready");
        expect(updateStatusKey(state({ status: "error", availableVersion: "1.4.3" }))).toBe("update.status.failed");
        expect(updateStatusKey(state({ status: "error" }))).toBe("update.status.error");
    });

    it("shows nothing for a check that found nothing or never got an answer", () => {
        expect(updateIsOnOffer(null)).toBe(false);
        expect(updateIsOnOffer(state({ status: "idle" }))).toBe(false);
        expect(updateIsOnOffer(state({ status: "checking" }))).toBe(false);
        expect(updateIsOnOffer(state({ status: "error" }))).toBe(false);
        expect(updateIsOnOffer(state({ status: "error", availableVersion: "1.4.3" }))).toBe(true);
        expect(updateIsOnOffer(state({ status: "downloading", availableVersion: "1.4.3" }))).toBe(true);
    });
});

describe("UpdateIndicator", () => {
    it("is not drawn while there is no update", async () => {
        const { container } = await show(state({ status: "idle" }));
        expect(container.querySelector("[data-update-indicator]")).toBeNull();
    });

    it("appears when a version starts downloading, and follows the state main pushes", async () => {
        const { container } = await show(state({ status: "idle" }));
        act(() => bridge.listener?.(state({ status: "downloading", availableVersion: "1.4.3", transferredBytes: 5, totalBytes: 10 })));
        expect(container.querySelector("[data-update-indicator='downloading']")).not.toBeNull();

        act(() => bridge.listener?.(state({ status: "ready", availableVersion: "1.4.3", fastRestart: true })));
        expect(container.querySelector("[data-update-indicator='ready']")).not.toBeNull();
    });

    it("offers to stop an update under way", async () => {
        await show(state({ status: "preparing", availableVersion: "1.4.3", prepareProgress: 0.4 }));
        fireEvent.click(screen.getByLabelText("update.indicator.label"));

        expect(screen.getByText("update.status.preparing(1.4.3)")).toBeTruthy();
        expect(screen.getByText("40%")).toBeTruthy();
        fireEvent.click(screen.getByText("update.actions.cancel"));
        expect(bridge.cancel).toHaveBeenCalledTimes(1);
        expect(screen.queryByText("update.actions.restart")).toBeNull();
    });

    it("offers the restart once the update is ready, and says quitting applies it too", async () => {
        await show(state({ status: "ready", availableVersion: "1.4.3", fastRestart: true }));
        fireEvent.click(screen.getByLabelText("update.indicator.label"));

        expect(screen.getByText("update.status.readyFast(1.4.3)")).toBeTruthy();
        expect(screen.getByText("update.readyHint")).toBeTruthy();
        expect(screen.queryByText("update.actions.cancel")).toBeNull();
        fireEvent.click(screen.getByText("update.actions.restart"));
        expect(bridge.install).toHaveBeenCalledTimes(1);
    });

    it("can be opened by a notification", async () => {
        await show(state({ status: "available", availableVersion: "1.4.3" }));
        expect(screen.queryByText("update.actions.download")).toBeNull();

        act(() => {
            expect(revealUpdatePanel()).toBe(true);
        });

        expect(screen.getByText("update.actions.download")).toBeTruthy();
    });
});
