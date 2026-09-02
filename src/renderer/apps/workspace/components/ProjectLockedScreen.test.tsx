// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectLockedScreen } from "./ProjectLockedScreen";

/**
 * What a workspace shows when its project is open in another NarraLeaf Studio.
 *
 * Three things are pinned here, and each of them was a decision:
 *
 *  - the author is told the machine and the time, and nothing else the claim carries;
 *  - recovery mode is not offered, because it opens the project in a shell that runs before the
 *    check this screen is standing on;
 *  - Retry is, because the other Studio closing is the ordinary way out of this.
 */

vi.mock("@/lib/i18n", async importOriginal => ({
    ...(await importOriginal<Record<string, unknown>>()),
    useTranslation: () => ({
        // The key and its arguments, so the assertions read as "the host and the time reach the
        // sentence" rather than as a snapshot of one language's wording.
        t: (key: string, params?: Record<string, string>) =>
            (params ? `${key}|${Object.entries(params).map(([k, v]) => `${k}=${v}`).join(",")}` : key),
        has: () => false,
        tn: (key: string, count: number) => `${key}(${count})`,
        locale: "en",
    }),
}));

vi.mock("@/lib/app/bridge", () => ({
    getInterface: () => ({
        getWindowProps: vi.fn().mockResolvedValue({ success: true, data: { projectPath: "D:/games/demo" } }),
        workspace: { close: vi.fn(), openRecent: vi.fn(), setRecoveryMode: vi.fn() },
        app: { exportDiagnostics: vi.fn() },
        selectFolder: vi.fn(),
    }),
}));

// The window chrome is not what this screen is being asked about, and it reaches for a growing set
// of window-control calls the moment it mounts. Everything else in the barrel stays real, including
// the buttons the assertions below look for.
vi.mock("@/lib/components", async importOriginal => ({
    ...(await importOriginal<Record<string, unknown>>()),
    TitleBar: ({ title }: { title: string }) => <header>{title}</header>,
}));

const ELSEWHERE = {
    hostname: "studio-two",
    startedAt: new Date(Date.now() - 45 * 60 * 1000).toISOString(),
    sameHost: false,
};

afterEach(cleanup);

describe("ProjectLockedScreen", () => {
    it("names the machine holding the project and when it took it", () => {
        render(<ProjectLockedScreen holder={ELSEWHERE} onRetry={() => undefined} />);

        const sentence = screen.getByText(/workspace\.shell\.projectLockedElsewhere/);
        expect(sentence.textContent).toContain("host=studio-two");
        expect(sentence.textContent).toMatch(/time=\d{1,2}[:.]\d{2}/);
    });

    it("says the machine is this one rather than naming it", () => {
        render(<ProjectLockedScreen holder={{ ...ELSEWHERE, sameHost: true }} onRetry={() => undefined} />);

        // A hostname the reader owns reads as somebody else's computer.
        expect(screen.getByText(/workspace\.shell\.projectLockedHere/)).toBeTruthy();
        expect(screen.queryByText(/studio-two/)).toBeNull();
    });

    it("offers Retry and the launcher, and not recovery mode", () => {
        render(<ProjectLockedScreen holder={ELSEWHERE} onRetry={() => undefined} />);

        expect(screen.getByText("workspace.shell.retry")).toBeTruthy();
        expect(screen.getByText("workspace.shell.openLauncher")).toBeTruthy();
        // Recovery mode reloads the window into a shell that never reaches the claim, so offering
        // it here would be offering a way into a project a second Studio is editing.
        expect(screen.queryByText("workspace.recovery.enter")).toBeNull();
    });

    it("shows no stack trace, because nothing here failed", () => {
        render(<ProjectLockedScreen holder={ELSEWHERE} onRetry={() => undefined} />);

        expect(screen.queryByText("workspace.shell.showStackTrace")).toBeNull();
    });
});
