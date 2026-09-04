import type {
    PreloadEntry,
    PreloadMoment,
    PreloadPlan,
    PreloadResource,
    PreloadStrategy,
    Scene,
    Sound,
    Video,
} from "narraleaf-react";
import type { CompiledNlrStory, SceneWarmOrder, StoryWarmResource } from "./storyCompiler";

/**
 * Studio's answer to what the player should have ready, and where it should get it.
 *
 * The engine's own answer is a static walk of the action tree: it knows what a scene mentions
 * *anywhere in it* and nothing about the order, so opening a scene warmed everything the whole scene
 * could ever show - on a real project, 103 images and 205 MB of a 241 MB library in order to paint
 * one background. Studio compiled the story. It knows which row asks for which asset and in what
 * order, so it can say "this one image before the frame, the next dozen rows now, the rest when
 * there is nothing better to do" - and it knows the assets are already on local disk, so it can tell
 * the player not to copy them into the renderer's heap on the way in.
 *
 * Three things this owns that the engine used to:
 *
 * - **the plan**, from the compiler's warm order (see {@link SceneWarmOrder});
 * - **the transport**, which is no transport at all: the url a row resolved is already one the
 *   browser can fetch and cache, so it is handed straight back. The engine's own path fetches it
 *   into a blob and mints an object url, which pins a second copy of every warmed image for the
 *   lifetime of the document;
 * - **the report** for anything the stage shows that no row asked for, which Studio can name a row
 *   for instead of asking the author to register images by hand.
 */

/**
 * How many rows ahead count as "about to happen".
 *
 * A row is the unit because the play head names one; most rows resolve no asset at all, so this is a
 * window over the script rather than over the library. Twelve is about a screen of dialogue - far
 * enough ahead that a fetch has landed before the click that wants it, short enough that entering a
 * scene does not warm the chapter. Everything past it is still warmed, just without waiting and
 * without a decode.
 */
const LOOK_AHEAD_ROWS = 12;

export type StudioPreloadScheduler = PreloadStrategy & {
    /**
     * Point the scheduler at a compile. Called once per mounted session, and again on a hot reload:
     * the strategy object is handed to `new Game()` before the story exists and outlives every
     * compile after it.
     */
    useCompiled(compiled: CompiledNlrStory | null): void;
    /** Where a row-less resource report goes. Set by the host that has somewhere to put it. */
    useMissingReport(report: ((message: string) => void) | null): void;
    /**
     * What to fall back on for a scene this has no warm order for.
     *
     * Set to `createDefaultPreloadStrategy(game)` once the game exists - which is after this object,
     * because the game is constructed with it. Without a fallback such a scene warms nothing at all:
     * a strategy answering null means "leave the plan alone", and at scene entry there is no plan to
     * leave.
     */
    useFallback(fallback: PreloadStrategy | null): void;
};

