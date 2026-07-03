import { useCallback, useRef } from "react";
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
};

const devToolsWithStaticId = DevTools as typeof DevTools & { setStaticId?: unknown };
const STAGE_VISUAL_READY_TIMEOUT_MS = 1500;

function nextAnimationFrame(): Promise<void> {
    return new Promise(resolve => requestAnimationFrame(() => resolve()));
}

async function waitForPaintFrames(count: number): Promise<void> {
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

async function waitForStageVisualReady(root: HTMLElement): Promise<void> {
    await waitForPaintFrames(1);
    const imageElements = Array.from(root.querySelectorAll<HTMLImageElement>("img"));
    const cssImageUrls = collectCssImageUrls(root);
    await Promise.all([
        ...imageElements.map(waitForImageElement),
        ...cssImageUrls.map(waitForImageUrl),
    ]);
    await waitForPaintFrames(2);
}

async function waitForStageVisualReadyWithTimeout(root: HTMLElement): Promise<void> {
    await Promise.race([
        waitForStageVisualReady(root),
        new Promise<void>(resolve => {
            window.setTimeout(resolve, STAGE_VISUAL_READY_TIMEOUT_MS);
        }),
    ]);
    await waitForPaintFrames(1);
}

export function NlrStageLayer(props: {
    session: NlrStageSession | null;
    interactive: boolean;
    onFirstSceneReady: (sessionId: string) => void;
    onLiveGameReady: (sessionId: string, liveGame: LiveGame) => Promise<void> | void;
    onError: (error: Error) => void;
}) {
    const { session, interactive, onFirstSceneReady, onLiveGameReady, onError } = props;
    const startedSessionRef = useRef<string | null>(null);
    const stageRootRef = useRef<HTMLDivElement>(null);

    const handleReady = useCallback((ctx: PlayerEventContext) => {
        if (!session || startedSessionRef.current === session.id) {
            return;
        }
        startedSessionRef.current = session.id;
        const sessionId = session.id;
        if (typeof devToolsWithStaticId.setStaticId !== "function") {
            for (const binding of session.compiled.actionIdBindings) {
                DevTools.setActionId(binding.action, binding.staticId);
            }
        }
        void (async () => {
            try {
                await onLiveGameReady(sessionId, ctx.liveGame);
            } catch (error) {
                onError(error instanceof Error ? error : new Error(String(error)));
            } finally {
                if (startedSessionRef.current === sessionId) {
                    ctx.liveGame.newGame();
                }
            }
        })();
    }, [onError, onLiveGameReady, session]);

    const handleFirstSceneReady = useCallback((_ctx: PlayerLifecycleEventContext) => {
        if (!session) {
            return;
        }
        const sessionId = session.id;
        void (async () => {
            const root = stageRootRef.current;
            if (root) {
                await waitForStageVisualReadyWithTimeout(root);
            } else {
                await waitForPaintFrames(2);
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
            className="absolute inset-0 z-0 overflow-hidden bg-black"
            style={{ pointerEvents: interactive ? "auto" : "none" }}
        >
            <GameProviders game={session.game}>
                <Player
                    key={session.id}
                    story={session.compiled.story}
                    width="100%"
                    height="100%"
                    className="block h-full w-full overflow-hidden"
                    active={true}
                    onReady={handleReady}
                    onFirstSceneReady={handleFirstSceneReady}
                    onError={(error) => onError(error)}
                />
            </GameProviders>
        </div>
    );
}
