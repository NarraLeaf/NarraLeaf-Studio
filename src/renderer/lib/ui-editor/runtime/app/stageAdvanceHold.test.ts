import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { isStageCovered } from "./layers/stageOcclusion";
import { createStageAdvanceHolder, holdStageAdvance } from "./stageAdvanceHold";

/**
 * The engine's half, modelled: a suspension set, and a line that moves on a timer.
 *
 * Both pieces are copied from what NLR actually does, because the defect lived in the seam between
 * them rather than in either one. `suspendAdvance` hands out a token and `isAdvanceSuspended` is
 * "any token out"; the auto-forward timer is armed once when a line finishes displaying, and the
 * click it fires is swallowed whole while a token is out - it is not queued and it does not come
 * again. That last part is why releasing has to re-arm.
 */
function makeEngine() {
    const suspensions = new Set<symbol>();
    let armed = false;
    let autoForward = true;
    let advanced = 0;
    return {
        autoForwardOn: () => autoForward,
        setAutoForward: (value: boolean) => {
            autoForward = value;
        },
        gameState: {
            suspendAdvance: () => {
                const token = Symbol("advance-suspension");
                suspensions.add(token);
                return () => {
                    suspensions.delete(token);
                };
            },
            isAdvanceSuspended: () => suspensions.size > 0,
        },
        /** A line finished displaying: the engine arms one auto-forward for it. */
        lineEnded: () => {
            armed = autoForward;
        },
        /** The timer came due. The dialog clicks itself; a held line eats the click. */
        fireAutoForwardTimer: () => {
            if (!armed) {
                return;
            }
            armed = false;
            if (suspensions.size > 0) {
                return;
            }
            advanced += 1;
        },
        /** What a write of the `autoForward` preference does to the line on screen. */
        rearm: () => {
            armed = autoForward;
        },
        advanced: () => advanced,
        suspensionCount: () => suspensions.size,
    };
}

function makeHold(engine: ReturnType<typeof makeEngine>, overrides: {
    isSessionCurrent?: () => boolean;
} = {}) {
    const rearmAutoForward = vi.fn(() => engine.rearm());
    const hold = holdStageAdvance({
        suspendAdvance: () => engine.gameState.suspendAdvance(),
        isSessionCurrent: overrides.isSessionCurrent ?? (() => true),
        isAutoForwardOn: () => engine.autoForwardOn(),
        rearmAutoForward,
    });
    return { hold, rearmAutoForward };
}

describe("holdStageAdvance", () => {
    /**
     * MEASURED before this existed: auto-forward on, Config opened over the stage, and the story
     * ran five actions in sixteen seconds behind the settings screen.
     */
    it("holds the line while the stage is covered, and gives it back when it is not", () => {
        const engine = makeEngine();
        engine.lineEnded();

        const { hold } = makeHold(engine);
        expect(hold.held).toBe(true);

        engine.fireAutoForwardTimer();
        expect(engine.advanced()).toBe(0);

        hold.release();
        expect(engine.suspensionCount()).toBe(0);

        engine.fireAutoForwardTimer();
        expect(engine.advanced()).toBe(1);
    });

    it("wakes auto-forward on release, because the click it swallowed never comes again", () => {
        const engine = makeEngine();
        engine.lineEnded();
        const { hold, rearmAutoForward } = makeHold(engine);

        // The whole pause elapsed behind the settings screen.
        engine.fireAutoForwardTimer();
        hold.release();

        expect(rearmAutoForward).toHaveBeenCalledTimes(1);
        engine.fireAutoForwardTimer();
        expect(engine.advanced()).toBe(1);
    });

    it("leaves a story the player is advancing by hand alone", () => {
        const engine = makeEngine();
        engine.setAutoForward(false);
        engine.lineEnded();
        const { hold, rearmAutoForward } = makeHold(engine);

        hold.release();

        expect(rearmAutoForward).not.toHaveBeenCalled();
        engine.fireAutoForwardTimer();
        expect(engine.advanced()).toBe(0);
    });

    it("wakes nothing when the playthrough went away under the hold", () => {
        const engine = makeEngine();
        engine.lineEnded();
        const { hold, rearmAutoForward } = makeHold(engine, { isSessionCurrent: () => false });

        hold.release();

        expect(engine.suspensionCount()).toBe(0);
        expect(rearmAutoForward).not.toHaveBeenCalled();
    });

    it("releases once, however many times it is asked to", () => {
        const engine = makeEngine();
        engine.lineEnded();
        const { hold, rearmAutoForward } = makeHold(engine);

        hold.release();
        hold.release();

        expect(engine.suspensionCount()).toBe(0);
        expect(rearmAutoForward).toHaveBeenCalledTimes(1);
    });

    it("reports that it is holding nothing when there is no game state yet", () => {
        const rearmAutoForward = vi.fn();
        const hold = holdStageAdvance({
            suspendAdvance: () => null,
            isSessionCurrent: () => true,
            isAutoForwardOn: () => true,
            rearmAutoForward,
        });

        expect(hold.held).toBe(false);
        hold.release();
        expect(rearmAutoForward).not.toHaveBeenCalled();
    });

    /**
     * The gate wired the way `GameApp` wires it: the same `isStageCovered` the skip loop reads,
     * over the same page lane. A second expression for "something is over the stage" is a second
     * expression to forget - and this one has a rule of its own that has to survive
     * (`presentation === "gameOverlay"` is deliberately not it; see `stageOcclusion`).
     */
    describe("driven by the page lane, as the game app drives it", () => {
        function pageLane() {
            const hidden = new Set(["title:1"]);
            const stack = [{ key: "title:1" }];
            return {
                open: (key: string) => stack.push({ key }),
                close: () => stack.pop(),
                covered: () => isStageCovered({
                    pageEntries: stack,
                    pagesHiddenForGame: true,
                    gameHiddenKeys: hidden,
                    layers: [],
                }),
            };
        }

        it("stops the story behind a settings screen and starts it again when it closes", () => {
            const engine = makeEngine();
            const lane = pageLane();
            engine.lineEnded();

            // Nothing over the stage: the story moves on its own.
            expect(lane.covered()).toBe(false);
            engine.fireAutoForwardTimer();
            expect(engine.advanced()).toBe(1);

            engine.lineEnded();
            lane.open("config:2");
            expect(lane.covered()).toBe(true);
            const { hold } = makeHold(engine);

            engine.fireAutoForwardTimer();
            expect(engine.advanced()).toBe(1);

            lane.close();
            expect(lane.covered()).toBe(false);
            hold.release();

            engine.fireAutoForwardTimer();
            expect(engine.advanced()).toBe(2);
        });
    });
});

