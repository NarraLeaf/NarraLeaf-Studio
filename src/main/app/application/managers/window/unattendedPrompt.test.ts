import { describe, expect, it } from "vitest";
import type { CommandLineRunEvent } from "@shared/types/commandLineRun";
import { describePermissionAsker, refuseUnattendedPrompt } from "./unattendedPrompt";

/**
 * A window with nobody at the screen refuses every question and ends its run; any other window is
 * not touched at all. The second half matters as much as the first - an author's own picker must
 * never be refused because of this.
 */
function target(unattended: boolean) {
    const events: CommandLineRunEvent[] = [];
    return {
        events,
        window: {
            isUnattended: () => unattended,
            reportCommandLineRunEvent: (event: CommandLineRunEvent) => events.push(event),
        },
    };
}

describe("refuseUnattendedPrompt", () => {
    it("does nothing in a window somebody is looking at", () => {
        const { window, events } = target(false);

        expect(() => refuseUnattendedPrompt(window, "Something asked")).not.toThrow();
        expect(events).toEqual([]);
    });

    it("ends an unattended window's run as an environment failure, and throws the same sentence", () => {
        const { window, events } = target(true);

        expect(() => refuseUnattendedPrompt(window, "Something asked for a file picker"))
            .toThrow(/^Something asked for a file picker, and a command-line run has nobody at the screen/);
        expect(events).toEqual([{
            kind: "finished",
            ok: false,
            refusal: "environment",
            error: expect.stringMatching(/^Something asked for a file picker, and a command-line run/),
        }]);
    });
});

describe("describePermissionAsker", () => {
    it("names the plugin by its name and version, falling back to its id", () => {
        expect(describePermissionAsker({
            requestId: "r",
            kind: "api",
            capability: "network",
            plugin: { id: "acme.stats", name: "Stats", version: "1.2.0" },
        })).toBe('The plugin "Stats" 1.2.0 asked for permission to use network');
        expect(describePermissionAsker({
            requestId: "r",
            kind: "trust",
            plugin: { id: "acme.stats" },
        })).toBe('The plugin "acme.stats" asked to be trusted');
    });
});
