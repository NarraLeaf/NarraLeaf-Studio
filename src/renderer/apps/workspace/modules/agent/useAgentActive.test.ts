import { describe, expect, it } from "vitest";
import type { AgentQuickState } from "@shared/agent/workspaceAccess";
import { agentStatusCellShown, agentWashesStatusBar } from "./useAgentActive";

const ON: AgentQuickState = { enabled: true, allowWrites: true, fullAccess: false, running: true, movedToPort: null };
const OFF: AgentQuickState = { ...ON, enabled: false, running: false };

/**
 * The green status bar means "an agent is working". A paused agent still counts as active (so its
 * cell stays in the bar with the resume switch), but it is not working, so the bar is not washed.
 */
describe("the status bar's agent wash", () => {
    it("washes while an agent is at work", () => {
        expect(agentWashesStatusBar({ active: true, paused: false }, ON)).toBe(true);
        // Before main has answered, nothing is known to be off.
        expect(agentWashesStatusBar({ active: true, paused: false }, null)).toBe(true);
    });

    it("does not wash while the agent is paused, nor once it has gone idle", () => {
        expect(agentWashesStatusBar({ active: true, paused: true }, ON)).toBe(false);
        expect(agentWashesStatusBar({ active: false, paused: false }, ON)).toBe(false);
    });

    it("does not wash once agent access is off, though the last call was moments ago", () => {
        expect(agentWashesStatusBar({ active: true, paused: false }, OFF)).toBe(false);
    });
});

/**
 * With agent access off there is no agent: the cell does not keep naming the last client, and the
 * way back is the menu bar's Agent menu.
 */
describe("the status bar's agent cell", () => {
    const called = { lastCallAt: 1, activity: null, paused: false };

    it("stays silent until an agent has called, then stays", () => {
        expect(agentStatusCellShown({ lastCallAt: null, activity: null, paused: false }, ON)).toBe(false);
        expect(agentStatusCellShown(called, ON)).toBe(true);
        expect(agentStatusCellShown({ lastCallAt: null, activity: { callId: "c", tool: "story_show", target: null }, paused: false }, ON)).toBe(true);
        expect(agentStatusCellShown({ lastCallAt: null, activity: null, paused: true }, ON)).toBe(true);
        expect(agentStatusCellShown(called, null)).toBe(true);
    });

    it("goes while agent access is off, whatever the session last saw", () => {
        expect(agentStatusCellShown(called, OFF)).toBe(false);
        expect(agentStatusCellShown({ ...called, paused: true }, OFF)).toBe(false);
        expect(agentStatusCellShown({ ...called, activity: { callId: "c", tool: "story_show", target: "走廊" } }, OFF)).toBe(false);
    });
});
