import { describe, expect, it } from "vitest";
import type { PreloadPlan } from "narraleaf-react";
import type { CompiledNlrStory, SceneWarmOrder } from "./storyCompiler";
import { createStudioPreloadScheduler } from "./studioPreloadStrategy";

/**
 * The scheduler reads three things off a compile - the scene table, the action-to-row bindings and
 * the warm order - so a stand-in carrying those three is the whole fixture. Building real compiles
 * here would test the compiler, which has its own tests.
 */
function compiledWith(input: {
    scenes: Record<string, object>;
    warmOrder: Record<string, SceneWarmOrder>;
    actions?: { staticId: string; blockId: string }[];
}): CompiledNlrStory {
    return {
        scenes: input.scenes,
        sceneWarmOrder: input.warmOrder,
        actionIdBindings: (input.actions ?? []).map(entry => ({ ...entry, action: {} })),
    } as unknown as CompiledNlrStory;
}

/** The band each url landed in - the whole of what a plan says about urgency. */
function bands(plan: PreloadPlan | null): Record<string, string> {
    return Object.fromEntries((plan?.entries ?? []).map(entry => [entry.src, entry.band]));
}

/** A warm order with the fields a test does not care about filled in. */
function order(fields: Partial<SceneWarmOrder>): SceneWarmOrder {
    return { sceneName: "Scene", firstFrame: null, onEntry: [], blockOrder: [], byBlock: {}, rows: {}, ...fields };
}

const sceneOne = {};
const sceneTwo = {};

/** Twelve rows of dialogue, then one that shows a sprite well past the look-ahead window. */
function longScene(): SceneWarmOrder {
    const byBlock: Record<string, { type: "image"; url: string }[]> = {};
    const blockOrder: string[] = [];
    for (let index = 0; index < 20; index++) {
        const blockId = `row-${index}`;
        blockOrder.push(blockId);
        byBlock[blockId] = [{ type: "image", url: `sprite-${index}.png` }];
    }
    return order({ firstFrame: "bg.png", blockOrder, byBlock });
}

