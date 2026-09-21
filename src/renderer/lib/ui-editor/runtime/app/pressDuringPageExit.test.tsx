// @vitest-environment jsdom
/**
 * A press made while a page is fading out goes to what the player can see - and never to the story.
 *
 * A page that leaves is drawn above the one arriving in its place for as long as it fades, and its
 * elements turn pointer events back on for themselves (a widget wrapper does, and so does the box a
 * free-layout container lays its children out in), so the layer's own `pointer-events: none` did
 * nothing: every press over the page it was leaving landed on its invisible elements, which no
 * longer had a handler, and was lost. On the title of a real project, Back pressed on Settings was
 * lost six times out of six until the title had left the DOM - including at opacity 0.
 *
 * Letting that press through has consequences this file pins as well:
 *
 *  - Back pressed on a page returns to the page that is still fading out, and the presence group
 *    brings that same layer back rather than drawing a new one. It had already painted, so it never
 *    said so again, and the lane kept the page it was leaving drawn on top of it for good - the same
 *    wedge an Escape pressed during the fade already reached through the keyboard. Coming back also
 *    reorders the lane, which a development build answers by replaying the moved layer's effects.
 *  - When nothing is drawn under the leaving page, what is under it is the game stage, which turns a
 *    press into the next line. Closing a menu and pressing again a moment later must not do that.
 *
 * And the keys: a page that leaves in the same render that takes the stack from it - Back to a
 * running game - left still owning the keyboard, and its elements went on answering keys as it faded.
 *
 * jsdom has no layout, so it cannot say what a press lands on; `fireEvent` dispatches at whatever it
 * is handed, `pointer-events` or not. The browser's rule is stated here instead (`landsOn`): a press
 * goes to the topmost element under the point that takes pointer events. What is under the point is
 * named by each test, and ordered the way the stack paints it. Everything else - the page layers,
 * the animation layers, the element tree, the buttons, the navigation machine and the box around the
 * stack - is the real thing, played the way `GameApp` plays it.
 */
import { StrictMode, useCallback, useState } from "react";
import { AnimatePresence } from "motion/react";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { UI_DOCUMENT_SCHEMA_VERSION, type UIDocument, type UIElement, type UISurface } from "@shared/types/ui-editor/document";
import { DEFAULT_UI_PAGE_ANIMATION_SETTINGS } from "@shared/types/ui-editor/pageAnimation";
import type { PersistentVariableRuntimeTable } from "@shared/types/variables/registry";
import { ElementRendererRegistry } from "@/lib/ui-editor/runtime/ElementRendererRegistry";
import { BuiltinElementRenderers } from "@/lib/ui-editor/runtime/builtin";
import { WidgetRuntimeStateStore } from "@/lib/ui-editor/runtime/appearance/WidgetRuntimeStateStore";
import type { UIHostAdapter } from "@/lib/ui-editor/runtime/types";
import { createRecordingCore, ensureAnimationFramePolyfill } from "@/lib/ui-editor/runtime/testing/lifecycleTestKit";
import { installResizeObserverStub } from "@/lib/ui-editor/runtime/testing/drawingLabFixture";
import { blueprintDocumentOf } from "@/lib/ui-editor/runtime/testing/rowRuntimeTestKit";
import { SurfaceLifecycleOrchestrator } from "./lifecycle/surfaceLifecycleOrchestrator";
import { NavigationController } from "./navigation/NavigationController";
import { useSurfaceNavigation } from "./navigation/useSurfaceNavigation";
import { AppSurfaceLayer } from "./AppSurfaceLayer";
import { SurfaceStackBox } from "./SurfaceStackBox";
import type { WidgetPatchesByScope } from "./widgetRuntimePatches";
import type { AppNavEntry, HostAdapterBundle } from "./types";

const NO_BLUEPRINTS = blueprintDocumentOf([]);

/**
 * A cross-fade, as a real project writes it (`exitBlocking` off), slowed down so a press made just
 * after a page starts leaving is well inside its exit.
 */
const CROSS_FADE = {
    ...DEFAULT_UI_PAGE_ANIMATION_SETTINGS,
    enter: "fade" as const,
    enterDurationSeconds: 0.6,
    exit: "fade" as const,
    exitDurationSeconds: 0.6,
    exitBlocking: false,
};

