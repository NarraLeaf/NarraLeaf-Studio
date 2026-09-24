/**
 * What a blueprint says when it stops while the game is running.
 *
 * The message a node, the host API it calls or the executor throws is shown to the author as it is:
 * the Dev Mode issues list and its one-line strip print `execution.error.message` verbatim. So every
 * such sentence is written in the author's language at the throw site, through the
 * `blueprint.runtimeError.*` catalog, and never carries an id - an element, node, page or function id
 * is something an author cannot act on, and the interface never shows a UUID.
 *
 * Three guards, each for a way this has gone wrong before:
 *  1. a throw site that builds its message from an English literal (the sweep that introduced this
 *     file found about a hundred and fifty);
 *  2. a catalog template with an id-shaped placeholder, which is how an id gets back in through a
 *     message that is otherwise translated;
 *  3. real executions, in English and in Chinese, checked for what an author would actually read.
 *
 * Comments in English per project convention.
 */

import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CATALOGS, createTranslator, type Locale } from "@shared/i18n";
import { i18nStore } from "@/lib/i18n";
import {
    BLUEPRINT_NODE_TYPE_GAME_NEXT,
    BLUEPRINT_NODE_TYPE_LITERAL_STRING,
    BLUEPRINT_NODE_TYPE_LOCALIZATION_SET_LANGUAGE,
} from "@shared/types/blueprint/graph";
import { UI_DOCUMENT_SCHEMA_VERSION, type UIDocument } from "@shared/types/ui-editor/document";
import type { UIGraph } from "@shared/types/ui-editor/graph";
import type { UIHostAdapter } from "@/lib/ui-editor/runtime/types";
import { WidgetRuntimeStateStore } from "@/lib/ui-editor/runtime/appearance/WidgetRuntimeStateStore";
import { executeGraph } from "../behavior-graph/GraphExecutor";
import { createDevModeBlueprintHostApi, type GameLocalizationConfigSnapshot } from "./BlueprintHostApiBridge";
import { ScopeStoreBridge } from "./ScopeStoreBridge";

const UI_EDITOR_ROOT = path.resolve(__dirname, "..");
const SCANNED_DIRS = ["blueprint-nodes", "blueprint-runtime", "behavior-graph"];

function sourceFiles(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            return sourceFiles(full);
        }
        return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [full] : [];
    });
}

type Site = { file: string; line: number; argument: string };

/** Every `<opener>` in the scanned sources, with the first 120 characters of its argument. */
function findSites(opener: RegExp): Site[] {
    const sites: Site[] = [];
    for (const dir of SCANNED_DIRS) {
        for (const file of sourceFiles(path.join(UI_EDITOR_ROOT, dir))) {
            const text = fs.readFileSync(file, "utf-8");
            for (const match of text.matchAll(opener)) {
                const start = match.index! + match[0].length;
                sites.push({
                    file: path.relative(UI_EDITOR_ROOT, file).split(path.sep).join("/"),
                    line: text.slice(0, match.index).split("\n").length,
                    argument: text.slice(start, start + 120).trimStart(),
                });
            }
        }
    }
    return sites;
}

/**
 * The execution errors whose message is not written at the throw site, each because it is carried
 * from somewhere that already wrote it in the author's language. Keyed by file, matched on how the
 * argument begins.
 */
const EXECUTION_ERROR_PASS_THROUGH: Record<string, readonly string[]> = {
    // The executor's wrap of whatever a node threw: the bridge's message, which is translated, or an
    // author's own script or plugin, which is theirs to word.
    "behavior-graph/GraphExecutor.ts": ["message, nodeId"],
    // Show Layer and Show Confirm put the bridge's refusal on the node that asked; the bridge wrote it.
    "blueprint-nodes/built-in/layerNodes.ts": ["error instanceof Error ? error.message : String(error)"],
    // `validateBlueprintValueGraphSafe` returns sentences it has already translated.
    "blueprint-runtime/BlueprintValueEvaluator.ts": ["safetyErrors[0]!"],
};

/**
 * Plain `Error`s that stay English, because no authored graph can raise them: each is a check on
 * code, raised to the developer who wrote that code. Matched on how the message literal begins.
 */
const PROGRAMMER_INVARIANTS: readonly string[] = [
    // Node definitions checked as they are registered - Studio's own, or a plugin developer's.
    "`[BlueprintNodeRegistry] ",
    "\"[effectivePins] ",
    // Token builders whose output is fixed by their own inputs.
    "\"Failed to create Displayable animation token\"",
    "\"Failed to create Delay timer token\"",
    // Graph validation calls this and catches it; every graph the editor saves has an entry.
    "\"The graph has no entries\"",
];

function describeSite(site: Site): string {
    return `${site.file}:${site.line}  ${site.argument.split("\n")[0]}`;
}