/**
 * The holder, which is what `GameApp` drives.
 *
 * `holdStageAdvance` on its own is an edge: taken once, handed back once, and the handing back is a
 * React effect cleanup. That makes both halves of the answer a single event each, and an event that
 * does not arrive is permanent - MEASURED: the Save panel opened and closed left one suspension out
 * for the rest of the playthrough, so the stage click, the advance key and auto-forward were all
 * dead with nothing drawn over the stage. The holder asks the question again on every commit
 * instead: still covered, still held; not covered, handed back.
 */
describe("createStageAdvanceHolder", () => {
    function makeHolder(engine: ReturnType<typeof makeEngine>, options: {
        liveUntil?: () => boolean;
    } = {}) {
        const rearmAutoForward = vi.fn(() => engine.rearm());
        const holder = createStageAdvanceHolder(() => holdStageAdvance({
            suspendAdvance: () => ((options.liveUntil?.() ?? true) ? engine.gameState.suspendAdvance() : null),
            isSessionCurrent: () => true,
            isAutoForwardOn: () => engine.autoForwardOn(),
            rearmAutoForward,
        }));
        return { holder, rearmAutoForward };
    }

    it("hands the line back when the cover goes away", () => {
        const engine = makeEngine();
        const { holder } = makeHolder(engine);

        holder.sync(true);
        expect(engine.suspensionCount()).toBe(1);

        holder.sync(false);
        expect(engine.suspensionCount()).toBe(0);
    });

    it("keeps its suspension for as long as the cover is up", () => {
        const engine = makeEngine();
        engine.lineEnded();
        const { holder, rearmAutoForward } = makeHolder(engine);

        // A commit for every frame the settings screen is open. None of them is a release: only an
        // uncovered stage releases, which is the same condition the effect edge used to be.
        for (let i = 0; i < 20; i++) {
            holder.sync(true);
        }

        expect(engine.suspensionCount()).toBe(1);
        expect(rearmAutoForward).not.toHaveBeenCalled();
        engine.fireAutoForwardTimer();
        expect(engine.advanced()).toBe(0);
    });

    it("takes the hold on the next commit when there was no game state to hold yet", () => {
        // The session mounts a beat after the cover goes up: the story is on screen and running
        // while a page is drawn over it, and an edge that has already passed never comes again.
        const engine = makeEngine();
        let gameReady = false;
        const { holder } = makeHolder(engine, { liveUntil: () => gameReady });

        holder.sync(true);
        expect(engine.suspensionCount()).toBe(0);

        gameReady = true;
        holder.sync(true);
        expect(engine.suspensionCount()).toBe(1);

        holder.sync(false);
        expect(engine.suspensionCount()).toBe(0);
    });

    it("never stacks a second suspension on one cover", () => {
        const engine = makeEngine();
        const { holder } = makeHolder(engine);

        holder.sync(true);
        holder.sync(true);
        holder.sync(true);

        expect(engine.suspensionCount()).toBe(1);
    });

    it("hands the line back when the holder is thrown away", () => {
        const engine = makeEngine();
        engine.lineEnded();
        const { holder, rearmAutoForward } = makeHolder(engine);

        holder.sync(true);
        holder.dispose();

        expect(engine.suspensionCount()).toBe(0);
        expect(rearmAutoForward).toHaveBeenCalledTimes(1);
        // Twice is the effect cleanup and the unmount arriving in either order.
        holder.dispose();
        expect(rearmAutoForward).toHaveBeenCalledTimes(1);
    });
});

/**
 * The holder is worth nothing unless `GameApp` drives it that way, and both halves of "that way"
 * are one line each that no type or render test can insist on - `GameApp` is not rendered anywhere
 * in this suite. So this reads the file, the way `failureReporting` reads it for the same reason.
 */
describe("GameApp wiring", () => {
    const APP_FILE = path.join(path.resolve(__dirname), "GameApp.tsx");

    it("reconciles the hold on every commit rather than on the edges of `stageCovered`", async () => {
        const source = await fs.readFile(APP_FILE, "utf8");
        expect(source).toContain("createStageAdvanceHolder");
        const sync = source.indexOf("stageAdvanceHolderRef.current?.sync(stageCovered)");
        expect(sync).toBeGreaterThan(-1);
        // No dependency list: an effect keyed on the answer only runs when the answer changes, and
        // the whole point is to be right on commits where it did not.
        expect(source.slice(sync, sync + 120)).not.toContain("}, [");
    });

    it("asks both occlusion readers about the pages this bundle can draw", async () => {
        const source = await fs.readFile(APP_FILE, "utf8");
        const calls = [...source.matchAll(/isStageCovered\(\{/g)].map(match => match.index ?? 0);
        expect(calls.length).toBeGreaterThan(1);
        for (const at of calls) {
            expect(source.slice(at, at + 400)).toContain("drawableSurfaceIds");
        }
    });
});