function element(id: string, type: string, parentId: string | null, childrenIds: string[], more?: Partial<UIElement>): UIElement {
    return { id, type, parentId, childrenIds, layout: { x: 0, y: 0, width: 200, height: 60 }, ...more };
}

function surfaceOf(id: string, rootElementId: string): UISurface {
    return {
        id,
        name: id,
        host: "app",
        kind: "appSurface",
        designSize: { width: 640, height: 360 },
        rootElementId,
        settings: { pageAnimation: CROSS_FADE },
    } as UISurface;
}

const FULL = { x: 0, y: 0, width: 640, height: 360 };

/**
 * A title and a settings page, each laid out on a full-size panel the way a real one is - which is
 * what put the title's invisible elements under every press on Settings. And an in-game menu that
 * covers only a corner of the stage, so a press can be made beside it.
 */
const document = {
    schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
    id: "doc",
    name: "Doc",
    surfaces: [surfaceOf("title", "titleRoot"), surfaceOf("settings", "settingsRoot"), surfaceOf("menu", "menuRoot")],
    elements: {
        titleRoot: element("titleRoot", "nl.root", null, ["titlePanel"]),
        titlePanel: element("titlePanel", "nl.container", "titleRoot", ["start", "openSettings"], { layout: FULL }),
        start: element("start", "nl.button", "titlePanel", [], { props: { label: "Start" } }),
        openSettings: element("openSettings", "nl.button", "titlePanel", [], {
            layout: { x: 0, y: 100, width: 200, height: 60 },
            props: { label: "Settings" },
        }),
        settingsRoot: element("settingsRoot", "nl.root", null, ["settingsPanel"]),
        settingsPanel: element("settingsPanel", "nl.container", "settingsRoot", ["back"], { layout: FULL }),
        back: element("back", "nl.button", "settingsPanel", [], {
            layout: { x: 20, y: 280, width: 200, height: 60 },
            props: { label: "Back" },
        }),
        menuRoot: element("menuRoot", "nl.root", null, ["menuPanel"]),
        menuPanel: element("menuPanel", "nl.container", "menuRoot", ["close"], {
            layout: { x: 0, y: 0, width: 240, height: 120 },
        }),
        close: element("close", "nl.button", "menuPanel", [], { props: { label: "Close" } }),
    },
} as unknown as UIDocument;

function surfaceById(id: string): UISurface {
    return document.surfaces.find(surface => surface.id === id)!;
}

let entrySeq = 0;

function navEntry(surfaceId: string, waitForExit = false): AppNavEntry {
    entrySeq += 1;
    const key = `${surfaceId}:${entrySeq}`;
    return {
        key,
        runtimeScopeId: key,
        sessionKey: "session",
        surfaceId,
        direction: "forward",
        waitForExit,
        props: {},
        presentation: "appPage",
    };
}

type ElementEvent = { elementId: string; eventName: string };

/** A page runtime that records what reaches it, and hands its element events to the test. */
function recordingPage(surfaceId: string, runtimeScopeId: string, onElementEvent: (event: ElementEvent) => void) {
    const elementEvents: ElementEvent[] = [];
    const surfaceEvents: string[] = [];
    const adapter = {
        host: "app",
        blueprintRuntime: {
            surfaceId,
            runtimeScopeId,
            setSurfaceState: () => undefined,
            getSurfaceState: () => undefined,
            emitDebug: () => undefined,
            dispatchElementBlueprintEvent: async (elementId: string, eventName: string) => {
                const event = { elementId, eventName };
                elementEvents.push(event);
                onElementEvent(event);
            },
            dispatchSurfaceBlueprintEvent: async (eventName: string) => {
                surfaceEvents.push(eventName);
            },
        },
    } as unknown as UIHostAdapter;
    return {
        adapter,
        surfaceEvents,
        count: (elementId: string, eventName: string) =>
            elementEvents.filter(event => event.elementId === elementId && event.eventName === eventName).length,
    };
}

type RecordingPage = ReturnType<typeof recordingPage>;

/**
 * The page lane of `GameApp`, over a stand-in for the game stage: a navigation controller, a
 * presence group drawing what it says is visible, the entry the stack settles on taking pointer
 * input and keys, the reveal recorded when a layer reports its prepaint, and all of it inside the
 * box the app draws its pages in. The stage counts the presses that reach it, each of which would
 * be the next line.
 */
