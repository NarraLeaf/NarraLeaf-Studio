/**
 * Blueprint System — debug event protocol (M1 freeze).
 * Emitters and DevTools subscribe in M3+; types are stable from M1.
 */

export type BlueprintDebugEvent =
    | { type: "execution.started"; executionId: string; blueprintId: string }
    | { type: "execution.finished"; executionId: string; blueprintId: string }
    | { type: "node.enter"; executionId: string; nodeId: string }
    | { type: "node.exit"; executionId: string; nodeId: string }
    | { type: "state.read"; scope: string; key: string }
    | { type: "state.write"; scope: string; key: string }
    | { type: "binding.evaluated"; bindingId: string }
    | { type: "function.call"; functionId: string }
    | { type: "function.return"; functionId: string }
    | { type: "execution.error"; executionId: string; message: string };
