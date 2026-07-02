import { beforeEach, describe, expect, it, vi } from "vitest";
import {
    ConsoleService,
    MAX_CONSOLE_ENTRIES_PER_CHANNEL,
    MAX_CONSOLE_ENTRY_CHARS,
} from "./ConsoleService";
import { Services, type WorkspaceContext } from "../services";

const bridgeMock = vi.hoisted(() => ({
    onConsoleLog: vi.fn((_handler: (payload: unknown) => void) => ({ cancel: () => undefined })),
    onBlueprintDebugEvent: vi.fn((_handler: (payload: unknown) => void) => ({ cancel: () => undefined })),
}));

vi.mock("@/lib/app/bridge", () => ({
    getInterface: () => ({
        devMode: {
            onConsoleLog: bridgeMock.onConsoleLog,
            onBlueprintDebugEvent: bridgeMock.onBlueprintDebugEvent,
        },
    }),
}));

beforeEach(() => {
    bridgeMock.onConsoleLog.mockReset();
    bridgeMock.onConsoleLog.mockImplementation((_handler: (payload: unknown) => void) => ({ cancel: () => undefined }));
    bridgeMock.onBlueprintDebugEvent.mockReset();
    bridgeMock.onBlueprintDebugEvent.mockImplementation((_handler: (payload: unknown) => void) => ({ cancel: () => undefined }));
});

describe("ConsoleService", () => {
    it("stores structured rich output entries", () => {
        const service = new ConsoleService();

        const entry = service.append("build", {
            level: "warning",
            source: "Build",
            segments: [
                { text: "Careful", bold: true, color: "#fbbf24" },
                { text: " output", italic: true },
            ],
        });

        expect(entry.level).toBe("warning");
        expect(service.getEntries("build")).toEqual([entry]);
        expect(entry.segments).toMatchObject([
            { text: "Careful", bold: true, italic: false, color: "#fbbf24" },
            { text: " output", bold: false, italic: true },
        ]);
    });

    it("maps blueprint debug logs into the blueprint channel", () => {
        const service = new ConsoleService();

        service.appendBlueprintDebugEvent({
            type: "devtools.log",
            level: "warn",
            message: "watch this",
        });

        const [entry] = service.getEntries("blueprint");
        expect(entry.level).toBe("warning");
        expect(entry.source).toBe("Blueprint Log");
        expect(entry.segments[0].text).toBe("watch this");
    });

    it("keeps a bounded 500-line buffer per channel", () => {
        const service = new ConsoleService();

        for (let i = 0; i < 2005; i += 1) {
            service.log("build", "info", `line-${i}`);
        }

        const entries = service.getEntries("build");
        expect(entries).toHaveLength(MAX_CONSOLE_ENTRIES_PER_CHANNEL);
        expect(entries[0].segments[0].text).toBe("line-1505");
        expect(entries.at(-1)?.segments[0].text).toBe("line-2004");
    });

    it("truncates each entry to 1024 characters", () => {
        const service = new ConsoleService();

        service.log("build", "info", "x".repeat(MAX_CONSOLE_ENTRY_CHARS + 50));

        const [entry] = service.getEntries("build");
        const text = entry.segments.map(segment => segment.text).join("");
        expect(text).toHaveLength(MAX_CONSOLE_ENTRY_CHARS);
        expect(text.endsWith("... [truncated]")).toBe(true);
    });

    it("preserves multiline entries", () => {
        const service = new ConsoleService();

        service.log("build", "info", "first\nsecond");

        const [entry] = service.getEntries("build");
        expect(entry.segments[0].text).toBe("first\nsecond");
    });

    it("treats Dev Mode running as info output", async () => {
        const service = new ConsoleService();
        let statusHandler: (status: string) => void = () => {
            throw new Error("Dev Mode status handler was not registered");
        };
        const ctx = {
            project: {} as WorkspaceContext["project"],
            services: {
                get: (serviceId: Services) => {
                    if (serviceId === Services.DevMode) {
                        return {
                            onStatusChanged: (handler: (status: string) => void) => {
                                statusHandler = handler;
                                return () => undefined;
                            },
                        };
                    }
                    throw new Error(`Unexpected service lookup: ${serviceId}`);
                },
            },
        } as WorkspaceContext;

        await service.initialize(ctx, async () => undefined);
        statusHandler("running");

        const [entry] = service.getEntries("build");
        expect(entry.level).toBe("info");
        expect(entry.source).toBe("Dev Mode");
    });

    it("routes Dev Mode console IPC payloads into the build channel", async () => {
        const service = new ConsoleService();
        let consoleHandler: (payload: { level: "verbose"; message: string; source?: string }) => void = () => {
            throw new Error("Dev Mode console handler was not registered");
        };
        bridgeMock.onConsoleLog.mockImplementation(handler => {
            consoleHandler = handler as (payload: { level: "verbose"; message: string; source?: string }) => void;
            return { cancel: () => undefined };
        });
        const ctx = {
            project: {} as WorkspaceContext["project"],
            services: {
                get: (serviceId: Services) => {
                    if (serviceId === Services.DevMode) {
                        return {
                            onStatusChanged: () => () => undefined,
                        };
                    }
                    throw new Error(`Unexpected service lookup: ${serviceId}`);
                },
            },
        } as WorkspaceContext;

        await service.initialize(ctx, async () => undefined);
        consoleHandler({ level: "verbose", source: "Dev Mode", message: "bundle assembly started" });

        const [entry] = service.getEntries("build");
        expect(entry.level).toBe("verbose");
        expect(entry.segments[0].text).toBe("bundle assembly started");
    });

    it("routes forwarded Dev Mode blueprint debug events into the blueprint channel", async () => {
        const service = new ConsoleService();
        let blueprintDebugHandler: (payload: { type: "devtools.log"; level: string; message: string }) => void = () => {
            throw new Error("Blueprint debug handler was not registered");
        };
        bridgeMock.onBlueprintDebugEvent.mockImplementation(handler => {
            blueprintDebugHandler = handler as (payload: { type: "devtools.log"; level: string; message: string }) => void;
            return { cancel: () => undefined };
        });
        const ctx = {
            project: {} as WorkspaceContext["project"],
            services: {
                get: (serviceId: Services) => {
                    if (serviceId === Services.DevMode) {
                        return {
                            onStatusChanged: () => () => undefined,
                        };
                    }
                    throw new Error(`Unexpected service lookup: ${serviceId}`);
                },
            },
        } as WorkspaceContext;

        await service.initialize(ctx, async () => undefined);
        blueprintDebugHandler({ type: "devtools.log", level: "info", message: "hello from runtime" });

        const [entry] = service.getEntries("blueprint");
        expect(entry.level).toBe("info");
        expect(entry.source).toBe("Blueprint Log");
        expect(entry.segments[0].text).toBe("hello from runtime");
        expect(service.getEntries("build")).toHaveLength(0);
    });
});