describe("Studio's preload scheduler", () => {
    describe("entering a scene", () => {
        const scheduler = createStudioPreloadScheduler();
        scheduler.useCompiled(compiledWith({
            scenes: { "scene-1": sceneOne, "scene-2": sceneTwo },
            warmOrder: {
                "scene-1": longScene(),
                "scene-2": order({ firstFrame: "next-bg.png" }),
            },
        }));
        const plan = scheduler.plan({ kind: "scene", scene: sceneOne as never, story: null }) as PreloadPlan;

        it("holds the frame for the opening background and nothing else", () => {
            expect(plan.entries.filter(entry => entry.band === "gate").map(entry => entry.src))
                .toEqual(["bg.png"]);
        });

        it("warms the rows about to happen without waiting for them", () => {
            expect(bands(plan)["sprite-0.png"]).toBe("soon");
            expect(bands(plan)["sprite-11.png"]).toBe("soon");
        });

        it("leaves the rest of the scene to idle time", () => {
            expect(bands(plan)["sprite-12.png"]).toBe("idle");
            expect(bands(plan)["sprite-19.png"]).toBe("idle");
        });

        it("warms one image per other scene, not their whole libraries", () => {
            expect(bands(plan)["next-bg.png"]).toBe("idle");
        });

        it("pins the opening background and keeps exactly what it planned", () => {
            expect(plan.pin).toEqual(["bg.png"]);
            expect(plan.keep).toContain("sprite-19.png");
            expect(plan.keep).toHaveLength(plan.entries.length);
        });
    });

    describe("advancing through a scene", () => {
        const scheduler = createStudioPreloadScheduler();
        scheduler.useCompiled(compiledWith({
            scenes: { "scene-1": sceneOne },
            warmOrder: { "scene-1": longScene() },
            actions: [{ staticId: "a-15", blockId: "row-15" }],
        }));

        it("moves the window to the play head", () => {
            const plan = scheduler.plan({
                kind: "advance", actionId: "a-15", scene: sceneOne as never, story: null,
            }) as PreloadPlan;

            // Behind the head: warmed, but nothing is waiting for it any more.
            expect(bands(plan)["sprite-0.png"]).toBe("idle");
            expect(bands(plan)["sprite-15.png"]).toBe("soon");
            expect(bands(plan)["sprite-19.png"]).toBe("soon");
        });

        it("plans from the top for an action it cannot place, which warms more rather than less", () => {
            const plan = scheduler.plan({
                kind: "advance", actionId: "a-unknown", scene: sceneOne as never, story: null,
            }) as PreloadPlan;

            expect(bands(plan)["sprite-0.png"]).toBe("soon");
        });

        it("stops holding the frame once the game is running", () => {
            const plan = scheduler.plan({
                kind: "advance", actionId: "a-15", scene: sceneOne as never, story: null,
            }) as PreloadPlan;

            expect(plan.entries.some(entry => entry.band === "gate")).toBe(false);
        });
    });

    describe("the author's blocking behaviour", () => {
        it("puts the whole opening scene on the gate, and only on entry", () => {
            const scheduler = createStudioPreloadScheduler({ gateOnWholeScene: true });
            scheduler.useCompiled(compiledWith({
                scenes: { "scene-1": sceneOne },
                warmOrder: { "scene-1": longScene() },
            }));

            const entering = scheduler.plan({ kind: "scene", scene: sceneOne as never, story: null }) as PreloadPlan;
            const running = scheduler.plan({
                kind: "advance", actionId: null, scene: sceneOne as never, story: null,
            }) as PreloadPlan;

            expect(bands(entering)["sprite-19.png"]).toBe("gate");
            expect(running.entries.some(entry => entry.band === "gate")).toBe(false);
        });
    });

    describe("what it declines to plan", () => {
        it("says nothing about a scene it has no warm order for, rather than emptying the cache", () => {
            const scheduler = createStudioPreloadScheduler();
            scheduler.useCompiled(compiledWith({ scenes: { "scene-1": sceneOne }, warmOrder: {} }));

            expect(scheduler.plan({ kind: "scene", scene: sceneOne as never, story: null })).toBeNull();
        });

        it("says nothing before a compile has arrived", () => {
            const scheduler = createStudioPreloadScheduler();

            expect(scheduler.plan({ kind: "scene", scene: sceneOne as never, story: null })).toBeNull();
        });

        it("keeps audio and video out of the url-named entries, which only images belong in", () => {
            const scheduler = createStudioPreloadScheduler();
            scheduler.useCompiled(compiledWith({
                scenes: { "scene-1": sceneOne },
                warmOrder: {
                    "scene-1": order({
                        blockOrder: ["row-0"],
                        byBlock: { "row-0": [{ type: "audio", url: "theme.mp3" }, { type: "video", url: "clip.mp4" }, { type: "image", url: "a.png" }] },
                    }),
                },
            }));

            const plan = scheduler.plan({ kind: "scene", scene: sceneOne as never, story: null }) as PreloadPlan;

            expect(plan.entries.map(entry => entry.src)).toEqual(["a.png"]);
        });
    });

    describe("the clips a scene is about to play", () => {
        const opening = { id: "opening" };
        const ending = { id: "ending" };

        /** A scene that plays one clip early and another near the end. */
        function sceneWithClips(): SceneWarmOrder {
            const byBlock: Record<string, { type: "image" | "video"; url: string; video?: object }[]> = {};
            const blockOrder: string[] = [];
            for (let index = 0; index < 10; index++) {
                const blockId = `row-${index}`;
                blockOrder.push(blockId);
                byBlock[blockId] = [{ type: "image", url: `sprite-${index}.png` }];
            }
            byBlock["row-2"] = [{ type: "video", url: "opening.mp4", video: opening }];
            byBlock["row-8"] = [{ type: "video", url: "ending.mp4", video: ending }];
            return order({ firstFrame: "bg.png", blockOrder, byBlock: byBlock as SceneWarmOrder["byBlock"] });
        }

        function schedulerWithClips() {
            const scheduler = createStudioPreloadScheduler();
            scheduler.useCompiled(compiledWith({
                scenes: { "scene-1": sceneOne },
                warmOrder: { "scene-1": sceneWithClips() },
                actions: [{ staticId: "a-5", blockId: "row-5" }],
            }));
            return scheduler;
        }

        it("names them in the order the rows play them", () => {
            const plan = schedulerWithClips()
                .plan({ kind: "scene", scene: sceneOne as never, story: null }) as PreloadPlan;

            expect(plan.video).toEqual([opening, ending]);
        });

        it("drops the ones the reader has gone past, which the story has on the stage already", () => {
            const plan = schedulerWithClips().plan({
                kind: "advance", actionId: "a-5", scene: sceneOne as never, story: null,
            }) as PreloadPlan;

            expect(plan.video).toEqual([ending]);
        });

        it("says nothing about a clip whose element the compile could not build", () => {
            const scheduler = createStudioPreloadScheduler();
            scheduler.useCompiled(compiledWith({
                scenes: { "scene-1": sceneOne },
                warmOrder: {
                    "scene-1": order({
                        blockOrder: ["row-0"],
                        byBlock: { "row-0": [{ type: "video", url: "broken.mp4" }] },
                    }),
                },
            }));

            const plan = scheduler.plan({ kind: "scene", scene: sceneOne as never, story: null }) as PreloadPlan;

            expect(plan.video).toEqual([]);
        });
    });

    describe("handing back urls instead of bytes", () => {
        it("gives the player the url the row resolved, at no cost to its budget", async () => {
            const scheduler = createStudioPreloadScheduler();

            const acquired = await scheduler.acquire!({ type: "image", src: "app://fs/bg.png" }, new AbortController().signal);

            expect(acquired).toEqual({ url: "app://fs/bg.png", bytes: 0 });
        });
    });

    describe("reporting something nothing warmed", () => {
        const blockId = "0b3f2c1e-9d4a-4c7e-8f21-5a6b7c8d9e0f";

        it("names the row by its scene and position, the way the story editor does", () => {
            const said: string[] = [];
            const scheduler = createStudioPreloadScheduler();
            scheduler.useCompiled(compiledWith({
                scenes: { "scene-1": sceneOne },
                warmOrder: {
                    "scene-1": order({
                        sceneName: "The café",
                        blockOrder: [blockId],
                        byBlock: { [blockId]: [{ type: "image", url: "late.png" }] },
                        rows: { [blockId]: 8 },
                    }),
                },
            }));
            scheduler.useMissingReport(message => said.push(message));

            scheduler.onMissing!({ type: "image", src: "late.png" });
            scheduler.onMissing!({ type: "image", src: "stranger.png" });

            expect(said[0]).toBe(`An image row 8 of "The café" asks for was shown without being warmed.`);
            // This goes to Output, where a row id is a string the author has no way to look up.
            expect(said[0]).not.toContain(blockId);
            expect(said[1]).toBe("An image no row asked for was shown without being warmed: stranger.png.");
        });

        it("names the row in the scene being played, not the first scene that used the image", () => {
            // The same character art is asked for in chapter one and again in the ending; a report
            // raised in the ending that pointed at chapter one sent the author to the wrong scene.
            const said: string[] = [];
            const scheduler = createStudioPreloadScheduler();
            scheduler.useCompiled(compiledWith({
                scenes: { "scene-1": sceneOne, "scene-2": sceneTwo },
                warmOrder: {
                    "scene-1": order({
                        sceneName: "Chapter one",
                        blockOrder: ["early"],
                        byBlock: { early: [{ type: "image", url: "her.png" }] },
                        rows: { early: 14 },
                    }),
                    "scene-2": order({
                        sceneName: "The ending",
                        blockOrder: ["late"],
                        byBlock: { late: [{ type: "image", url: "her.png" }] },
                        rows: { late: 3 },
                    }),
                },
            }));
            scheduler.useMissingReport(message => said.push(message));

            scheduler.plan({ kind: "scene", scene: sceneTwo as never, story: null });
            scheduler.onMissing!({ type: "image", src: "her.png" });

            expect(said).toEqual([`An image row 3 of "The ending" asks for was shown without being warmed.`]);
        });
    });

    describe("what the stage mounts when a scene starts", () => {
        /** A character whose first entrance is far past the window, and whose default look the stage mounts on entry. */
        function sceneWithLateCharacter(): SceneWarmOrder {
            return order({ ...longScene(), onEntry: ["sprite-19.png"] });
        }

        it("warms it with the opening frame rather than leaving it to the row that first shows it", () => {
            const scheduler = createStudioPreloadScheduler();
            scheduler.useCompiled(compiledWith({ scenes: { "scene-1": sceneOne }, warmOrder: { "scene-1": sceneWithLateCharacter() } }));

            const plan = scheduler.plan({ kind: "scene", scene: sceneOne as never, story: null }) as PreloadPlan;

            // Row 19 on its own would be idle; the stage fetches it on entry whatever the plan says.
            expect(bands(plan)["sprite-19.png"]).toBe("soon");
            // Still not the gate: the first frame does not show it.
            expect(plan.entries.filter(entry => entry.band === "gate").map(entry => entry.src)).toEqual(["bg.png"]);
        });

        it("keeps it in the plan as the story advances, so the cache does not let go of what is mounted", () => {
            const scheduler = createStudioPreloadScheduler();
            scheduler.useCompiled(compiledWith({
                scenes: { "scene-1": sceneOne },
                warmOrder: { "scene-1": sceneWithLateCharacter() },
                actions: [{ staticId: "a-2", blockId: "row-2" }],
            }));

            const plan = scheduler.plan({ kind: "advance", actionId: "a-2", scene: sceneOne as never, story: null }) as PreloadPlan;

            expect(plan.keep).toContain("sprite-19.png");
            expect(bands(plan)["sprite-19.png"]).toBe("soon");
        });
    });
});

