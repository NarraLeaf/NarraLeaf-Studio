import { AGENT_INTERNAL_TOOL_BUILD, AGENT_INTERNAL_TOOL_TEST } from "@shared/agent/protocol";

/**
 * How long a workspace has to answer one call, by the name the call reaches the workspace under.
 *
 * `build` and `test` are main tools: they never travel under those names. A build is handed to the
 * workspace as `__build`, and a test of an open project as `__test` (one of a closed project runs
 * in a background workspace main watches itself), so those are the names listed here.
 */
export function agentCallTimeoutMs(tool: string): number {
    if (tool === AGENT_INTERNAL_TOOL_BUILD) {
        // A first build downloads Electron and the packager's binaries; minutes, not seconds.
        return 20 * 60 * 1000;
    }
    if (LONG_TOOLS.has(tool) || tool.startsWith("playtest_")) {
        return 180 * 1000;
    }
    return 30 * 1000;
}

const LONG_TOOLS = new Set<string>([AGENT_INTERNAL_TOOL_TEST, "lint", "assets_import", "ui_template_apply", "ui_screenshot"]);
