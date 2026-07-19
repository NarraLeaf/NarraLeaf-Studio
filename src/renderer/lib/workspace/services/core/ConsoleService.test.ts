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

    it("keeps a bounded entry buffer per channel", () => {
        const service = new ConsoleService();

        for (let i = 0; i < 2005; i += 1) {
            service.log("build", "info", `line-${i}`);
        }

        const entries = service.getEntries("build");
        expect(entries).toHaveLength(MAX_CONSOLE_ENTRIES_PER_CHANNEL);
        expect(entries[0].segments[0].text).toBe("line-1505");
        expect(entries.at(-1)?.segments[0].text).toBe("line-2004");
    });

    it("truncates each entry to the configured character limit", () => {
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

    it("exposes the built-in channels by default", () => {
        const service = new ConsoleService();
        expect(service.getChannels().map(channel => channel.id)).toEqual(["blueprint", "build"]);
    });

    it("registers a runtime channel and emits a channelsChanged event", () => {
        const service = new ConsoleService();
        const changed = vi.fn();
        service.onChannelsChanged(changed);

        const dispose = service.registerChannel({ id: "story", label: "Story", description: "" });

        expect(service.getChannels().map(channel => channel.id)).toEqual(["blueprint", "build", "story"]);
        expect(changed).toHaveBeenCalledTimes(1);

        const entry = service.append("story", { level: "warning", message: "dangling ref" });
        expect(service.getEntries("story")).toEqual([entry]);

        dispose();
        expect(service.getChannels().map(channel => channel.id)).toEqual(["blueprint", "build"]);
        expect(service.getEntries("story")).toEqual([]);
        expect(changed).toHaveBeenCalledTimes(2);
    });

    it("ref-counts a shared channel so it survives until the last producer disposes", () => {
        const service = new ConsoleService();
        const definition = { id: "story", label: "Story", description: "" };

        const disposeA = service.registerChannel(definition);
        const disposeB = service.registerChannel(definition);
        expect(service.getChannels().some(channel => channel.id === "story")).toBe(true);

        disposeA();
        expect(service.getChannels().some(channel => channel.id === "story")).toBe(true);

        disposeB();
        expect(service.getChannels().some(channel => channel.id === "story")).toBe(false);
        // Idempotent: a second dispose from the same producer is a no-op.
        disposeB();
        expect(service.getChannels().some(channel => channel.id === "story")).toBe(false);
    });

    it("never removes a built-in channel", () => {
        const service = new ConsoleService();
        const dispose = service.registerChannel({ id: "build", label: "Build", description: "" });
        dispose();
        expect(service.getChannels().map(channel => channel.id)).toEqual(["blueprint", "build"]);
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

    it("sets, merges and clears a channel progress bar", () => {
        const service = new ConsoleService();
        const changed = vi.fn();
        service.onProgressChanged(changed);

        expect(service.getProgress("build")).toBeNull();

        service.setProgress("build", { value: 0.3, label: "packaging" });
        expect(service.getProgress("build")).toEqual({
            value: 0.3,
            indeterminate: false,
            error: false,
            label: "packaging",
        });
        expect(changed).toHaveBeenLastCalledWith({
            channel: "build",
            progress: { value: 0.3, indeterminate: false, error: false, label: "packaging" },
        });

        // Partial update keeps previously set fields (value, label).
        service.setProgress("build", { error: true });
        expect(service.getProgress("build")).toEqual({
            value: 0.3,
            indeterminate: false,
            error: true,
            label: "packaging",
        });

        service.setProgress("build", null);
        expect(service.getProgress("build")).toBeNull();
        expect(changed).toHaveBeenLastCalledWith({ channel: "build", progress: null });
    });

    it("clamps the progress value into [0, 1]", () => {
        const service = new ConsoleService();
        service.setProgress("build", { value: 5 });
        expect(service.getProgress("build")?.value).toBe(1);
        service.setProgress("build", { value: -2 });
        expect(service.getProgress("build")?.value).toBe(0);
    });

    it("flips a running progress bar to error when an error entry is logged", () => {
        const service = new ConsoleService();
        service.setProgress("build", { value: 0.5 });

        service.append("build", { level: "info", message: "still fine" });
        expect(service.getProgress("build")?.error).toBe(false);

        service.append("build", { level: "error", message: "boom" });
        expect(service.getProgress("build")?.error).toBe(true);
    });

    it("does not create a progress bar for an error entry on an idle channel", () => {
        const service = new ConsoleService();
        service.append("build", { level: "error", message: "boom" });
        expect(service.getProgress("build")).toBeNull();
    });
});
