import { useCallback, useRef, type ComponentProps, type ComponentType } from "react";
import {
    DevTools,
    GameProviders,
    Player,
    type Game,
    type PlayerEventContext,
} from "narraleaf-react";
import type { CompiledNlrStory } from "./storyCompiler";

export type NlrStageSession = {
    id: string;
    game: Game;
    compiled: CompiledNlrStory;
    width: number;
    height: number;
};

type PlayerWithPreloadReadyProps = ComponentProps<typeof Player> & {
    onPreloadedReady?: (ctx: PlayerEventContext) => void;
};

const PlayerWithPreloadReady = Player as ComponentType<PlayerWithPreloadReadyProps>;
const devToolsWithStaticId = DevTools as typeof DevTools & { setStaticId?: unknown };

export function NlrStageLayer(props: {
    session: NlrStageSession | null;
    visible: boolean;
    onPreloadedReady: (sessionId: string) => void;
    onError: (error: Error) => void;
}) {
    const { session, visible, onPreloadedReady, onError } = props;
    const startedSessionRef = useRef<string | null>(null);

    const handleReady = useCallback((ctx: PlayerEventContext) => {
        if (!session || startedSessionRef.current === session.id) {
            return;
        }
        startedSessionRef.current = session.id;
        if (typeof devToolsWithStaticId.setStaticId !== "function") {
            for (const binding of session.compiled.actionIdBindings) {
                DevTools.setActionId(binding.action, binding.staticId);
            }
        }
        ctx.liveGame.newGame();
    }, [session]);

    const handlePreloadedReady = useCallback(() => {
        if (!session) {
            return;
        }
        onPreloadedReady(session.id);
    }, [onPreloadedReady, session]);

    if (!session) {
        return null;
    }

    return (
        <div
            className="absolute inset-0 z-0 overflow-hidden bg-black"
            style={{ pointerEvents: visible ? "auto" : "none" }}
        >
            <GameProviders game={session.game}>
                <PlayerWithPreloadReady
                    key={session.id}
                    story={session.compiled.story}
                    width={session.width}
                    height={session.height}
                    className="h-full w-full"
                    active={visible}
                    onReady={handleReady}
                    onPreloadedReady={handlePreloadedReady}
                    onError={(error) => onError(error)}
                />
            </GameProviders>
        </div>
    );
}