describe("falling back to the player's own walk", () => {
    it("delegates a scene it has no warm order for, rather than warming nothing", () => {
        const asked: string[] = [];
        const scheduler = createStudioPreloadScheduler();
        scheduler.useCompiled(compiledWith({ scenes: { "scene-1": sceneOne }, warmOrder: {} }));
        scheduler.useFallback({
            plan: () => {
                asked.push("fallback");
                return { entries: [{ type: "image", src: "walked.png", band: "gate" }] };
            },
        });

        const plan = scheduler.plan({ kind: "scene", scene: sceneOne as never, story: null }) as PreloadPlan;

        expect(asked).toEqual(["fallback"]);
        expect(bands(plan)).toEqual({ "walked.png": "gate" });
    });

    it("does not delegate a scene it does know, which is the whole point of knowing it", () => {
        const asked: string[] = [];
        const scheduler = createStudioPreloadScheduler();
        scheduler.useCompiled(compiledWith({
            scenes: { "scene-1": sceneOne },
            warmOrder: { "scene-1": longScene() },
        }));
        scheduler.useFallback({ plan: () => { asked.push("fallback"); return null; } });

        scheduler.plan({ kind: "scene", scene: sceneOne as never, story: null });

        expect(asked).toEqual([]);
    });
});

/**
 * The audio field is the only thing that warms a scene's clips and the only thing that lets the
 * previous scene's go - the player calls `retainOnly` from the plan and nowhere else. A plan that
 * omits it stops both halves silently, which a first cut of this file did.
 */