function createGame(options: { hiddenForGame?: ReadonlySet<string> } = {}) {
    const navigation = new NavigationController();
    const hiddenForGame = options.hiddenForGame ?? new Set<string>();
    const pages = new Map<string, RecordingPage>();
    const bundles = new Map<string, HostAdapterBundle>();
    const stage = { advances: 0 };

    const bundleFor = (entry: AppNavEntry): HostAdapterBundle => {
        const existing = bundles.get(entry.key);
        if (existing) {
            return existing;
        }
        const page = recordingPage(entry.surfaceId, entry.runtimeScopeId, event => {
            if (event.eventName !== "mouseClick") {
                return;
            }
            if (event.elementId === "openSettings") {
                void openPage("settings");
            } else if (event.elementId === "back" || event.elementId === "close") {
                void goBack();
            }
        });
        pages.set(entry.key, page);
        const bundle: HostAdapterBundle = {
            hostAdapter: page.adapter,
            bindingContext: null as unknown as HostAdapterBundle["bindingContext"],
            runtimeScopeId: entry.runtimeScopeId,
        };
        bundles.set(entry.key, bundle);
        return bundle;
    };

    const top = () => {
        const stack = navigation.getState().navStack;
        return stack[stack.length - 1] ?? null;
    };

    const openPage = (surfaceId: string) => {
        const current = top();
        return navigation.open({
            fromSurface: current ? surfaceById(current.surfaceId) : null,
            targetSurface: surfaceById(surfaceId),
            currentHiddenForGame: Boolean(current && hiddenForGame.has(current.key)),
            reducedMotion: false,
            elements: document.elements,
            createNextEntry: waitForExit => navEntry(surfaceId, waitForExit),
        });
    };

    const goBack = () => {
        const stack = navigation.getState().navStack;
        const current = stack[stack.length - 1]!;
        const target = stack[stack.length - 2]!;
        return navigation.close({
            fromSurface: surfaceById(current.surfaceId),
            targetSurface: surfaceById(target.surfaceId),
            targetHiddenForGame: hiddenForGame.has(target.key),
            reducedMotion: false,
            elements: document.elements,
        });
    };

    function Game() {
        const state = useSurfaceNavigation(navigation);
        const [revealed, setRevealed] = useState<ReadonlySet<string>>(() => new Set());
        const [shared] = useState(() => ({
            core: createRecordingCore([]),
            registry: new ElementRendererRegistry(BuiltinElementRenderers),
            widgetRuntimeStore: new WidgetRuntimeStateStore(),
            lifecycleRef: { current: new SurfaceLifecycleOrchestrator() },
            widgetPatchesByScopeRef: { current: {} as WidgetPatchesByScope },
        }));
        // Stable, as `GameApp`'s are: a leaving layer is drawn with the props it last had, callbacks
        // included.
        const onPrepaintReady = useCallback((entryKey: string) => {
            setRevealed(previous => new Set(previous).add(entryKey));
            navigation.markPrepaintReady(entryKey);
        }, []);
        const onEnterComplete = useCallback((entryKey: string) => navigation.markEnterComplete(entryKey), []);
        const onExitComplete = useCallback(() => navigation.markAllExited(), []);
        const activeKey = state.navStack[state.navStack.length - 1]?.key ?? null;
        return (
            <div data-testid="game">
                <div data-testid="stage" onClick={() => (stage.advances += 1)} />
                <SurfaceStackBox>
                    <AnimatePresence custom={state.direction} initial={false} mode={state.presenceMode} onExitComplete={onExitComplete}>
                        {state.visibleEntries
                            .filter(entry => !hiddenForGame.has(entry.key))
                            .map((entry, layerIndex) => (
                                <AppSurfaceLayer
                                    key={entry.key}
                                    uidoc={document}
                                    blueprintDocument={NO_BLUEPRINTS}
                                    persistentVariables={{} as PersistentVariableRuntimeTable}
                                    core={shared.core}
                                    entry={entry}
                                    layerIndex={layerIndex}
                                    surface={surfaceById(entry.surfaceId)}
                                    rendererRegistry={shared.registry}
                                    scale={1}
                                    hostAdapterBundle={bundleFor(entry)}
                                    widgetPatchesByScope={{}}
                                    widgetPatchesByScopeRef={shared.widgetPatchesByScopeRef}
                                    widgetRuntimeStore={shared.widgetRuntimeStore}
                                    lifecycleRef={shared.lifecycleRef}
                                    blueprintLifecycleReady={revealed.has(entry.key)}
                                    reducedMotion={false}
                                    active={entry.key === activeKey}
                                    keyboardOwner={entry.key === activeKey}
                                    onPrepaintReady={onPrepaintReady}
                                    onEnterComplete={onEnterComplete}
                                />
                            ))}
                    </AnimatePresence>
                </SurfaceStackBox>
            </div>
        );
    }

    /** The runtime of the page most recently drawn for this surface. */
    const pageOf = (surfaceId: string): RecordingPage => {
        const entryKey = [...pages.keys()].reverse().find(key => key.startsWith(`${surfaceId}:`));
        if (!entryKey) {
            throw new Error(`no ${surfaceId} page was drawn`);
        }
        return pages.get(entryKey)!;
    };

    return { navigation, pageOf, stage, openPage, goBack, Game };
}

