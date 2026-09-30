/**
 * `--plugin <dir>`: what a plugin's widgets declare, for a tool that otherwise knows only Studio's.
 *
 * The interface tool reads the widget module registry the editor reads, and a plugin's widget is
 * not in it until the plugin runs - which it never did here, so every plugin widget type was
 * `ui.unknown_widget_type`, and nothing could say what one holds. A widget that declares part slots
 * refuses any child that is not one of its parts in the editor; `check` could not agree, because it
 * had no way to know the declaration existed.
 *
 * So the plugin runs, once, the way Studio runs it: its manifest names the studio entry, the entry
 * is evaluated, and its `setup(app)` is called with an `app` that records what it registers. Each
 * widget it registers goes through the same `sanitizePluginWidgetDeclaration` the workspace's
 * registration uses and into the same registry, owned by the plugin - so every shared answer
 * (`uiElementTypeAcceptsChildren`, `getUIStructuralChildSlot`, `getWidgetLogicApi`) comes from
 * `contributedWidgets.ts` exactly as it does in the editor. No second catalogue.
 *
 * # What it is and is not
 *
 * The `app` is a recorder, not Studio: `widgets.register` / `registerMany` are the only calls that do
 * anything, every other service answers with an inert stand-in, and nothing a plugin renders or
 * registers besides its widgets is used. What is read of a widget is its declaration and its
 * `createDefaultElement` / `createDefaultChildElements`, which `ui widget` reads for any widget.
 *
 * **The plugin's code runs in this process, with this process's rights** - Studio's permission gate
 * is not here to narrow it. That is the trust a developer already extends to their own plugin when
 * they build it, and `--plugin` is only ever a directory the caller names; nothing is discovered.
 *
 * Synchronous, because the commands are: the entry is transpiled to CommonJS and evaluated in place.
 * A `setup` that awaits before it registers its widgets registers them after this has looked, and
 * that is said rather than passed over.
 *
 * Comments in English per project convention.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { transformSync } from "esbuild";
import * as React from "react";
import * as JsxRuntime from "react/jsx-runtime";
import type { PluginWidgetModule } from "@/lib/plugins/pluginWidgetApi";
import { sanitizePluginWidgetDeclaration } from "@/lib/plugins/pluginWidgetGuard";
import { widgetModuleRegistry } from "@/lib/ui-editor/widget-modules/registryInstance";
import type { UIWidgetModule } from "@/lib/ui-editor/widget-modules/types";

export class CliPluginError extends Error {}

export type LoadedCliPlugin = {
    id: string;
    name: string;
    dir: string;
    widgetTypes: string[];
    /** Things the caller should hear about: a widget left out, a setup that went asynchronous. */
    notes: string[];
};

type ManifestLike = {
    id?: unknown;
    name?: unknown;
    entries?: { studio?: unknown };
    contributes?: { widgets?: unknown };
};

/**
 * An inert stand-in for anything a plugin reaches for at setup that this tool does not provide.
 *
 * Callable, so `const dispose = app.services.ui.panels.register(...)` returns something a later
 * `dispose()` can call, and every property of it is another stand-in, so a chain of any length
 * resolves. It is never a thenable - an `await` on it would otherwise wait forever.
 */
function inert(): unknown {
    const target = function inertStandIn() {
        return undefined;
    };
    const handler: ProxyHandler<typeof target> = {
        get: (_target, key) => {
            if (key === "then") {
                return undefined;
            }
            if (key === Symbol.toPrimitive) {
                return () => "";
            }
            if (key === Symbol.iterator) {
                return function* empty() {};
            }
            return proxy;
        },
        apply: () => proxy,
        construct: () => proxy as object,
    };
    const proxy: unknown = new Proxy(target, handler);
    return proxy;
}

