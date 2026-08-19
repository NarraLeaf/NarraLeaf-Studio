import { describe, expect, it, vi } from "vitest";
import { isStageCovered } from "./layers/stageOcclusion";
import { holdStageAdvance } from "./stageAdvanceHold";

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