describe("naming the scene's sounds for the audio cache", () => {
    const theme = { config: { src: "theme.mp3" } };
    const hit = { config: { src: "hit.wav" } };

    function withSounds(): ReturnType<typeof createStudioPreloadScheduler> {
        const scheduler = createStudioPreloadScheduler();
        const compiled = compiledWith({
            scenes: { "scene-1": sceneOne },
            warmOrder: { "scene-1": longScene() },
        }) as unknown as { sceneElements: Record<string, { sounds: Map<string, unknown> }> };
        compiled.sceneElements = {
            "scene-1": { sounds: new Map([["bgm", theme], ["hit", hit]]) },
        };
        scheduler.useCompiled(compiled as unknown as CompiledNlrStory);
        return scheduler;
    }

    it("hands over every sound the scene built, so the cache holds them and only them", () => {
        const plan = withSounds().plan({ kind: "scene", scene: sceneOne as never, story: null }) as PreloadPlan;

        expect(plan.audio).toEqual([theme, hit]);
    });

    it("keeps naming them as the story advances, so a mid-scene plan does not release them", () => {
        const plan = withSounds().plan({
            kind: "advance", actionId: null, scene: sceneOne as never, story: null,
        }) as PreloadPlan;

        expect(plan.audio).toEqual([theme, hit]);
    });

    it("answers with an empty set rather than nothing for a scene that built none", () => {
        const scheduler = createStudioPreloadScheduler();
        scheduler.useCompiled(compiledWith({
            scenes: { "scene-1": sceneOne },
            warmOrder: { "scene-1": longScene() },
        }));

        const plan = scheduler.plan({ kind: "scene", scene: sceneOne as never, story: null }) as PreloadPlan;

        // Not undefined: the player skips `retainOnly` entirely for a plan with no audio field, so
        // an absent one would leave the previous scene's clips held for ever.
        expect(plan.audio).toEqual([]);
    });
});
