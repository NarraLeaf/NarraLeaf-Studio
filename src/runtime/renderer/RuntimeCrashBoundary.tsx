import { Component, type ErrorInfo, type ReactNode } from "react";
import { CRASH_LOOP_LIMIT } from "@shared/utils/crashLoop";
import type { GameCrashStoryPosition } from "@shared/types/gameRuntime";
import { getGameRuntimeBridge } from "@/lib/ui-editor/runtime/gameRuntimeBridge";
import { readStoryPosition } from "@/lib/ui-editor/runtime/app/lastStoryPosition";
import { readRuntimeTestSignalReporter } from "../gameTestSignal";
import { claimAutomaticRestart, getRuntimeCrashPolicy } from "./crashPolicy";
import { RuntimeCrashScreen } from "./RuntimeCrashScreen";

interface RuntimeCrashBoundaryProps {
    children: ReactNode;
}

interface RuntimeCrashBoundaryState {
    details: string | null;
    /** Where the story had got to when it broke. Read once, on the way down - see below. */
    story: GameCrashStoryPosition | null;
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
        this.state = { details: null, story: null };
    }

    static getDerivedStateFromError(error: unknown): RuntimeCrashBoundaryState {
        // The position is taken here rather than by the screen below, and here rather than in
        // `componentDidCatch`: both of those run after the failed tree has come down, and the engine
        // unmounts its scene on the way out. Asked then, "where was the player" answers "nowhere"
        // for every crash in the middle of a scene - which is the crash worth reporting.
        return { details: describeRendererError(error), story: readStoryPosition() };
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

        // Reported first, restarted second. A build that restarts itself is usually one nobody is
        // watching, which makes the log line the only thing that will ever be read about this.
        //
        // Bounded by the same count as the shell's own loop guard: a game that fails on the way up
        // would otherwise reload forever, showing a flickering window and never the message. Once
        // it gives up, the screen below is drawn instead, which is the only state a person can act
        // from.
        if (getRuntimeCrashPolicy() === "restart" && claimAutomaticRestart(CRASH_LOOP_LIMIT)) {
            try {
                bridge?.log("error", "[Crash] Restarting the game (policy: restart)");
            } catch {
                /* The restart matters more than the note about it. */
            }
            window.location.reload();
        }
    }

    render(): ReactNode {
        if (this.state.details !== null) {
            return <RuntimeCrashScreen details={this.state.details} story={this.state.story} />;
        }
        return this.props.children;
    }
}
