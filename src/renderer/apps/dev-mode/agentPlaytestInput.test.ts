// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import type { UIDocument, UIElement } from "@shared/types/ui-editor/document";
import type { GameAppTestControls } from "@/lib/ui-editor/runtime/app/GameApp";
import { buildGameTestState } from "@/lib/ui-editor/runtime/app/gameTestState";
import { DevModeAgentErrorCode } from "@shared/types/devMode";
import {
    actOnElement,
    keyEventInit,
    listDrawnSurfaces,
    PlaytestPointer,
    pressKey,
    resolveInputTarget,
    type InputBox,
    type InputEnvironment,
} from "./agentPlaytestInput";
import { PLAYTEST_TIMING, runAgentDriveAction, type PlaytestClock } from "./agentPlaytestDrive";

/**
 * An agent's hands on the game (`playtest_click` / `playtest_hover` / `playtest_key`), against a
 * pretend page: surface shells and element nodes marked the way the game marks them, each with a box,
 * and a hit test that answers what is on top at a point the way `elementFromPoint` does - the last
 * drawn box containing it.
 */

type Spec = { id: string; name?: string; type?: string; box?: [number, number, number, number]; text?: string; children?: Spec[] };

function element(id: string, name: string | undefined, type: string, parentId: string | null, childrenIds: string[]): UIElement {
    return { id, name, type, parentId, childrenIds, props: {} } as unknown as UIElement;
}

const boxes = new WeakMap<Element, InputBox>();

function build(surfaces: { id: string; name: string; box: [number, number, number, number]; root: Spec }[]): {
    env: InputEnvironment;
    root: HTMLElement;
    node(id: string, nth?: number): HTMLElement;
    document: UIDocument;
} {
    const root = window.document.createElement("div");
    window.document.body.appendChild(root);
    boxes.set(root, { left: 0, top: 0, width: 1920, height: 1080 });
    const elements: Record<string, UIElement> = {};
    const add = (spec: Spec, parent: HTMLElement, parentId: string | null) => {
        if (!elements[spec.id]) {
            elements[spec.id] = element(spec.id, spec.name, spec.type ?? "nl.container", parentId, (spec.children ?? []).map(child => child.id));
        }
        const node = window.document.createElement("div");
        node.setAttribute("data-ui-element-id", spec.id);
        if (spec.text) {
            node.textContent = spec.text;
        }
        if (spec.box) {
            const [left, top, width, height] = spec.box;
            boxes.set(node, { left, top, width, height });
        }
        parent.appendChild(node);
        for (const child of spec.children ?? []) {
            add(child, node, spec.id);
        }
    };
    for (const surface of surfaces) {
        const shell = window.document.createElement("div");
        shell.setAttribute("data-ui-surface-id", surface.id);
        const [left, top, width, height] = surface.box;
        boxes.set(shell, { left, top, width, height });
        root.appendChild(shell);
        add(surface.root, shell, null);
    }
    const document = {
        surfaces: surfaces.map(surface => ({ id: surface.id, name: surface.name, rootElementId: surface.root.id, kind: "appSurface" })),
        elements,
    } as unknown as UIDocument;
    const env: InputEnvironment = {
        root,
        document,
        measure: node => boxes.get(node) ?? null,
        hitTest: (x, y) => {
            let top: Element | null = null;
            for (const node of Array.from(root.querySelectorAll("*"))) {
                const box = boxes.get(node);
                if (box && x >= box.left && x <= box.left + box.width && y >= box.top && y <= box.top + box.height) {
                    top = node;
                }
            }
            return top;
        },
    };
    return {
        env,
        root,
        document,
        node: (id, nth = 0) => root.querySelectorAll<HTMLElement>(`[data-ui-element-id="${id}"]`)[nth],
    };
}

function record(node: Element): string[] {
    const seen: string[] = [];
    for (const type of ["pointerover", "pointerenter", "pointermove", "pointerdown", "pointerup", "click", "pointerout", "pointerleave", "contextmenu"]) {
        node.addEventListener(type, () => seen.push(type));
    }
    return seen;
}

