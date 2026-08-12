import { Component, type ErrorInfo, type ReactNode } from "react";
import { getGameRuntimeBridge } from "@/lib/ui-editor/runtime/gameRuntimeBridge";
import { readRuntimeTestSignalReporter } from "../gameTestSignal";
import { RuntimeCrashScreen } from "./RuntimeCrashScreen";

interface RuntimeCrashBoundaryProps {
    children: ReactNode;
}

interface RuntimeCrashBoundaryState {
    details: string | null;
}

export function describeRendererError(error: unknown, componentStack?: string | null): string {
    const head = error instanceof Error
        ? (error.stack ?? `${error.name}: ${error.message}`)
        : String(error);
    return componentStack ? `${head}\n${componentStack}` : head;
}

/**
 * The boundary around the whole game.
 *
 * There was none. A throw anywhere in the game - a widget, a plugin's element renderer, the stage -
 * unmounted React and left the window black, which from the player's side is indistinguishable
 * from a game that hangs. Worse, it was recorded nowhere: the runtime's only error hooks were the
 * ones a test harness installs, so a shipped game reported its own crashes to nobody.
 *
 * One boundary, at the root, because a game has nothing to isolate. If the stage cannot draw, the
 * game is over for this session either way; what matters is that the player is told so, told their
 * saves are intact, and given the way back in.
 */
export class RuntimeCrashBoundary extends Component<RuntimeCrashBoundaryProps, RuntimeCrashBoundaryState> {
    constructor(props: RuntimeCrashBoundaryProps) {
        super(props);
        this.state = { details: null };
    }

    static getDerivedStateFromError(error: unknown): RuntimeCrashBoundaryState {
        return { details: describeRendererError(error) };
    }

    componentDidCatch(error: unknown, info: ErrorInfo): void {
        const details = describeRendererError(error, info.componentStack);
        this.setState({ details });

        const bridge = getGameRuntimeBridge();
        // The log is the whole point of catching this: on desktop it reaches a file that outlives
        // the session, and on the web export it reaches the browser console. Guarded because a
        // crash during boot can happen before there is a bridge at all.
        try {
            bridge?.log("error", `[Crash] The game stopped drawing: ${details}`);
        } catch {
            /* A reporter that throws must not replace the crash it was reporting. */
        }
        try {
            readRuntimeTestSignalReporter(bridge)?.({
                kind: "runtime-error",
                message: describeRendererError(error),
                ...(error instanceof Error && error.stack ? { stack: error.stack } : {}),
            });
        } catch {
            /* Same. A watching test missing one frame is not worth a second failure. */
        }
    }

    render(): ReactNode {
        if (this.state.details !== null) {
            return <RuntimeCrashScreen details={this.state.details} />;
        }
        return this.props.children;
    }
}
