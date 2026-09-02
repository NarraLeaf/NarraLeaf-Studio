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
          /**
           * A node ran with one of its required data inputs left unconnected and no value on the
           * card, so the pin resolved to nothing.
           *
           * Its own event rather than a `devtools.log`, because it has a place: an issue list can
           * put it on a surface, and a repeat of it on the same pin is the same problem rather than
           * a second line of output. Carries the node's and the pin's English names off the
           * catalogue, which is what a host that has no node-title map (the shipped game) can still
           * write into a player's log.
           */
          type: "node.input_missing";
          executionId: string;
          nodeId: string;
          /** The node's display name as its definition declares it. */
          nodeName: string;
          /** The unwired pin's label as its definition declares it. */
          pinLabel: string;
          blueprintId?: string;
          eventId?: string;
          graphId?: string;
          /** See the note on `execution.error`: what lets a host say "the Quick Menu". */
          surfaceId?: string;
      }
    | {
          type: "execution.error";
          executionId: string;
          message: string;
          blueprintId?: string;
          eventId?: string;
          graphId?: string;
          nodeId?: string;
          /**
           * The UI surface whose graph failed, when the failure happened on one.
           *
           * The rest of this event names OUR ids - a blueprint, a graph, a node - none of which an
           * author can find their way back from. A surface id resolves against the document they
           * drew, which is what lets a host say "the Quick Menu" rather than "bp:8f2c1a…". Absent on
           * the global blueprint, which belongs to no surface.
           */
          surfaceId?: string;
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
    // A warning, not an error: the graph carries on and only the one effect this node was placed
    // for is lost. Not `verbose` either - it is a defect, and the whole point is that it was silent.
    if (event.type === "node.input_missing") {
        return "warning";
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
