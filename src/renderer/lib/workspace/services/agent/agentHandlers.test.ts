import { describe, expect, it } from "vitest";
import { AGENT_INTERNAL_TOOL_BUILD, AGENT_INTERNAL_TOOL_STATE, AGENT_INTERNAL_TOOL_TEST } from "@shared/agent/protocol";
import { AGENT_TOOLS_BY_NAME, agentToolsForSide } from "@shared/agent/tools";
import { looksLikeAgentPluginToolName } from "@shared/agent/pluginTools";
import { createAgentInternalHandlers, createAgentToolHandlers } from "./agentHandlers";

/**
 * Every workspace tool the endpoint advertises has a handler here, and every handler here is a tool
 * the endpoint advertises - so a tool cannot be listed and missing, or implemented and invisible.
 */
describe("agent tool handlers", () => {
    it("cover exactly the workspace side of the tool table", () => {
        const handled = Object.keys(createAgentToolHandlers()).sort();
        const advertised = agentToolsForSide("workspace").map(tool => tool.name).sort();
        expect(handled).toEqual(advertised);
    });

    it("keep main's internal calls out of the tool table's names", () => {
        const internal = Object.keys(createAgentInternalHandlers()).sort();
        expect(internal).toEqual([AGENT_INTERNAL_TOOL_BUILD, AGENT_INTERNAL_TOOL_TEST].sort());
        for (const name of [...internal, AGENT_INTERNAL_TOOL_STATE]) {
            expect(AGENT_TOOLS_BY_NAME.has(name)).toBe(false);
        }
    });

    it("leave plugin tools to the plugins: no handler here has a plugin tool's shape", () => {
        // A plugin tool (`<plugin>__<tool>`) is advertised from what the open workspace's plugins
        // registered and run from that registry by the bridge, never from this table - so the table
        // can only ever cover the built-in rows, and a plugin cannot shadow one of them.
        for (const name of Object.keys(createAgentToolHandlers())) {
            expect(looksLikeAgentPluginToolName(name), name).toBe(false);
        }
    });
});
