import { describe, expect, it } from "vitest";
import { agentWashesStatusBar } from "./useAgentActive";

/**
 * The green status bar means "an agent is working". A paused agent still counts as active (so its
 * cell stays in the bar with the resume switch), but it is not working, so the bar is not washed.
 */
describe("the status bar's agent wash", () => {
    it("washes while an agent is at work", () => {
        expect(agentWashesStatusBar({ active: true, paused: false })).toBe(true);
    });

    it("does not wash while the agent is paused, nor once it has gone idle", () => {
        expect(agentWashesStatusBar({ active: true, paused: true })).toBe(false);
        expect(agentWashesStatusBar({ active: false, paused: false })).toBe(false);
    });
});