const titlePage = () => build([{
    id: "title",
    name: "Title",
    box: [0, 0, 1920, 1080],
    root: {
        id: "title-root",
        name: "Root",
        box: [0, 0, 1920, 1080],
        children: [
            {
                id: "menu",
                name: "Menu",
                box: [100, 500, 400, 400],
                children: [
                    { id: "start", name: "Start", type: "nl.button", box: [100, 500, 400, 80], text: "New game" },
                    { id: "load", name: "Load", type: "nl.button", box: [100, 600, 400, 80], text: "Load" },
                    { id: "quit", name: "Button", type: "nl.button", box: [100, 700, 400, 80], text: "Quit" },
                    { id: "extra", name: "Button", type: "nl.button", box: [100, 800, 400, 80], text: "Extra" },
                ],
            },
        ],
    },
}]);

afterEach(() => {
    window.document.body.innerHTML = "";
});

describe("finding an element on screen", () => {
    it("finds one by id, by path, by name and by the words it shows", () => {
        const { env } = titlePage();
        for (const ref of ["start", "Title / Menu / Start", "Menu / Start", "Start", "New game"]) {
            const found = resolveInputTarget(env, { element: ref });
            expect(found.kind === "found" && found.target.element.id, ref).toBe("start");
        }
    });

    it("refuses a name two elements share, listing both with their ids", () => {
        const { env } = titlePage();
        const found = resolveInputTarget(env, { element: "Button" });
        expect(found.kind).toBe("refused");
        const message = found.kind === "refused" ? found.message : "";
        expect(message).toContain("(id quit)");
        expect(message).toContain("(id extra)");
    });

    it("lists what can be pressed when nothing matches", () => {
        const { env } = titlePage();
        const found = resolveInputTarget(env, { element: "Continue" });
        expect(found.kind).toBe("refused");
        expect(found.kind === "refused" && found.message).toContain("Title: Root / Menu / Start (id start)");
    });

    it("asks which row when an element is drawn more than once, and counts rows top to bottom", () => {
        const { env } = build([{
            id: "load-page",
            name: "Load",
            box: [0, 0, 1920, 1080],
            root: {
                id: "load-root",
                name: "Root",
                box: [0, 0, 1920, 1080],
                children: [
                    {
                        id: "slots",
                        name: "Slots",
                        type: "nl.list",
                        box: [0, 100, 1920, 800],
                        children: [
                            // Drawn in the DOM out of screen order on purpose: index counts the screen.
                            { id: "slot", name: "Slot", box: [0, 500, 1920, 300] },
                            { id: "slot", name: "Slot", box: [0, 100, 1920, 300] },
                        ],
                    },
                ],
            },
        }]);
        const ask = resolveInputTarget(env, { element: "Slot" });
        expect(ask.kind === "refused" && ask.message).toContain("Pass `index` 1-2");
        const second = resolveInputTarget(env, { element: "Slot", index: 2 });
        expect(second.kind === "found" && second.target.box.top).toBe(500);
        expect(resolveInputTarget(env, { element: "Slot", index: 3 }).kind).toBe("refused");
    });

    it("narrows to the surface named, and says which surfaces are on screen when it is not one", () => {
        const { env } = titlePage();
        expect(resolveInputTarget(env, { element: "Start", surface: "title" }).kind).toBe("found");
        const wrong = resolveInputTarget(env, { element: "Start", surface: "Settings" });
        expect(wrong.kind === "refused" && wrong.message).toContain('On screen now: "Title"');
    });
});

