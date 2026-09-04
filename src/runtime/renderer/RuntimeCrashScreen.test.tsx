// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { GameCrashReportRequest, GameCrashReportResult } from "@shared/types/gameRuntime";

let saveCrashReport: ((request: GameCrashReportRequest) => Promise<GameCrashReportResult>) | undefined;
const copied: string[] = [];

vi.mock("@/lib/ui-editor/runtime/gameRuntimeBridge", () => ({
    getGameRuntimeBridge: () => (saveCrashReport ? { saveCrashReport } : {}),
}));

// Keys rather than wording, as in the boundary's own test: the vitest alias maps `@` at Studio's
// live i18n store, and what is under test here is which affordances are drawn.
vi.mock("@/lib/i18n", () => ({
    useTranslation: () => ({
        t: (key: string, values?: Record<string, string>) =>
            values ? `${key}:${Object.values(values).join(",")}` : key,
    }),
}));

vi.mock("@shared/utils/copyText", () => ({
    copyTextToClipboard: async (text: string) => { copied.push(text); },
}));

import { RuntimeCrashScreen } from "./RuntimeCrashScreen";
import { setRuntimeCrashPolicy, setRuntimeShellLogPath } from "./crashPolicy";

describe("RuntimeCrashScreen report file", () => {
    beforeEach(() => {
        copied.length = 0;
        saveCrashReport = undefined;
        setRuntimeCrashPolicy("details");
        setRuntimeShellLogPath("C:\\profile\\logs\\game.log");
    });

    afterEach(() => {
        cleanup();
        vi.restoreAllMocks();
    });

    it("offers no report button on a shell that cannot write one", () => {
        // The web export, and every page whose preload never ran. An affordance that cannot work is
        // worse than none - and the two things that always work must still be there.
        render(<RuntimeCrashScreen details="boom" />);

        expect(screen.queryByText("game.crash.saveReport")).toBeNull();
        expect(screen.getByText("game.crash.copyDetails")).toBeTruthy();
        expect(screen.getByText("game.crash.logAt:C:\\profile\\logs\\game.log")).toBeTruthy();
    });

    it("names the file it wrote, and sends the shell what only this page knows", async () => {
        const seen: GameCrashReportRequest[] = [];
        saveCrashReport = async request => {
            seen.push(request);
            return { outcome: "written", path: "C:\\profile\\logs\\crash-report.txt" };
        };
        render(<RuntimeCrashScreen details="boom" story={{ storyName: "Chapter One", sceneName: "The corridor", rowId: "block-7" }} />);
        fireEvent.click(screen.getByText("game.crash.saveReport"));

        await waitFor(() => {
            expect(screen.getByText("game.crash.reportSaved:C:\\profile\\logs\\crash-report.txt")).toBeTruthy();
        });
        expect(seen).toHaveLength(1);
        expect(seen[0].details).toBe("boom");
        expect(seen[0].story).toEqual({ storyName: "Chapter One", sceneName: "The corridor", rowId: "block-7" });
    });

    it("says nothing was running when the failure came before a story did", async () => {
        const seen: GameCrashReportRequest[] = [];
        saveCrashReport = async request => {
            seen.push(request);
            return { outcome: "written", path: "report.txt" };
        };

        render(<RuntimeCrashScreen details="boom" />);
        fireEvent.click(screen.getByText("game.crash.saveReport"));

        await waitFor(() => expect(seen).toHaveLength(1));
        expect(seen[0].story).toBeNull();
    });

    it("leaves the copy button and the log path working when the file cannot be written", async () => {
        saveCrashReport = async () => ({ outcome: "failed", error: "EACCES" });

        render(<RuntimeCrashScreen details="boom" />);
        fireEvent.click(screen.getByText("game.crash.saveReport"));

        await waitFor(() => {
            expect(screen.getByText("game.crash.reportFailed:EACCES")).toBeTruthy();
        });
        // The two things the player had before this feature existed are untouched by its failure.
        expect(screen.getByText("game.crash.logAt:C:\\profile\\logs\\game.log")).toBeTruthy();
        fireEvent.click(screen.getByText("game.crash.copyDetails"));
        await waitFor(() => expect(copied).toHaveLength(1));
        expect(copied[0]).toContain("boom");
    });

    it("survives a shell whose report call throws rather than answering", async () => {
        saveCrashReport = async () => { throw new Error("the channel is gone"); };

        render(<RuntimeCrashScreen details="boom" />);
        fireEvent.click(screen.getByText("game.crash.saveReport"));

        await waitFor(() => {
            expect(screen.getByText("game.crash.reportFailed:the channel is gone")).toBeTruthy();
        });
        expect(screen.getByText("game.crash.title")).toBeTruthy();
    });

    it("offers the report even where the failure itself is kept off the screen", () => {
        // `log` policy hides the stack. That player is exactly the one who most needs a file to
        // hand over, because they cannot read what happened themselves.
        setRuntimeCrashPolicy("log");
        saveCrashReport = async () => ({ outcome: "written", path: "report.txt" });

        render(<RuntimeCrashScreen details="boom" />);

        expect(screen.queryByText("game.crash.showDetails")).toBeNull();
        expect(screen.getByText("game.crash.saveReport")).toBeTruthy();
    });
});