export function createStudioPreloadScheduler(options?: {
    /**
     * Hold the first painted frame for everything the opening scene can show, not just its opening
     * background - the author's `blocking` preload behaviour, and what every build did before the
     * gate could be narrowed.
     */
    gateOnWholeScene?: boolean;
}): StudioPreloadScheduler {
    let compiled: CompiledNlrStory | null = null;
    /** Studio scene id per NLR scene object, which is the only handle a plan moment carries. */
    let sceneIdByScene = new Map<Scene, string>();
    /** The row each action belongs to, so an advancing play head can be placed in the warm order. */
    let blockIdByActionId = new Map<string, string>();
    /** The row that asked for a url, so an unwarmed image can be reported against something. */
    let blockIdByUrl = new Map<string, string>();
    /** One image per scene: what a scene opens on, which is all that is worth warming for a scene nobody is in. */
    let openingFrames: string[] = [];
    let report: ((message: string) => void) | null = null;
    let fallback: PreloadStrategy | null = null;

    return {
        useCompiled(next: CompiledNlrStory | null): void {
            compiled = next;
            sceneIdByScene = new Map();
            blockIdByActionId = new Map();
            blockIdByUrl = new Map();
            openingFrames = [];
            if (!next) {
                return;
            }
            for (const [sceneId, scene] of Object.entries(next.scenes)) {
                sceneIdByScene.set(scene, sceneId);
            }
            for (const binding of next.actionIdBindings) {
                blockIdByActionId.set(binding.staticId, binding.blockId);
            }
            for (const [, order] of Object.entries(next.sceneWarmOrder ?? {})) {
                if (order.firstFrame) {
                    openingFrames.push(order.firstFrame);
                }
                for (const [blockId, resources] of Object.entries(order.byBlock)) {
                    for (const resource of resources) {
                        if (!blockIdByUrl.has(resource.url)) {
                            blockIdByUrl.set(resource.url, blockId);
                        }
                    }
                }
            }
        },

        useMissingReport(next: ((message: string) => void) | null): void {
            report = next;
        },

        useFallback(next: PreloadStrategy | null): void {
            fallback = next;
        },

        plan(moment: PreloadMoment): PreloadPlan | null | Promise<PreloadPlan | null> {
            const scene = moment.scene;
            if (!scene) {
                return null;
            }
            const order = warmOrderFor(scene);
            if (!order) {
                // A scene with no warm order: the synthetic scene a row-precise launch enters
                // through, the boot-time empty story, a preview compile. The player's own walk is
                // the right answer for all of them - it warms more than a plan would, which is the
                // safe direction - and it is why this delegates rather than answering null, which
                // at scene entry would warm nothing at all.
                return fallback ? fallback.plan(moment) : null;
            }
            const from = moment.kind === "advance" ? rowIndexOf(order, moment.actionId) : 0;
            return buildPlan(sceneIdByScene.get(scene) ?? "", order, from, moment.kind === "scene");
        },

        /**
         * Hand back the url the row resolved, and let the browser own the bytes.
         *
         * Every asset here comes off local disk through Studio's own protocol, so the url an `<img>`
         * would be given is already the cheapest thing to give it: the browser fetches and caches it
         * once, and the player holds no second copy. `bytes: 0` is the honest cost - the memory is
         * not the player's to account for - which leaves the fetched-bytes budget inert and the
         * decoded-bitmap budget, which is the one that matters, doing its job unchanged.
         */
        async acquire(resource: PreloadResource) {
            return { url: resource.src, bytes: 0 };
        },

        onMissing(resource: PreloadResource): void {
            if (!report) {
                return;
            }
            const blockId = blockIdByUrl.get(resource.src);
            // A clip is played rather than shown, and what it lacked was buffering rather than a
            // warm cache. Same report, and the difference is worth saying: an author reading
            // "shown without being warmed" about a movie would go looking for the wrong thing.
            const what = resource.type === "video" ? "Played without being buffered" : "Shown without being warmed";
            report(blockId
                ? `${what}: ${resource.src} (first asked for by row ${blockId}).`
                : `${what}, and no row asked for it: ${resource.src}.`);
        },
    };

    function warmOrderFor(scene: Scene): SceneWarmOrder | null {
        const sceneId = sceneIdByScene.get(scene);
        if (!sceneId) {
            return null;
        }
        return compiled?.sceneWarmOrder?.[sceneId] ?? null;
    }

    /**
     * Where in the scene's rows the play head is, or the top when it cannot be placed.
     *
     * A row-precise launch, an async branch and a plugin's injected action all produce actions this
     * cannot place, and the honest answer for all of them is the same: plan from the top of the
     * scene, which warms more than needed rather than less.
     */
    function rowIndexOf(order: SceneWarmOrder, actionId: string | null): number {
        if (!actionId) {
            return 0;
        }
        const blockId = blockIdByActionId.get(actionId);
        if (!blockId) {
            return 0;
        }
        const index = order.blockOrder.indexOf(blockId);
        return index < 0 ? 0 : index;
    }

    function buildPlan(sceneId: string, order: SceneWarmOrder, from: number, gates: boolean): PreloadPlan {
        const entries: PreloadEntry[] = [];
        const seen = new Set<string>();
        const add = (resource: StoryWarmResource, band: PreloadEntry["band"]): void => {
            if (resource.type !== "image" || seen.has(resource.url)) {
                // Only images among the url-named entries, and audio and video are named by element
                // instead - each for its own reason, and both because a url is not enough.
                //
                // Whether a sound decodes into memory or streams as it plays is a property of the
                // sound rather than of its url, so the audio cache has to be handed the sound
                // itself (`soundsOf` below). Warming a video is putting its element on the stage
                // early, and the element that buffered has to be the one that plays, so the plan
                // names the clip (`videosOf` below). Neither could be expressed as a url the player
                // fetches, which is why `entries` is images and nothing else.
                return;
            }
            seen.add(resource.url);
            entries.push({ type: resource.type, src: resource.url, band });
        };

        if (order.firstFrame) {
            add({ type: "image", url: order.firstFrame }, gates ? "gate" : "soon");
        }
        // The band a row lands in follows only its distance from the play head. `gateOnWholeScene`
        // is the author saying they would rather open late than see an image arrive after the frame
        // that wanted it, so it pulls the whole scene onto the gate and leaves the rest alone.
        const nearBand: PreloadEntry["band"] = gates && options?.gateOnWholeScene ? "gate" : "soon";
        const farBand: PreloadEntry["band"] = gates && options?.gateOnWholeScene ? "gate" : "idle";
        order.blockOrder.forEach((blockId, index) => {
            const band = index >= from && index < from + LOOK_AHEAD_ROWS ? nearBand : farBand;
            for (const resource of order.byBlock[blockId] ?? []) {
                add(resource, band);
            }
        });
        // One image per scene the story could go to next, so a jump does not paint on nothing. The
        // engine warmed every image of every reachable scene here, which is where most of the
        // library came from.
        for (const url of openingFrames) {
            add({ type: "image", url }, "idle");
        }
        return {
            entries,
            audio: soundsOf(sceneId),
            video: videosOf(order, from),
            keep: [...seen],
            pin: order.firstFrame ? [order.firstFrame] : [],
        };
    }

    /**
     * The clips the rows from here on will play, nearest first.
     *
     * Every clip ahead of the play head, not a window of them, and deliberately without a number
     * saying how many: the player admits them one at a time and stops at its own ceiling, so what
     * is really being fetched at any moment follows the connection rather than anything decided
     * here. A count in this file would be a second, worse answer to a question the player is
     * already answering with better information - and one nobody could tune without knowing how
     * fast the reader's disk is.
     *
     * Rows BEHIND the play head are left out because the story has already run them: a clip a
     * `/video` row declared is on the stage on the author's own instruction, and the player does
     * not touch those. This is also what makes a one-row `/show` of a clip behave like a
     * declaration row placed earlier - the plan gives both the same head start, and neither depends
     * on where the author happened to put a row.
     */
    function videosOf(order: SceneWarmOrder, from: number): readonly Video[] {
        const upcoming: Video[] = [];
        const seen = new Set<Video>();
        for (let index = Math.max(0, from); index < order.blockOrder.length; index++) {
            for (const resource of order.byBlock[order.blockOrder[index]] ?? []) {
                if (resource.type !== "video" || !resource.video || seen.has(resource.video)) {
                    continue;
                }
                seen.add(resource.video);
                upcoming.push(resource.video);
            }
        }
        return upcoming;
    }

    /**
     * The sounds this scene built, for the audio cache to hold and nothing else to.
     *
     * This field is not optional in practice. `retainOnly` is the only thing that warms a scene's
     * clips *and* the only thing that lets the previous scene's go, and the player calls it from
     * exactly one place: the plan. A plan that omits it does not fall back to anything - it simply
     * stops both halves, which is a scene stuttering into its own first line and a session whose
     * decoded audio never shrinks. That is what a first cut of this file did.
     *
     * The compiler's registry is the right source: it holds the scene's configured music under its
     * own name plus every sound a row created, which is what a scene warms. Voice takes are not in
     * it - they are scene config keyed by line, fetched when the line plays - and were not in what
     * the player warmed before either.
     */
    function soundsOf(sceneId: string): readonly Sound[] {
        const sounds = compiled?.sceneElements?.[sceneId]?.sounds;
        return sounds ? [...sounds.values()] : [];
    }
}