/** A module whose named exports are the given ones, and an inert stand-in for any other name. */
function moduleWith(exports: Record<string, unknown>): Record<string, unknown> {
    return new Proxy({ __esModule: true, ...exports } as Record<string, unknown>, {
        get: (target, key) => (key in target ? target[key as string] : typeof key === "string" ? inert() : undefined),
    });
}

const identity = <T,>(definition: T): T => definition;

/**
 * The bare specifiers a plugin entry imports, which Studio resolves through an import map. React is
 * the real one, because a widget's `createDefaultElement` may build an element tree; the two plugin
 * API modules are `define*` and stand-ins, because nothing here calls into Studio.
 */
function resolveSpecifier(specifier: string): unknown {
    switch (specifier) {
        case "react":
            return React;
        case "react/jsx-runtime":
        case "react/jsx-dev-runtime":
            return JsxRuntime;
        case "narraleaf-studio/plugin":
            return moduleWith({ definePlugin: identity, isPluginDefinition: () => true });
        case "narraleaf-studio/runtime":
            return moduleWith({ defineRuntimePlugin: identity });
        case "react-dom":
        case "react-dom/client":
            return moduleWith({});
        default:
            throw new CliPluginError(
                `imports "${specifier}", which Studio does not provide to a plugin; a plugin bundles everything `
                    + "but the plugin API and React into its entry",
            );
    }
}