/** The page layer drawing `surfaceId`, found by the attribute the animation layer carries. */
function layerOf(container: HTMLElement, surfaceId: string): HTMLElement | null {
    return container.querySelector<HTMLElement>(`[data-ui-surface-id="${surfaceId}"][data-ui-surface-prepaint]`);
}

function isLeaving(layer: HTMLElement | null): boolean {
    return Boolean(layer && Number(layer.style.zIndex) >= 30);
}

/** The label a button draws, which is what a player aims at. */
function labelNode(root: HTMLElement, label: string): HTMLElement {
    const node = Array.from(root.querySelectorAll<HTMLElement>("*"))
        .filter(candidate => candidate.children.length === 0)
        .find(candidate => candidate.textContent?.trim() === label);
    if (!node) {
        throw new Error(`no "${label}" on screen`);
    }
    return node;
}

/**
 * The box a full-size free-layout panel lays its children out in, which is the first thing of that
 * page a press anywhere over the panel meets - and the element that kept taking presses on a leaving
 * page after its wrappers had stopped.
 */
function panelChildBox(layer: HTMLElement): HTMLElement {
    const box = Array.from(layer.querySelectorAll<HTMLElement>("div")).find(
        candidate => candidate.style.zIndex === "1" && candidate.style.position === "absolute",
    );
    if (!box) {
        throw new Error("no panel on this page");
    }
    return box;
}

/** The element of a page drawn at a point where none of its widgets is: its root. */
function pageBackground(layer: HTMLElement): HTMLElement {
    return layer.querySelector<HTMLElement>(".ui-editor-node-root")!;
}

/** Whether the browser's hit test could stop at this element. */
function takesPointerEvents(node: Element): boolean {
    if (node.closest("[inert]")) {
        return false;
    }
    for (let current: Element | null = node; current; current = current.parentElement) {
        const value = (current as HTMLElement).style?.pointerEvents;
        if (value) {
            return value !== "none";
        }
    }
    return true;
}

/**
 * What a press lands on, given the element of each layer that is topmost at the press point.
 *
 * Under the point, top to bottom, the way the stack paints: each layer - the one with the higher
 * z-index first, a leaving page above the page arriving under it - from that element up through
 * its ancestors; then whatever the box around the stack has put under its layers; then the box; then
 * the stage. The press goes to the first of them that takes pointer events.
 */
function landsOn(game: HTMLElement, topmostPerLayer: readonly HTMLElement[]): Element | null {
    const box = game.querySelector<HTMLElement>("[data-testid='stage'] + div")!;
    const stage = game.querySelector("[data-testid='stage']")!;
    const layerOfNode = (node: HTMLElement) => {
        let current: HTMLElement = node;
        while (current.parentElement && current.parentElement !== box) {
            current = current.parentElement;
        }
        return current;
    };
    const chains = topmostPerLayer
        .map(node => {
            const chain: Element[] = [];
            for (let current: Element | null = node; current && current !== box; current = current.parentElement) {
                chain.push(current);
            }
            return { z: Number(layerOfNode(node).style.zIndex || 0), chain };
        })
        .sort((a, b) => b.z - a.z);
    const underLayers = Array.from(box.children).filter(child => child.hasAttribute("data-ui-surface-stack-exit-guard"));
    const underPoint: Element[] = [...chains.flatMap(item => item.chain), ...underLayers, box, stage];
    return underPoint.find(takesPointerEvents) ?? null;
}