describe("clicking", () => {
    it("raises a mouse's events on the element, in a mouse's order", () => {
        const { env, node } = titlePage();
        const seen = record(node("start"));
        const found = resolveInputTarget(env, { element: "Start" });
        if (found.kind !== "found") {
            throw new Error("not found");
        }
        expect(actOnElement(env, new PlaytestPointer(), found.target, "click").kind).toBe("done");
        expect(seen).toEqual(["pointerover", "pointerenter", "pointermove", "pointerdown", "pointerup", "click"]);
    });

    it("leaves the element the pointer rested on before it moves to the next", () => {
        const { env, node } = titlePage();
        const pointer = new PlaytestPointer();
        const before = record(node("load"));
        const target = (ref: string) => {
            const found = resolveInputTarget(env, { element: ref });
            if (found.kind !== "found") {
                throw new Error(ref);
            }
            return found.target;
        };
        actOnElement(env, pointer, target("Load"), "hover");
        expect(before).toEqual(["pointerover", "pointerenter", "pointermove"]);
        actOnElement(env, pointer, target("Start"), "click");
        expect(before.slice(3)).toEqual(["pointerout", "pointerleave"]);
    });

    it("refuses an element something else covers, naming what a player would press instead", () => {
        const { env, node } = build([
            {
                id: "title",
                name: "Title",
                box: [0, 0, 1920, 1080],
                root: { id: "title-root", name: "Root", box: [0, 0, 1920, 1080], children: [{ id: "start", name: "Start", box: [100, 500, 400, 80] }] },
            },
            {
                id: "confirm",
                name: "Confirm",
                box: [0, 0, 1920, 1080],
                root: { id: "confirm-root", name: "Root", box: [0, 0, 1920, 1080], children: [{ id: "scrim", name: "Scrim", box: [0, 0, 1920, 1080] }] },
            },
        ]);
        const seen = record(node("start"));
        const found = resolveInputTarget(env, { element: "Start", surface: "Title" });
        if (found.kind !== "found") {
            throw new Error("not found");
        }
        const outcome = actOnElement(env, new PlaytestPointer(), found.target, "click");
        expect(outcome.kind).toBe("refused");
        expect(outcome.kind === "refused" && outcome.message).toContain("covered at that point by Confirm: Root / Scrim (id scrim)");
        expect(seen).toEqual([]);
    });

    it("aims at the share of the box `at` names", () => {
        const { env, node } = build([{
            id: "settings",
            name: "Settings",
            box: [0, 0, 1920, 1080],
            root: {
                id: "settings-root",
                name: "Root",
                box: [0, 0, 1920, 1080],
                children: [{ id: "volume", name: "Volume", type: "nl.slider", box: [100, 100, 1000, 40] }],
            },
        }]);
        let clientX = -1;
        node("volume").addEventListener("pointerdown", event => {
            clientX = (event as MouseEvent).clientX;
        });
        const found = resolveInputTarget(env, { element: "Volume" });
        if (found.kind !== "found") {
            throw new Error("not found");
        }
        actOnElement(env, new PlaytestPointer(), found.target, "click", { x: 0.8, y: 0.5 });
        expect(clientX).toBe(900);
    });
});

describe("keys", () => {
    it("spells keys the way a keyboard does", () => {
        expect(keyEventInit("Space")).toEqual({ key: " ", code: "Space" });
        expect(keyEventInit("Escape")).toEqual({ key: "Escape", code: "Escape" });
        expect(keyEventInit("q")).toEqual({ key: "q", code: "KeyQ" });
        expect(keyEventInit("3")).toEqual({ key: "3", code: "Digit3" });
        expect(keyEventInit("Hyper")).toBeNull();
    });

    it("sends the key where the game's own listener on the window hears it", () => {
        const { env } = titlePage();
        const heard: string[] = [];
        const listener = (event: KeyboardEvent) => heard.push(`${event.type}:${event.code}:${event.target === window.document.body}`);
        window.addEventListener("keydown", listener);
        window.addEventListener("keyup", listener);
        try {
            pressKey(env, { key: "Escape", code: "Escape" });
        } finally {
            window.removeEventListener("keydown", listener);
            window.removeEventListener("keyup", listener);
        }
        expect(heard).toEqual(["keydown:Escape:true", "keyup:Escape:true"]);
    });

    it("sends it to the focused control when one in the game holds the focus, never to a panel outside it", () => {
        const { env, node } = titlePage();
        const control = node("start");
        control.tabIndex = 0;
        control.focus();
        let target: EventTarget | null = null;
        window.addEventListener("keydown", event => {
            target = event.target;
        }, { once: true });
        pressKey(env, { key: "Enter", code: "Enter" });
        expect(target).toBe(control);

        const panelField = window.document.createElement("input");
        window.document.body.appendChild(panelField);
        panelField.focus();
        window.addEventListener("keydown", event => {
            target = event.target;
        }, { once: true });
        pressKey(env, { key: "Enter", code: "Enter" });
        expect(target).toBe(window.document.body);
    });
});

