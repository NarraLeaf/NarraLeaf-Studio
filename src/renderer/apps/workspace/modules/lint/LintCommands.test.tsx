// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The project check's standing duties stay out of a recovery window.
 *
 * That window starts only the recovery shell's services, and the lint service is not one of them:
 * its sweep reads the whole document graph recovery mode exists to keep unloaded. Asking it to start
 * its live schedule there threw "Trying to access context of a service before initialization" from
 * a passive effect, and the window that had just been offered as the way into a broken project
 * crashed on the way in.
 */

const workspace = vi.hoisted(() => ({ recovery: false }));
const lint = vi.hoisted(() => ({
    startLive: vi.fn(() => () => undefined),
    getLastReport: vi.fn(() => null),
    onReportChanged: vi.fn(() => () => undefined),
}));
const commands = vi.hoisted(() => ({ register: vi.fn(() => () => undefined) }));

vi.mock("@/lib/workspace/services/services", () => ({
    Services: { Lint: "lint", Command: "command", UI: "ui" },
}));
vi.mock("@/lib/workspace/services/ui/CommandService", () => ({ CommandService: class {} }));

vi.mock("../../context", () => ({
    useWorkspace: () => ({
        isInitialized: true,
        recovery: workspace.recovery,
        context: {
            services: {
                get: (key: string) => {
                    if (key === "lint") {
                        // What the real service does when nobody initialized it.
                        if (workspace.recovery) {
                            throw new Error("Trying to access context of a service before initialization");
                        }
                        return lint;
                    }
                    if (key === "command") {
                        return commands;
                    }
                    return { panels: { show: vi.fn() } };
                },
            },
        },
    }),
}));

const { LintCommands } = await import("./LintCommands");

beforeEach(() => {
    lint.startLive.mockClear();
    commands.register.mockClear();
});

afterEach(cleanup);

describe("LintCommands", () => {
    it("keeps the findings current and lists the check in an ordinary workspace", () => {
        workspace.recovery = false;
        render(<LintCommands />);

        expect(lint.startLive).toHaveBeenCalledTimes(1);
        expect(commands.register).toHaveBeenCalledTimes(1);
    });

    it("does nothing in a recovery window, where the lint service never started", () => {
        workspace.recovery = true;
        expect(() => render(<LintCommands />)).not.toThrow();

        expect(lint.startLive).not.toHaveBeenCalled();
        expect(commands.register).not.toHaveBeenCalled();
    });
});