/** Let the renders a reveal or a navigation schedules commit, as they have by a player's next press. */
async function settle(ms = 20): Promise<void> {
    await act(async () => {
        await new Promise(resolve => setTimeout(resolve, ms));
    });
}

beforeAll(() => {
    ensureAnimationFramePolyfill();
    installResizeObserverStub();
    // Without this, `act` does not flush effects and every press below would be made on a render that
    // never settled.
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => cleanup());

describe("a press while a page fades out in favour of another", () => {
    it("reaches the page arriving under it, and the lane then settles on the page it goes back to", async () => {
        const game = createGame();
        const title = navEntry("title");
        game.navigation.reset(title);
        const { container } = render(<game.Game />);
        await waitFor(() => expect(layerOf(container, "title")?.dataset.uiSurfacePrepaint).toBe("ready"));
        await settle();

        fireEvent.click(labelNode(layerOf(container, "title")!, "Settings"));
        await waitFor(() => {
            expect(layerOf(container, "settings")?.dataset.uiSurfacePrepaint).toBe("ready");
            expect(isLeaving(layerOf(container, "title"))).toBe(true);
        });
        await settle();

        // Over Back, the leaving title's full-size panel is on top of Settings' Back button.
        const titleLayer = layerOf(container, "title")!;
        const settingsLayer = layerOf(container, "settings")!;
        const target = landsOn(container, [panelChildBox(titleLayer), labelNode(settingsLayer, "Back")]);
        const titleLeavingAtPress = isLeaving(titleLayer);
        if (target) {
            fireEvent.click(target);
        }

        expect(titleLeavingAtPress).toBe(true);
        expect(game.pageOf("settings").count("back", "mouseClick")).toBe(1);

        // Back returns to a title that is still fading out. The lane has to finish that: the title
        // alone on screen, taking presses again.
        await waitFor(() => expect(layerOf(container, "settings")).toBeNull(), { timeout: 3000 });
        const returned = layerOf(container, "title")!;
        expect(isLeaving(returned)).toBe(false);
        fireEvent.click(labelNode(returned, "Settings"));
        await waitFor(() => expect(layerOf(container, "settings")).not.toBeNull());
    });

    it("leaves nothing on the leaving page that a press can land on", async () => {
        const game = createGame();
        game.navigation.reset(navEntry("title"));
        const { container } = render(<game.Game />);
        await waitFor(() => expect(layerOf(container, "title")?.dataset.uiSurfacePrepaint).toBe("ready"));
        await settle();

        fireEvent.click(labelNode(layerOf(container, "title")!, "Settings"));
        await waitFor(() => {
            expect(layerOf(container, "settings")?.dataset.uiSurfacePrepaint).toBe("ready");
            expect(isLeaving(layerOf(container, "title"))).toBe(true);
        });
        await settle();

        const leaving = layerOf(container, "title")!;
        const pressable = Array.from(leaving.querySelectorAll("*")).filter(takesPointerEvents);
        expect(pressable).toEqual([]);
        // And the page arriving is not caught up in it.
        expect(takesPointerEvents(labelNode(layerOf(container, "settings")!, "Back"))).toBe(true);
    });

    it("lets the page it left finish leaving when a development build replays the moved layer's effects", async () => {
        // Going back to a page that is still leaving reorders the lane - the page returned to is
        // drawn first again - and a development build under StrictMode runs every effect of a moved
        // layer a second time. The page being left must not take that as a reason to hide and
        // arrive again: that restarted its enter animation on top of its exit, which cut the exit
        // short without ever finishing it, and the page stayed on screen, leaving, for good.
        const game = createGame();
        game.navigation.reset(navEntry("title"));
        const { container } = render(
            <StrictMode>
                <game.Game />
            </StrictMode>,
        );
        await waitFor(() => expect(layerOf(container, "title")?.dataset.uiSurfacePrepaint).toBe("ready"));
        await settle();

        await act(async () => {
            void game.openPage("settings");
        });
        await waitFor(() => expect(isLeaving(layerOf(container, "title"))).toBe(true));
        await act(async () => {
            void game.goBack();
        });

        await waitFor(() => expect(layerOf(container, "settings")).toBeNull(), { timeout: 3000 });
        expect(container.querySelector("[data-ui-surface-stack-exit-guard]")).toBeNull();
    });

    it("announces the title leaving again after it came back mid-exit", async () => {
        // A page's own exit handler runs on every departure. The one brought back had already
        // announced its first, and without starting over it said nothing the second time.
        const game = createGame();
        const title = navEntry("title");
        game.navigation.reset(title);
        const { container } = render(<game.Game />);
        await waitFor(() => expect(layerOf(container, "title")?.dataset.uiSurfacePrepaint).toBe("ready"));
        await settle();

        await act(async () => {
            void game.openPage("settings");
        });
        await waitFor(() => expect(isLeaving(layerOf(container, "title"))).toBe(true));
        await act(async () => {
            void game.goBack();
        });
        await waitFor(() => expect(layerOf(container, "settings")).toBeNull(), { timeout: 3000 });
        await settle(700);

        await act(async () => {
            void game.openPage("settings");
        });
        await waitFor(() => expect(isLeaving(layerOf(container, "title"))).toBe(true));
        await settle();

        const titleEvents = game.pageOf("title").surfaceEvents;
        expect(titleEvents.filter(event => event === "beforeSurfaceExit")).toHaveLength(2);
    });
});

describe("a press while a menu over the running game fades out", () => {
    async function openMenuOverGame() {
        // The game has taken the screen: the title is on the stack, hidden, and the menu is opened
        // over the stage.
        const title = navEntry("title");
        const game = createGame({ hiddenForGame: new Set([title.key]) });
        game.navigation.reset(title);
        const view = render(<game.Game />);
        await act(async () => {
            void game.openPage("menu");
        });
        await waitFor(() => expect(layerOf(view.container, "menu")?.dataset.uiSurfacePrepaint).toBe("ready"));
        await settle();
        return { game, container: view.container };
    }

    it("does not advance the story when Close is pressed twice", async () => {
        const { game, container } = await openMenuOverGame();
        const menuLayer = layerOf(container, "menu")!;
        const close = labelNode(menuLayer, "Close");

        fireEvent.click(landsOn(container, [close])!);
        await waitFor(() => expect(isLeaving(layerOf(container, "menu"))).toBe(true));
        await settle();

        const second = landsOn(container, [close]);
        if (second) {
            fireEvent.click(second);
        }

        expect(layerOf(container, "menu")).not.toBeNull();
        expect(game.stage.advances).toBe(0);
    });

    it("does not advance the story on a press beside the menu", async () => {
        const { game, container } = await openMenuOverGame();
        const menuLayer = layerOf(container, "menu")!;

        fireEvent.click(landsOn(container, [labelNode(menuLayer, "Close")])!);
        await waitFor(() => expect(isLeaving(layerOf(container, "menu"))).toBe(true));
        await settle();

        const beside = landsOn(container, [pageBackground(layerOf(container, "menu")!)]);
        if (beside) {
            fireEvent.click(beside);
        }

        expect(layerOf(container, "menu")).not.toBeNull();
        expect(game.stage.advances).toBe(0);
    });

    it("hands presses back to the stage once the menu has gone", async () => {
        const { game, container } = await openMenuOverGame();
        fireEvent.click(landsOn(container, [labelNode(layerOf(container, "menu")!, "Close")])!);
        await waitFor(() => expect(layerOf(container, "menu")).toBeNull(), { timeout: 3000 });

        const target = landsOn(container, []);
        if (target) {
            fireEvent.click(target);
        }

        expect(game.stage.advances).toBe(1);
    });

    it("does not let the leaving menu answer a key", async () => {
        const { game, container } = await openMenuOverGame();
        const menu = game.pageOf("menu");
        // The menu hears keys while it is up, so a silence below is the exit's doing.
        fireEvent.keyDown(window, { key: "Escape", code: "Escape" });
        expect(menu.count("close", "keyDown")).toBeGreaterThan(0);

        fireEvent.click(landsOn(container, [labelNode(layerOf(container, "menu")!, "Close")])!);
        await waitFor(() => expect(isLeaving(layerOf(container, "menu"))).toBe(true));
        await settle();

        const before = menu.count("close", "keyDown");
        fireEvent.keyDown(window, { key: "Escape", code: "Escape" });

        expect(layerOf(container, "menu")).not.toBeNull();
        expect(menu.count("close", "keyDown") - before).toBe(0);
    });
});
