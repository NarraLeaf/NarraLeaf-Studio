import path from "node:path";
import { describe, expect, it } from "vitest";
import ts from "typescript";
import { SCRIPT_API_DECLARATIONS } from "./scriptApiDeclarations.generated";
import { renderProjectDeclarations, type ScriptProjectFacts } from "./scriptDeclarations";
import { renderScriptsTsconfig } from "./scriptsDirectory";

/**
 * The two halves of a script's declarations, compiled together with a script written against them.
 *
 * The other declaration tests read the text; this one asks the compiler, because the question for a
 * plugin's widget is one only the compiler answers: whether the project half's second declaration
 * of `PluginScriptWidgets` merges into the host half's, so that `WidgetCtx<"<plugin type>">` and its
 * events type-check in a project that uses the widget - and a misspelt or foreign event still does
 * not. Compiled with the options Studio writes into the author's `scripts/tsconfig.json`.
 */

const RATING = "probe.heads.rating";

const FACTS: ScriptProjectFacts = {
    surfaces: [{
        id: "title",
        name: "Title",
        elements: [
            { id: "stars", name: "Stars", type: RATING },
            { id: "start", name: "Start", type: "nl.button" },
            // A plugin widget whose plugin is not loaded right now: named, but given no context.
            { id: "ghost", name: "Ghost", type: "absent.plugin.widget", scriptable: false },
        ],
    }],
    components: [],
    characters: [],
    stories: [],
    scenes: [],
    savedVariables: [],
    persistentVariables: [],
    audioTracks: [],
    inputActions: [],
    locales: [],
    pluginWidgets: [{
        type: RATING,
        displayName: "Rating",
        pluginId: "probe.heads",
        events: [
            { id: "mouseClick", builtin: true },
            { id: "elementClick", builtin: true },
            { id: "rated", builtin: false, fields: { stars: "number", label: "string", extra: "unknown" } },
        ],
    }],
};

const SCRIPT = `
import type { TitleStarsCtx, WidgetCtx, WidgetEvent, WidgetHandler, WidgetScriptModule } from "@narraleaf/script";

export function onRated(ctx: WidgetCtx<"${RATING}">, event: WidgetEvent<"${RATING}", "rated">): void {
    const stars: number = event.stars;
    const label: string = event.label;
    ctx.vars.last = stars + label.length;
    const self: "${RATING}" = ctx.self.widgetType;
    void self;
}

export const onMouseClick: WidgetHandler<"${RATING}", "mouseClick"> = (ctx: TitleStarsCtx, event) => {
    const x: number = event.x;
    void ctx.self.elementId;
    void x;
};

const module: WidgetScriptModule<"${RATING}"> = { onRated, onMouseClick };
void module;

// @ts-expect-error a plugin widget has only the events its declaration gives it
export const onSliderValueChanged: WidgetHandler<"${RATING}", "sliderValueChanged"> = () => undefined;

// @ts-expect-error the payload is the plugin's, field by field
export function onRatedWrongly(_ctx: unknown, event: WidgetEvent<"${RATING}", "rated">): string { return event.stars; }

// @ts-expect-error a widget type nothing declares is not one
export type Nowhere = WidgetCtx<"absent.plugin.widget">;

// @ts-expect-error a module exporting a handler its widget never calls is refused at the literal
export const wrongModule: WidgetScriptModule<"${RATING}"> = { onSwitchChanged() {} };
`;

function compile(files: Record<string, string>): string[] {
    const parsed = ts.parseConfigFileTextToJson("tsconfig.json", renderScriptsTsconfig());
    const { options } = ts.convertCompilerOptionsFromJson(parsed.config.compilerOptions, "/scripts");
    const root = path.resolve("/virtual/scripts");
    const virtual = new Map(Object.entries(files).map(([name, text]) => [path.join(root, name), text]));
    const host = ts.createCompilerHost(options);
    const baseGetSourceFile = host.getSourceFile.bind(host);
    host.getSourceFile = (fileName, languageVersion, onError, shouldCreate) => {
        const text = virtual.get(path.resolve(fileName));
        return text !== undefined
            ? ts.createSourceFile(fileName, text, languageVersion, true)
            : baseGetSourceFile(fileName, languageVersion, onError, shouldCreate);
    };
    const baseFileExists = host.fileExists.bind(host);
    host.fileExists = fileName => virtual.has(path.resolve(fileName)) || baseFileExists(fileName);
    const baseReadFile = host.readFile.bind(host);
    host.readFile = fileName => virtual.get(path.resolve(fileName)) ?? baseReadFile(fileName);
    const program = ts.createProgram([...virtual.keys()], { ...options, noEmit: true }, host);
    return ts.getPreEmitDiagnostics(program).map(diagnostic => {
        const where = diagnostic.file ? `${path.basename(diagnostic.file.fileName)}:` : "";
        return `${where} ${ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")}`;
    });
}

describe("a script on a plugin's widget, as the compiler sees it", () => {
    it("types the widget's own events and refuses anything else", () => {
        const diagnostics = compile({
            ".narraleaf/script.d.ts": SCRIPT_API_DECLARATIONS,
            ".narraleaf/project.d.ts": renderProjectDeclarations(FACTS),
            "stars.ts": SCRIPT,
        });
        // Every `@ts-expect-error` above is used, and nothing else is reported: an unused one would
        // be a diagnostic of its own, so an empty list proves both halves.
        expect(diagnostics).toEqual([]);
    }, 60_000);

    it("is a compile that reports what is wrong, so an empty list above means something", () => {
        // Without the plugin half, the same script names a widget type nothing declares.
        const diagnostics = compile({
            ".narraleaf/script.d.ts": SCRIPT_API_DECLARATIONS,
            ".narraleaf/project.d.ts": renderProjectDeclarations({ ...FACTS, pluginWidgets: [] }),
            "stars.ts": SCRIPT,
        });
        expect(diagnostics.some(line => line.startsWith("stars.ts:") && line.includes(RATING))).toBe(true);
    }, 60_000);

    it("gives an element of a widget nobody declares no context alias", () => {
        const rendered = renderProjectDeclarations(FACTS);
        expect(rendered).toContain("type TitleStarsCtx = WidgetCtx<\"probe.heads.rating\">;");
        expect(rendered).not.toContain("absent.plugin.widget\">;");
        // Still an element of the page by id, which is what `ctx.host.widget.*` takes.
        expect(rendered).toContain("\"ghost\"");
    });
});
