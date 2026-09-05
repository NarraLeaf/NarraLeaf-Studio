import React, { createElement, useSyncExternalStore } from "react";
import type {
    ElementRendererDefinition,
    ElementRendererProps,
    ElementRendererRegistry,
} from "../runtime/ElementRendererRegistry";
import { WidgetRenderBoundary } from "../runtime/WidgetRenderBoundary";
import { widgetModuleRegistry } from "./registryInstance";

/**
 * How a plugin's widget reaches the drawing.
 *
 * Studio has two registries that sound like one. `widgetModuleRegistry` holds widget *modules* -
 * the authoring half: icon, default element, inspector, docker bar, context menu. Surfaces are
 * drawn from an `ElementRendererRegistry`, which built-in widgets enter through the hardcoded
 * `BuiltinElementRenderers` array. A plugin registers a module, so until this file existed it could
 * be inserted, selected and edited, and drew `Unsupported widget type` on the canvas.
 *
 * The bridge is one-way and derived: the module registry is the truth, and every renderer here is
 * built from it. There is no second list to keep in step, and a plugin switched off in the plugins
 * panel disappears from both at once.
 *
 * The game side has its own path, which is where a shipped game gets the same widget:
 * `loadRuntimePlugins` binds the plugin's runtime entry into whichever registry the game built.
 * Neither knows about the other, and they must not - the editor draws through the plugin's studio
 * entry, running in Studio's renderer, and the game draws through its runtime entry, running in
 * the game's.
 */

/** What this module put into each registry, so a re-sync can take back what is no longer owned. */
const applied = new WeakMap<ElementRendererRegistry, Set<string>>();

/**
 * Draws one plugin widget.
 *
 * A component rather than a direct call so the boundary above it is a real ancestor: React only
 * catches a throw that happens while it is rendering a child of the boundary, and calling the
 * plugin's `render` inline would throw while the *host's* tree was rendering, which no boundary of
 * ours is above.
 *
 * The module is resolved on every drawing rather than captured, so reloading a plugin swaps the
 * code the next time the surface renders instead of leaving the previous build drawing.
 */
function PluginWidgetHost({ type, props }: { type: string; props: ElementRendererProps }): React.ReactElement | null {
    const module = widgetModuleRegistry.get(type);
    if (!module) {
        return null;
    }
    return <>{module.render(props)}</>;
}

function createPluginRendererDefinition(type: string): ElementRendererDefinition {
    return {
        type,
        render: props => createElement(
            WidgetRenderBoundary,
            { type },
            createElement(PluginWidgetHost, { type, props }),
        ),
    };
}

/**
 * Bring one renderer registry in line with the plugin widget types registered right now.
 *
 * Idempotent, and safe to call on every render: it adds the types this module has not put in yet
 * and removes the ones it did put in that are no longer contributed. Built-in renderers are never
 * touched - a plugin widget type is prefixed with its plugin's id, so it cannot collide with one,
 * and the set above records only what was added here.
 */
export function syncPluginElementRenderers(registry: ElementRendererRegistry): void {
    const previous = applied.get(registry) ?? new Set<string>();
    const current = new Set<string>();
    for (const module of widgetModuleRegistry.list()) {
        if (!widgetModuleRegistry.getOwner(module.type)) {
            continue;
        }
        current.add(module.type);
        if (!previous.has(module.type)) {
            registry.register(createPluginRendererDefinition(module.type));
        }
    }
    for (const type of previous) {
        if (!current.has(type)) {
            registry.unregister(type);
        }
    }
    applied.set(registry, current);
}

function subscribeToWidgetModules(listener: () => void): () => void {
    return widgetModuleRegistry.subscribe(listener);
}

function readWidgetModuleRevision(): number {
    return widgetModuleRegistry.getRevision();
}

/**
 * Keep a registry in step with the plugin widget types, and redraw when they change.
 *
 * Both halves are needed and neither is enough on its own: without the sync a widget registered
 * after the registry was built never draws, and without the subscription the canvas keeps the
 * drawing it already made when the author switches a plugin on or off in the plugins panel - which
 * is a thing they can do with a page open.
 */
export function usePluginElementRenderers(registry: ElementRendererRegistry): void {
    useSyncExternalStore(subscribeToWidgetModules, readWidgetModuleRevision, readWidgetModuleRevision);
    syncPluginElementRenderers(registry);
}
