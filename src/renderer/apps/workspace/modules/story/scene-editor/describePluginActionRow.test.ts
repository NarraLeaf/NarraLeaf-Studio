import { describe, expect, it, vi } from "vitest";
import { describePluginActionRow } from "./useStoryPluginActionCommands";

/**
 * A plugin row's text: the plugin describes it from the row's params, and anything that goes wrong
 * in the plugin's code reads as the plain label rather than a broken row.
 */
describe("describePluginActionRow", () => {
    const base = { id: "acme.rps.play", label: "Rock, Paper, Scissors" };

    it("reads as the label when the action has no describe", () => {
        expect(describePluginActionRow(base, { variable: "outcome" })).toBe("Rock, Paper, Scissors");
    });

    it("reads as what describe says about the row's params", () => {
        const action = { ...base, describe: (params: Record<string, unknown>) => `Rock, Paper, Scissors → ${String(params.variable)}` };
        expect(describePluginActionRow(action, { variable: "outcome" })).toBe("Rock, Paper, Scissors → outcome");
    });

    it("falls back to the label when describe answers nothing, or throws", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        expect(describePluginActionRow({ ...base, describe: () => "  " }, {})).toBe("Rock, Paper, Scissors");
        expect(describePluginActionRow({ ...base, describe: () => undefined }, {})).toBe("Rock, Paper, Scissors");
        expect(describePluginActionRow({ ...base, describe: () => { throw new Error("bad"); } }, {})).toBe("Rock, Paper, Scissors");
        warn.mockRestore();
    });
});