describe("runtime error wording: throw sites", () => {
    it("words every execution error through the catalog", () => {
        const sites = findSites(/new BlueprintGraphExecutionError\(/g);
        // Not a vacuous pass: the scan has to be seeing the hundred-odd sites that exist.
        expect(sites.length).toBeGreaterThan(80);
        const offenders = sites.filter(site => {
            if (site.argument.startsWith("translate(")) {
                return false;
            }
            return !(EXECUTION_ERROR_PASS_THROUGH[site.file] ?? []).some(prefix => site.argument.startsWith(prefix));
        });
        expect(offenders.map(describeSite)).toEqual([]);
    });

    it("words the super message of every execution error subclass through the catalog", () => {
        // A subclass puts its message in `super(...)`, which the scan above does not see. The step
        // limit is the one exception: its English sentence is for a shipped game's log, and the host
        // words the issue from the numbers and names it carries instead.
        const sites = findSites(/extends BlueprintGraphExecutionError \{[\s\S]*?super\(/g);
        expect(sites.length).toBeGreaterThanOrEqual(2);
        const offenders = sites
            .filter(site => !site.argument.startsWith("translate("))
            .filter(site => !site.argument.startsWith("`\"${nodeName}\" in \"${headName}\" was stopped"));
        expect(offenders.map(describeSite)).toEqual([]);
    });

    it("words every plain error through the catalog, or is a check on code", () => {
        const sites = findSites(/new Error\(/g);
        expect(sites.length).toBeGreaterThan(80);
        const offenders = sites.filter(site =>
            !site.argument.startsWith("translate(")
            && !PROGRAMMER_INVARIANTS.some(prefix => site.argument.startsWith(prefix)));
        expect(offenders.map(describeSite)).toEqual([]);
    });

    it("keeps the host API bridge free of any error it words itself", () => {
        // What a node's host call throws is the issue an author reads, and the bridge has no
        // programmer invariants to excuse: every one of its errors goes through the catalog.
        const bridge = findSites(/new Error\(/g).filter(site => site.file === "blueprint-runtime/BlueprintHostApiBridge.ts");
        expect(bridge.length).toBeGreaterThan(0);
        expect(bridge.filter(site => !site.argument.startsWith("translate(")).map(describeSite)).toEqual([]);
    });
});

const LOCALES = Object.keys(CATALOGS) as Locale[];

function runtimeErrorTemplates(locale: Locale): Record<string, string> {
    const namespace = (CATALOGS[locale] as unknown as { blueprint?: { runtimeError?: Record<string, string> } })
        .blueprint?.runtimeError;
    return namespace ?? {};
}

describe("runtime error wording: the catalog", () => {
    it.each(LOCALES)("%s has no placeholder that would carry an id", locale => {
        const templates = runtimeErrorTemplates(locale);
        expect(Object.keys(templates).length).toBeGreaterThan(0);
        const idShaped = Object.entries(templates).flatMap(([key, template]) =>
            [...template.matchAll(/\{(\w+)\}/g)]
                .map(match => match[1]!)
                .filter(name => /(?:Id|id|ID|Ref|ref)$/.test(name))
                .map(name => `${key}: {${name}}`));
        expect(idShaped).toEqual([]);
    });

    it.each(LOCALES.filter(locale => locale !== "en"))("%s says nothing in English", locale => {
        // Placeholders and the quoted values an author types (`“fade”`) are not sentences; anything
        // else with two ASCII words in a row is English left behind.
        const english = Object.entries(runtimeErrorTemplates(locale)).filter(([, template]) => {
            const prose = template.replace(/\{\w+\}/g, "").replace(/[“「][^”」]*[”」]/g, "");
            return /[A-Za-z]{2,}[\s,]+[A-Za-z]{2,}/.test(prose);
        });
        expect(english.map(([key]) => key)).toEqual([]);
    });
});

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const LONG_HEX = /[0-9a-f]{32,}/i;
/** Three ASCII words in a row: a sentence, or the rest of one, that was never translated. */
const ASCII_SENTENCE = /[A-Za-z]{2,}(?:[\s,.:]+[A-Za-z]{2,}){2,}/;

const SLIDER_ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const MISSING_ID = "9b2d3f4e-1a6c-4e8b-b7d5-2f0c1e9a8d63";
const SURFACE_ID = "0f8fad5b-d9cb-469f-a165-70867728950e";

function documentWithASlider(): UIDocument {
    return {
        schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
        id: "doc",
        name: "Doc",
        surfaces: [
            {
                id: SURFACE_ID,
                name: "Title",
                host: "app",
                kind: "appSurface",
                designSize: { width: 320, height: 180 },
                rootElementId: "root",
            },
        ],
        elements: {
            root: {
                id: "root",
                type: "nl.root",
                parentId: null,
                childrenIds: [SLIDER_ID],
                layout: { x: 0, y: 0, width: 320, height: 180 },
            },
            [SLIDER_ID]: {
                id: SLIDER_ID,
                type: "nl.slider",
                name: "Volume",
                parentId: "root",
                childrenIds: [],
                layout: { x: 0, y: 0, width: 100, height: 20 },
            },
        },
    } as unknown as UIDocument;
}

/** The Dev Mode host API with nothing behind it: no story running, no window, no saves. */
function hostApiWithNoGame() {
    return createDevModeBlueprintHostApi({
        document: documentWithASlider(),
        scope: new ScopeStoreBridge(),
        activeSurfaceId: SURFACE_ID,
        emit: () => undefined,
        onOpenSurface: () => undefined,
        onPageBack: () => undefined,
        onWidgetPatch: () => undefined,
        widgetRuntimeStore: new WidgetRuntimeStateStore(),
    });
}

function hostAdapterFor(hostApi: unknown): UIHostAdapter {
    return {
        host: "player",
        blueprintRuntime: {
            surfaceId: SURFACE_ID,
            setSurfaceState: () => undefined,
            getSurfaceState: () => undefined,
            emitDebug: () => undefined,
            dispatchElementBlueprintEvent: async () => undefined,
            hostApi,
        },
    } as unknown as UIHostAdapter;
}

const LANGUAGES: GameLocalizationConfigSnapshot = {
    sourceLocale: "en",
    locales: [{ code: "en", displayName: "English" }],
    tables: {},
    keys: {},
};

async function messageOf(run: () => Promise<unknown> | unknown): Promise<string> {
    try {
        await run();
    } catch (err) {
        return err instanceof Error ? err.message : String(err);
    }
    throw new Error("expected the run to fail");
}

/** Three failures an author meets in practice, each as the sentence the issues list would show. */
async function representativeMessages(): Promise<Record<string, string>> {
    const setLanguage: UIGraph = {
        id: "setLanguage",
        entries: { main: { start: { nodeId: "set", port: "in" } } },
        nodes: {
            code: { id: "code", type: BLUEPRINT_NODE_TYPE_LITERAL_STRING, params: { value: "fr" } },
            set: { id: "set", type: BLUEPRINT_NODE_TYPE_LOCALIZATION_SET_LANGUAGE, params: {} },
        },
        edges: [{ from: { nodeId: "code", port: "value" }, to: { nodeId: "set", port: "language" } }],
    } as UIGraph;
    const next: UIGraph = {
        id: "next",
        entries: { main: { start: { nodeId: "next", port: "in" } } },
        nodes: { next: { id: "next", type: BLUEPRINT_NODE_TYPE_GAME_NEXT, params: {} } },
        edges: [],
    } as UIGraph;
    const localizationOnly = {
        localization: { getConfig: () => LANGUAGES, getLocale: async () => "en", setLocale: async () => undefined },
    };
    const hostApi = hostApiWithNoGame();
    return {
        unknownLanguage: await messageOf(() => executeGraph({
            graph: setLanguage,
            entry: setLanguage.entries.main!,
            hostAdapter: hostAdapterFor(localizationOnly),
            blueprintLocals: {},
        })),
        noGame: await messageOf(() => executeGraph({
            graph: next,
            entry: next.entries.main!,
            hostAdapter: hostAdapterFor(hostApi),
            blueprintLocals: {},
        })),
        missingElement: await messageOf(() => hostApi.widget.setVisible(MISSING_ID, false)),
        wrongWidget: await messageOf(() => hostApi.widget.getTextProperties(SLIDER_ID)),
    };
}

describe("runtime error wording: what an author reads", () => {
    afterEach(() => {
        i18nStore.setLocale("en");
    });

    it("names things, never their ids, in English", async () => {
        const messages = await representativeMessages();
        expect(messages).toEqual({
            unknownLanguage: "“fr” is not one of this project's languages.",
            noGame: "“Next” needs a running game.",
            missingElement: "The element was not found on this page.",
            wrongWidget: "“Volume” is not a widget of type Text.",
        });
        for (const message of Object.values(messages)) {
            expect(message).not.toMatch(UUID);
            expect(message).not.toMatch(LONG_HEX);
        }
    });

    it("says the same in the author's language, with no English left in it", async () => {
        i18nStore.setLocale("zh");
        const messages = await representativeMessages();
        for (const [name, message] of Object.entries(messages)) {
            expect(message, name).not.toMatch(UUID);
            expect(message, name).not.toMatch(LONG_HEX);
            expect(message, name).not.toMatch(ASCII_SENTENCE);
        }
        // Spot checks that the node and the widget kind are named in the same language as the rest.
        const zh = createTranslator("zh").t;
        expect(messages.noGame).toBe(zh("blueprint.runtimeError.needsGame", { node: zh("blueprint.node.next") }));
        expect(messages.noGame).not.toContain("Next");
        expect(messages.wrongWidget).toBe(zh("blueprint.runtimeError.widgetWrongKind", {
            element: "Volume",
            kind: zh("blueprint.category.text"),
        }));
    });
});
