/**
 * Blueprint System - debug event protocol (M1 freeze).
 * Emitters and DevTools subscribe in M3+; types are stable from M1.
 */

export type BlueprintDebugEvent =
    | { type: "execution.started"; executionId: string; blueprintId: string }
    | { type: "execution.finished"; executionId: string; blueprintId: string }
    | { type: "execution.cancelled"; executionId: string; blueprintId?: string; eventId?: string; graphId?: string; nodeId?: string; reason?: string }
    | { type: "node.enter"; executionId: string; nodeId: string }
    | { type: "node.exit"; executionId: string; nodeId: string }
    | { type: "state.read"; scope: string; key: string }
    | { type: "state.write"; scope: string; key: string }
    | { type: "binding.evaluated"; bindingId: string }
    | { type: "function.call"; functionId: string }
    | { type: "function.return"; functionId: string }
    | { type: "devtools.log"; level: string; message: string }
    | {
          type: "execution.error";
          executionId: string;
          message: string;
          blueprintId?: string;
          eventId?: string;
          graphId?: string;
          nodeId?: string;
      };

export type BlueprintDebugEventLogLevel = "error" | "warning" | "log" | "verbose";

/**
 * Severity of a debug event, shared by every consumer (the Dev Mode output panel, the Workspace
 * console, and the DebugBridge's own capture gate).
 *
 * Everything except errors and explicit `devtools.log` calls is per-node execution tracing
 * (node.enter/exit, state reads/writes, host API call/return, …) and classifies as `verbose`:
 * it is only useful when actively tracing a graph, and at one-or-more events per node it drowns
 * out real logs. `execution.cancelled` stays `verbose` for the same reason - cancellation is
 * routine when a surface closes mid-execution.
 */
export function getBlueprintDebugEventLogLevel(event: BlueprintDebugEvent): BlueprintDebugEventLogLevel {
    if (event.type === "execution.error") {
        return "error";
    }
    if (event.type === "devtools.log") {
        const level = event.level.trim().toLowerCase();
        if (level === "error") {
            return "error";
        }
        if (level === "warn" || level === "warning") {
            return "warning";
        }
        return "log";
    }
    return "verbose";
}