function readManifest(dir: string): ManifestLike {
    const file = path.join(dir, "manifest.json");
    let text: string;
    try {
        text = fs.readFileSync(file, "utf8");
    } catch {
        throw new CliPluginError(`No manifest.json in ${dir}. --plugin takes a plugin's own directory.`);
    }
    try {
        return JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text) as ManifestLike;
    } catch (error) {
        throw new CliPluginError(`${file} is not JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
}

/** Transpile the entry to CommonJS and evaluate it, answering its module object. */
function evaluateEntry(file: string): Record<string, unknown> {
    // The command bundle keeps esbuild external - its JavaScript API cannot be bundled - so this is
    // the checkout's own esbuild, the one that built the bundle.
    const source = fs.readFileSync(file, "utf8");
    const { code } = transformSync(source, { loader: "js", format: "cjs", target: "node20", sourcefile: file });
    const module: { exports: Record<string, unknown> } = { exports: {} };
    const run = new Function("module", "exports", "require", "__filename", "__dirname", code);
    run(module, module.exports, resolveSpecifier, file, path.dirname(file));
    return module.exports;
}

/** The recording `app` a plugin's setup is handed. */
function recordingApp(manifest: ManifestLike, registered: PluginWidgetModule[]): unknown {
    const widgets = {
        register: (module: PluginWidgetModule) => {
            registered.push(module);
            return inert();
        },
        registerMany: (modules: PluginWidgetModule[]) => {
            registered.push(...(Array.isArray(modules) ? modules : []));
            return inert();
        },
    };
    const services = new Proxy({ widgets } as Record<string, unknown>, {
        get: (target, key) => (key in target ? target[key as string] : inert()),
    });
    const app: Record<string, unknown> = {
        plugin: { id: manifest.id, name: manifest.name, version: (manifest as { version?: unknown }).version },
        manifest,
        services,
    };
    return new Proxy(app, { get: (target, key) => (key in target ? target[key as string] : inert()) });
}

/**
 * The host's side of a plugin widget, as this tool needs it: the declaration, the two builders
 * `ui widget` reads, and nothing that draws.
 */
function toWidgetModule(pluginId: string, module: PluginWidgetModule): UIWidgetModule {
    const { logicApi, acceptsChildren, partSlots } = sanitizePluginWidgetDeclaration(pluginId, module);
    let displayName = module.type;
    try {
        displayName = module.displayName || module.type;
    } catch {
        // A getter that throws names the widget by its type.
    }
    return {
        type: module.type,
        extends: module.extends,
        logicApi,
        acceptsChildren,
        ...(partSlots.length > 0 ? { partSlots } : {}),
        displayName,
        icon: module.icon,
        createDefaultElement: () => module.createDefaultElement(),
        ...(module.createDefaultChildElements
            ? { createDefaultChildElements: (context: Parameters<NonNullable<UIWidgetModule["createDefaultChildElements"]>>[0]) =>
                module.createDefaultChildElements!(context) }
            : {}),
        render: () => null,
    };
}

/**
 * Load one plugin directory and put its widgets in the registry, owned by the plugin.
 *
 * Refuses, rather than half-loading, a directory that is not a plugin or an entry that does not
 * evaluate: a check that ran without the declarations the caller asked for would answer about a
 * different project than the one they meant.
 */
export function loadCliPlugin(dirArg: string): LoadedCliPlugin {
    const dir = path.resolve(dirArg);
    const manifest = readManifest(dir);
    const id = typeof manifest.id === "string" ? manifest.id : "";
    if (!id) {
        throw new CliPluginError(`${path.join(dir, "manifest.json")} names no plugin id.`);
    }
    const name = typeof manifest.name === "string" && manifest.name ? manifest.name : id;
    const entry = typeof manifest.entries?.studio === "string" ? manifest.entries.studio : "";
    if (!entry) {
        // A runtime-only plugin contributes no widget modules to the editor, so it has nothing to say
        // about what a widget holds.
        return { id, name, dir, widgetTypes: [], notes: [`${name} has no studio entry, so it declares no widgets here.`] };
    }

    const entryFile = path.resolve(dir, entry);
    let exported: Record<string, unknown>;
    try {
        exported = evaluateEntry(entryFile);
    } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new CliPluginError(`The studio entry of ${name} (${entryFile}) could not be loaded: ${detail}`);
    }
    const definition = (exported.default ?? exported) as { setup?: unknown };
    if (typeof definition?.setup !== "function") {
        throw new CliPluginError(`The studio entry of ${name} exports no plugin definition with a setup function.`);
    }

    const registered: PluginWidgetModule[] = [];
    const notes: string[] = [];
    try {
        const result = (definition.setup as (app: unknown) => unknown)(recordingApp(manifest, registered));
        if (result && typeof (result as Promise<unknown>).then === "function") {
            // Whatever it registers after this point is not seen; say so if that may be everything.
            (result as Promise<unknown>).then(undefined, () => undefined);
            if (registered.length === 0) {
                notes.push(`${name}'s setup is asynchronous and had registered no widgets when it was read.`);
            }
        }
    } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new CliPluginError(`The setup of ${name} threw: ${detail}`);
    }

    const declared = Array.isArray(manifest.contributes?.widgets) ? (manifest.contributes.widgets as unknown[]) : [];
    const widgetTypes: string[] = [];
    for (const module of registered) {
        const type = typeof module?.type === "string" ? module.type : "";
        // The two rules Studio's registration enforces; a widget breaking either never reaches an
        // editor, so it does not reach this tool's catalogue either.
        if (!type.startsWith(`${id}.`)) {
            notes.push(`${name} registers widget "${type}", which is not prefixed with "${id}." - left out, as Studio leaves it out.`);
            continue;
        }
        if (!declared.includes(type)) {
            notes.push(`${name} registers widget "${type}" without declaring it in contributes.widgets - left out, as Studio leaves it out.`);
            continue;
        }
        widgetModuleRegistry.register(toWidgetModule(id, module), { ownerPluginId: id, ownerPluginName: name });
        widgetTypes.push(type);
    }
    return { id, name, dir, widgetTypes, notes };
}

/** Every widget a loaded plugin put in the registry, for the catalogue to list beside Studio's. */
export function listCliPluginWidgetModules(): UIWidgetModule[] {
    return widgetModuleRegistry.list().filter(module => widgetModuleRegistry.getOwner(module.type) !== undefined);
}

/** The plugin that owns a widget type in this run, for output that should say where it came from. */
export function cliPluginOwnerOf(type: string): string | undefined {
    return widgetModuleRegistry.getOwner(type);
}
