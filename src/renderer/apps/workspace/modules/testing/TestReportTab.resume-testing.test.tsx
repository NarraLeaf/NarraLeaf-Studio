// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TestRunService } from "@/lib/testing/TestRunService";
import { testRegistry } from "@/lib/testing/registry";
import type { TestParameterValues, TestVerdict } from "@/lib/testing/types";
import type { WorkspaceFreezeReason } from "@/lib/app/writeFreeze";
import { Services, type WorkspaceContext } from "@/lib/workspace/services/services";
import { TestReportTab } from "./TestReportTab";

const fixture = vi.hoisted(() => ({ context: null as WorkspaceContext | null }));
vi.mock("../../context", () => ({ useWorkspace: () => ({ context: fixture.context, isInitialized: true }) }));
vi.mock("../../registry", () => ({ useRegistry: () => ({ openEditorTab: vi.fn(), setPanelVisibility: vi.fn() }) }));
vi.mock("@/lib/app/bridge", () => ({
    getInterface: () => ({ gameTest: { onEvent: () => ({ cancel: () => undefined }) } }),
    getPrivilegedInterface: () => ({}),
}));

afterEach(cleanup);

describe("test report run availability", () => {
    it("tracks another run and repeats the report's parameters when the slot is free", async () => {
        const service = new TestRunService();
        const consoleService = {
            registerChannel: () => () => undefined,
            log: () => undefined,
            setProgress: () => undefined,
            getProgress: () => null,
        };
        let freezeReason: WorkspaceFreezeReason | null = null;
        const freezeListeners = new Set<(reason: WorkspaceFreezeReason | null) => void>();
        const freezeService = {
            getReason: () => freezeReason,
            onChanged: (listener: (reason: WorkspaceFreezeReason | null) => void) => {
                freezeListeners.add(listener);
                return () => { freezeListeners.delete(listener); };
            },
        };
        const setFreeze = (reason: WorkspaceFreezeReason | null) => {
            freezeReason = reason;
            for (const listener of freezeListeners) listener(reason);
        };
        const context = {
            project: { getConfig: () => ({ projectPath: "D:/project" }) },
            services: { get: (id: Services) => {
                if (id === Services.TestRun) return service;
                if (id === Services.Console) return consoleService;
                if (id === Services.WorkspaceFreeze) return freezeService;
                throw new Error(`Unexpected service ${id}`);
            } },
        } as unknown as WorkspaceContext;
        fixture.context = context;
        await service.initialize(context, async () => undefined);

        const seen: TestParameterValues[] = [];
        let finishOther!: (verdict: TestVerdict) => void;
        const other = new Promise<TestVerdict>(resolve => { finishOther = resolve; });
        const unregisterFirst = testRegistry.register({
            id: "resume-testing.report-first",
            title: { text: "First" },
            presentation: "windowed",
            parameters: [{ id: "flag", kind: "boolean", label: { text: "Flag" } }],
            run: ctx => {
                seen.push(ctx.parameters);
                return { status: "passed" };
            },
        });
        const unregisterOther = testRegistry.register({
            id: "resume-testing.report-other",
            title: { text: "Other" },
            presentation: "headless",
            run: () => other,
        });

        try {
            const runId = await service.start("resume-testing.report-first", { flag: true });
            await waitFor(() => expect(service.getActiveRun()).toBeNull());
            render(<TestReportTab tabId="report" payload={{ runId }} active />);
            const rerun = screen.getByRole("button", { name: "Run again" }) as HTMLButtonElement;
            expect(rerun.disabled).toBe(false);

            await act(async () => { await service.start("resume-testing.report-other"); });
            expect(rerun.disabled).toBe(true);

            await act(async () => { finishOther({ status: "passed" }); await other; });
            await waitFor(() => expect(rerun.disabled).toBe(false));

            act(() => setFreeze({ kind: "live-session", session: "room", writable: [] }));
            expect(rerun.disabled).toBe(false);
            act(() => setFreeze({ kind: "manual" }));
            expect(rerun.disabled).toBe(true);
            act(() => setFreeze({ kind: "live-session", session: "room", writable: [] }));
            expect(rerun.disabled).toBe(false);
            act(() => setFreeze(null));

            fireEvent.click(rerun);
            await waitFor(() => expect(seen).toEqual([{ flag: true }, { flag: true }]));
        } finally {
            service.dispose(context);
            unregisterFirst();
            unregisterOther();
            fixture.context = null;
        }
    });
});
