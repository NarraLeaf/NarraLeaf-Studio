import { AGENT_INTERNAL_TOOL_BUILD, AGENT_INTERNAL_TOOL_TEST } from "@shared/agent/protocol";

/** How long a workspace has to answer one call. */
export function agentCallTimeoutMs(tool: string): number {
    if (tool === AGENT_INTERNAL_TOOL_BUILD || tool === "build") {
        // A first build downloads Electron and the packager's binaries; minutes, not seconds.
        return 20 * 60 * 1000;
    }
    if (LONG_TOOLS.has(tool) || tool.startsWith("playtest_")) {
        return 180 * 1000;
    }
    return 30 * 1000;
}

const LONG_TOOLS = new Set<string>([AGENT_INTERNAL_TOOL_TEST, "test", "lint", "assets_import", "ui_template_apply", "ui_screenshot"]);