describe("a pointer act, start to answer", () => {
    const clock = (): PlaytestClock => {
        let now = 0;
        return {
            now: () => now,
            sleep: async ms => {
                now += ms;
                await Promise.resolve();
            },
            requestFrame: callback => queueMicrotask(callback),
        };
    };

    function controlsFor(page: ReturnType<typeof titlePage>): GameAppTestControls {
        return {
            startStory: async () => undefined,
            advance: async () => undefined,
            choose: async () => undefined,
            capture: async () => null,
            readState: () => buildGameTestState({
                inGame: false,
                entries: 0,
                dialog: undefined,
                prompt: null,
                choices: null,
                endings: 0,
                lastEnding: null,
                page: "Title",
            }),
            readGameRoot: () => page.root,
            readUiDocument: () => page.document,
        };
    }

    it("says what the click opened, once the screen has settled", async () => {
        const page = titlePage();
        // The Load button opens a page a little later, as a graph run and a transition would.
        page.node("load").addEventListener("click", () => {
            setTimeout(() => undefined, 0);
            queueMicrotask(() => {
                const shell = window.document.createElement("div");
                shell.setAttribute("data-ui-surface-id", "load-page");
                boxes.set(shell, { left: 0, top: 0, width: 1920, height: 1080 });
                page.root.appendChild(shell);
            });
        });
        (page.document.surfaces as unknown[]).push({ id: "load-page", name: "Load", rootElementId: "x", kind: "appSurface" });
        const controls = controlsFor(page);
        const result = await runAgentDriveAction(
            () => controls,
            { kind: "pointer", gesture: "click", element: "Load", surface: "Title" },
            clock(),
            PLAYTEST_TIMING,
            { environment: () => page.env, pointer: new PlaytestPointer() },
        );
        expect(result.success).toBe(true);
        if (!result.success || result.data.kind !== "input") {
            throw new Error("no input answer");
        }
        expect(result.data.did).toBe("Clicked Title: Root / Menu / Load (id load).");
        expect(result.data.surfaces).toEqual(["Title", "Load"]);
        expect(result.data.changed).toEqual(['now showing "Load"']);
        expect(listDrawnSurfaces(page.env)).toEqual(["Title", "Load"]);
    });

    it("attaches the run's warnings to the answer, as the issue strip counts them", async () => {
        const page = titlePage();
        const controls = controlsFor(page);
        const issue = { level: "warning" as const, message: "Nothing is wired to Value.", scene: "Opening", row: 3 };
        const result = await runAgentDriveAction(
            () => controls,
            { kind: "state" },
            clock(),
            PLAYTEST_TIMING,
            { readIssues: () => [issue] },
        );
        expect(result.success && result.data.kind === "state" && result.data.issues).toEqual([issue]);
    });

    it("refuses an unknown element with the code the tool turns into an argument error", async () => {
        const page = titlePage();
        const controls = controlsFor(page);
        const result = await runAgentDriveAction(
            () => controls,
            { kind: "pointer", gesture: "click", element: "Continue" },
            clock(),
            PLAYTEST_TIMING,
            { environment: () => page.env, pointer: new PlaytestPointer() },
        );
        expect(result.success).toBe(false);
        expect(!result.success && result.code).toBe(DevModeAgentErrorCode.inputTarget);
    });

    it("refuses a key it does not know, listing the ones it does", async () => {
        const page = titlePage();
        const controls = controlsFor(page);
        const result = await runAgentDriveAction(
            () => controls,
            { kind: "key", key: "Hyper" },
            clock(),
            PLAYTEST_TIMING,
            { environment: () => page.env, pointer: new PlaytestPointer() },
        );
        expect(!result.success && result.error).toContain("Escape, Enter, Space");
    });

    it("right-clicks the middle of the game for rightClick", async () => {
        const page = titlePage();
        const controls = controlsFor(page);
        const seen = record(page.node("title-root"));
        const result = await runAgentDriveAction(
            () => controls,
            { kind: "key", key: "rightClick" },
            clock(),
            PLAYTEST_TIMING,
            { environment: () => page.env, pointer: new PlaytestPointer() },
        );
        expect(result.success).toBe(true);
        // The middle of a 1920x1080 game is not on the menu, so the root takes it.
        expect(seen).toContain("contextmenu");
        expect(seen).not.toContain("click");
    });
});
