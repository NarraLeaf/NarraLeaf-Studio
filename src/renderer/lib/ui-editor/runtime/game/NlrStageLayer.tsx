import { useCallback, useRef, type ReactNode } from "react";
import { MotionConfig } from "motion/react";
import {
    DevTools,
    GameProviders,
    Player,
    type Game,
    type LiveGame,
    type PlayerEventContext,
    type PlayerLifecycleEventContext,
} from "narraleaf-react";
import type { CompiledNlrStory } from "./storyCompiler";

export type NlrStageSession = {
    id: string;
    game: Game;
    compiled: CompiledNlrStory;
    width: number;
    height: number;
    /** On-Stage Game UI node rendered as Player children (mounted inside NLR's RootLayout). */
    onStageNode?: ReactNode;
};

const devToolsWithStaticId = DevTools as typeof DevTools & { setStaticId?: unknown };
const STAGE_VISUAL_READY_TIMEOUT_MS = 1500;

function nextAnimationFrame(): Promise<void> {
    return new Promise(resolve => requestAnimationFrame(() => resolve()));
}

export async function waitForPaintFrames(count: number): Promise<void> {
    for (let i = 0; i < count; i += 1) {
        await nextAnimationFrame();
    }
}

function extractCssImageUrls(value: string): string[] {
    if (!value || value === "none") {
        return [];
    }
    return Array.from(value.matchAll(/url\((?:"([^"]+)"|'([^']+)'|([^"')]+))\)/g))
        .map(match => match[1] ?? match[2] ?? match[3] ?? "")
        .map(url => url.trim())
        .filter(Boolean);
}

function collectCssImageUrls(root: HTMLElement): string[] {
    const urls = new Set<string>();
    const elements = [root, ...Array.from(root.querySelectorAll<HTMLElement>("*"))];
    for (const element of elements) {
        const style = getComputedStyle(element);
        for (const value of [
            style.backgroundImage,
            style.maskImage,
            style.webkitMaskImage,
        ]) {
            for (const url of extractCssImageUrls(value)) {
                urls.add(url);
            }
        }
    }
    return Array.from(urls);
}

async function waitForImageElement(image: HTMLImageElement): Promise<void> {
    if (!image.complete) {
        await new Promise<void>(resolve => {
            const done = () => {
                image.removeEventListener("load", done);
                image.removeEventListener("error", done);
                resolve();
            };
            image.addEventListener("load", done, { once: true });
            image.addEventListener("error", done, { once: true });
        });
    }
    if (image.complete && image.naturalWidth > 0) {
        await image.decode().catch(() => undefined);
    }
}

async function waitForImageUrl(url: string): Promise<void> {
    const image = new window.Image();
    await new Promise<void>(resolve => {
        image.onload = () => resolve();
        image.onerror = () => resolve();
        image.src = url;
    });
    if (image.complete && image.naturalWidth > 0) {
        await image.decode().catch(() => undefined);
    }
}

async function waitForStageVisualReady(root: HTMLElement, warm: boolean): Promise<void> {
    // One frame so React has committed the scene and the elements/backgrounds below are the ones
    // that will actually paint.
    await waitForPaintFrames(1);
    const imageElements = Array.from(root.querySelectorAll<HTMLImageElement>("img"));
    // The CSS sweep runs `getComputedStyle` over the entire stage subtree — a forced style recalc
    // whose whole purpose is catching sources the preloader did not know about. On a stage that was
    // warmed before the game was entered there are none: every source the story registers is
    // already fetched and decoded, and the on-stage Game UI does not mount until the reveal. So
    // skip it there and pay only for the element awaits below.
    const cssImageUrls = warm ? [] : collectCssImageUrls(root);
    await Promise.all([
        ...imageElements.map(waitForImageElement),
        ...cssImageUrls.map(waitForImageUrl),
    ]);
    // Then let the decoded result reach a painted frame: `AspectScaleImage` renders at 0×0 until
    // its load handler measures the bitmap and sets state, so the reveal has to outlast that
    // commit or the stage pops to size in view. A cold stage gets two, because its images finished
    // loading only just now and their handlers may still be landing. A warm stage needs none here
    // — its loads fired in the frame above, and the caller's single post-race frame covers the
    // commit. That is the whole budget after the button press: two frames.
    if (!warm) {
        await waitForPaintFrames(2);
    }
}

/**
 * Resolve once every image inside `root` (elements and CSS backgrounds) has loaded and decoded and
 * the result has been painted, bounded by a timeout. Hosts double-buffering stage sessions use this
 * on the hidden buffer before revealing it, so the swap never shows half-loaded content.
 *
 * Pass `warm` when the stage's assets were already fetched and decoded before this content mounted.
 * The guarantee is the same; it just stops re-verifying what is known to be ready, taking the reveal
 * from four animation frames plus a whole-subtree style recalc down to two frames — the difference
 * between "start" reading as a transition and reading as a wait.
 */
export async function waitForStageVisualReadyWithTimeout(
    root: HTMLElement,
    options?: { warm?: boolean },
): Promise<void> {
    let timeoutId: number | null = null;
    await Promise.race([
        waitForStageVisualReady(root, options?.warm === true),
        new Promise<void>(resolve => {
            timeoutId = window.setTimeout(resolve, STAGE_VISUAL_READY_TIMEOUT_MS);
        }),
    ]);
    if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
    }
    await waitForPaintFrames(1);
}

export function NlrStageLayer(props: {
    session: NlrStageSession | null;
    interactive: boolean;
    /**
     * Whether the stage has been revealed by the host. The layer mounts as soon as a session
     * exists (the Player must mount to preload and fire the ready callbacks), which is earlier
     * than the host reveals it — so while not visible the layer keeps its layout via
     * `visibility: hidden` (NOT `display: none`: the Player needs real measurements to mount)
     * but paints nothing. Without this, the opaque black backdrop flashes over the first frame
     * before the surface system starts. Defaults to true for hosts that manage buffer
     * visibility themselves (e.g. the story preview's double-buffered stage).
     */
    visible?: boolean;
    /**
     * Whether the On-Stage Game UI (Player children) should render. Gated on the game stage being
     * visible so on-stage elements never show during the pre-game boot preload or between app
     * page transitions before a story is entered.
     */
    renderOnStage: boolean;
    /**
     * The Player has initialised and the `LiveGame` is available (Player `onReady`). This is the
     * "environment ready" signal used to dispatch the `gameReady` blueprint event and store the
     * live game. The game has NOT entered any story yet — `liveGame.newGame()` is only called by
     * the host when the game is actually started.
     */
    onLiveGameReady: (sessionId: string, liveGame: LiveGame) => Promise<void> | void;
    /**
     * The Player's initial preload pass has completed (Player `onPreloadComplete`): the entry
     * scene's images are fetched and decoded, so entering the game paints without another load.
     * Still nothing has entered the game. Fires during the host's boot step, because
     * {@link NlrStageLayer} registers the entry scene with the preloader as soon as the Player is
     * ready — hosts gate their loading step on this to keep the fetch/decode off the start path.
     */
    onEnvironmentReady: (sessionId: string) => void;
    /**
     * The first scene has mounted and painted after the game was entered (`newGame()`).
     */
    onFirstSceneReady: (sessionId: string) => void;
    /**
     * The story ran off the end (Player `onEnd`): the last scene finished and nothing followed it.
     *
     * The engine's own signal, not a guess from the outside. A story ends by running out of rows -
     * there is no end-of-game action in the story vocabulary - so before this was wired the game
     * simply stopped with the last frame on screen and nothing else happened. Optional, because a
     * host with nowhere to send the player wants exactly that behaviour and must not be made to
     * invent a screen.
     */
    onEnd?: (sessionId: string) => void;
    /**
     * A stage error surfaced from this session's Player. `sessionId` identifies the emitting
     * session so hosts can ignore teardown noise from an already-replaced session.
     */
    onError: (error: Error, sessionId: string) => void;
}) {
    const { session, interactive, visible = true, renderOnStage, onFirstSceneReady, onEnvironmentReady, onLiveGameReady, onEnd, onError } = props;
    const startedSessionRef = useRef<string | null>(null);
    const stageRootRef = useRef<HTMLDivElement>(null);
    const gameStateRef = useRef<PlayerEventContext["gameState"] | null>(null);
    // Whether the preload pass finished while no scene was mounted — i.e. the stage's assets were
    // fetched and decoded ahead of the game being entered, and the reveal has nothing left to load.
    const warmedBeforeEntryRef = useRef(false);

    const handleReady = useCallback((ctx: PlayerEventContext) => {
        if (!session || startedSessionRef.current === session.id) {
            return;
        }
        startedSessionRef.current = session.id;
        gameStateRef.current = ctx.gameState;
        warmedBeforeEntryRef.current = false;
        const sessionId = session.id;
        if (typeof devToolsWithStaticId.setStaticId !== "function") {
            for (const binding of session.compiled.actionIdBindings) {
                DevTools.setActionId(binding.action, binding.staticId);
            }
        }
        // Give the preloader the entry scene right now. NLR derives its preload set from the
        // *mounted* scene, and nothing is mounted until `newGame()` — so without this the whole
        // fetch → base64 → decode pass for the first scene lands between the player pressing start
        // and the first painted frame. Handing it the entry scene here moves that work under the
        // host's boot/loading step instead, which is what `onEnvironmentReady` then reports.
        // Idempotent: a version of the engine that warms the entry scene itself sets the
        // preloading scene before this runs, and re-entering an already-playing session has a
        // last scene.
        try {
            if (!ctx.gameState.getPreloadingScene() && !ctx.gameState.getLastScene()) {
                ctx.gameState.preloadScene(session.compiled.scene);
            }
        } catch (error) {
            // A story without a usable entry scene must not take the whole stage down: the game
            // still runs, it just pays the preload on entry as it did before.
            onError(error instanceof Error ? error : new Error(String(error)), sessionId);
        }
        // Initialise the environment only (dispatch gameReady, hand back the LiveGame).
        // Entering the game (newGame) is the host's decision, made when the player starts a game.
        void Promise.resolve(onLiveGameReady(sessionId, ctx.liveGame)).catch(error => {
            onError(error instanceof Error ? error : new Error(String(error)), sessionId);
        });
    }, [onError, onLiveGameReady, session]);

    const handlePreloadComplete = useCallback((_ctx: PlayerLifecycleEventContext) => {
        if (!session) {
            return;
        }
        // No mounted scene at this point means the pass warmed the *entry* scene ahead of entry
        // rather than catching up with a scene already on screen — which is what lets the reveal
        // skip re-verifying it.
        warmedBeforeEntryRef.current = !gameStateRef.current?.getLastScene();
        onEnvironmentReady(session.id);
    }, [onEnvironmentReady, session]);

    const handleEnd = useCallback((_ctx: PlayerEventContext) => {
        // Guarded on the session that started, so an `onEnd` arriving from a Player being torn down
        // cannot send a host that has already moved on to a page.
        if (!session || startedSessionRef.current !== session.id) {
            return;
        }
        onEnd?.(session.id);
    }, [onEnd, session]);

    const handleFirstSceneReady = useCallback((_ctx: PlayerLifecycleEventContext) => {
        if (!session) {
            return;
        }
        const sessionId = session.id;
        const warm = warmedBeforeEntryRef.current;
        void (async () => {
            const root = stageRootRef.current;
            if (root) {
                await waitForStageVisualReadyWithTimeout(root, { warm });
            } else {
                await waitForPaintFrames(warm ? 1 : 2);
            }
            if (startedSessionRef.current !== sessionId) {
                return;
            }
            onFirstSceneReady(sessionId);
        })();
    }, [onFirstSceneReady, session]);

    if (!session) {
        return null;
    }

    return (
        <div
            ref={stageRootRef}
            // The opaque black backdrop only applies while revealed: a hidden stage that still
            // claims a black background would flash over layers that mount before the reveal.
            //
            // `nl-motion-keep` exempts the stage from the reduced-motion blanket in styles.css:
            // this is the author's game playing, not Studio chrome, and a transition you are
            // prevented from seeing is one you cannot tune. The MotionConfig below does the same
            // for the framer-motion half — NLR animates through the same instance we do.
            className={`nl-motion-keep absolute inset-0 z-0 overflow-hidden${visible ? " bg-black" : ""}`}
            style={{
                pointerEvents: interactive ? "auto" : "none",
                visibility: visible ? "visible" : "hidden",
            }}
        >
            <MotionConfig reducedMotion="never">
                {/* Key the providers by session id: NLR's GameProvider captures the `game` instance
                    once via useState and never reacts to a changed prop, so a new Game (e.g. the
                    story preview recompiling per row) needs the whole provider subtree to remount. */}
                <GameProviders key={session.id} game={session.game}>
                    <Player
                        key={session.id}
                        story={session.compiled.story}
                        width="100%"
                        height="100%"
                        className="block h-full w-full overflow-hidden"
                        active={true}
                        onReady={handleReady}
                        onPreloadComplete={handlePreloadComplete}
                        onFirstSceneReady={handleFirstSceneReady}
                        onEnd={handleEnd}
                        onError={(error) => onError(error, session.id)}
                    >
                        {renderOnStage ? session.onStageNode ?? null : null}
                    </Player>
                </GameProviders>
            </MotionConfig>
        </div>
    );
}
