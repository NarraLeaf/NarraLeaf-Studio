/**
 * Inline text effects in a running game: the binding between a plugin's renderer and the engine's
 * word renderer registry.
 *
 * A run of dialogue carrying an effect compiles to a `Word` whose `render` is the effect id (see
 * `storyMarksToWordConfig`), and the engine resolves that id against `registerWordRenderer` when the
 * line is drawn. What is registered is never the plugin's own function: the engine's props are
 * narrowed to {@link RuntimeInlineTextEffectRenderProps} on the way in, and a renderer that throws
 * falls back to the word as plain text instead of taking the dialogue box down with it.
 */

import * as React from "react";
import { registerWordRenderer } from "narraleaf-react";
import type { RuntimeInlineTextEffectDef, RuntimeInlineTextEffectRenderProps } from "./runtimePluginApi";

/** The props the engine hands a word renderer, as far as this binding reads them. */
type EngineWordRenderProps = {
    children: React.ReactNode;
    text: string;
    fullText: string;
    revealed: boolean;
    done: boolean;
    style: Readonly<React.CSSProperties>;
    config: Readonly<{ ruby?: string }>;
    data: unknown;
};

/**
 * `registerWordRenderer` with its options argument. The option is the engine's (a renderer that
 * leaves the player's clicks to the dialogue box) and the installed typings may predate it; an
 * engine without it ignores the argument and every custom word takes its own clicks.
 */
const registerEngineWordRenderer = registerWordRenderer as unknown as (
    id: string,
    component: React.ComponentType<EngineWordRenderProps>,
    options?: { interactive?: boolean },
) => () => void;

/** Owner plugin id per registered effect; guards cross-plugin collisions. */
const effectOwners = new Map<string, { ownerPluginId: string; unregister: () => void }>();

export function getInlineTextEffectOwner(id: string): string | undefined {
    return effectOwners.get(id)?.ownerPluginId;
}

/**
 * Register one plugin's renderer for an effect id. Registering the same id again from the same
 * plugin replaces it, which is what a reloaded runtime entry does.
 */
export function registerInlineTextEffectRenderer(ownerPluginId: string, def: RuntimeInlineTextEffectDef): void {
    const existing = effectOwners.get(def.id);
    if (existing && existing.ownerPluginId !== ownerPluginId) {
        throw new Error(`Inline text effect already registered by another owner: ${def.id}`);
    }
    existing?.unregister();
    const component = bindInlineTextEffect(def.id, def.render);
    const unregister = registerEngineWordRenderer(def.id, component, { interactive: def.interactive === true });
    effectOwners.set(def.id, { ownerPluginId, unregister });
}

function bindInlineTextEffect(
    id: string,
    render: RuntimeInlineTextEffectDef["render"],
): React.ComponentType<EngineWordRenderProps> {
    function InlineTextEffectWord(props: EngineWordRenderProps): React.ReactElement {
        return React.createElement(
            InlineTextEffectBoundary,
            { id, fallback: props.children },
            React.createElement(PluginInlineTextEffect, { render, props: narrowWordRenderProps(props) }),
        );
    }
    InlineTextEffectWord.displayName = `InlineTextEffect(${id})`;
    return InlineTextEffectWord;
}

function PluginInlineTextEffect({
    render,
    props,
}: {
    render: RuntimeInlineTextEffectDef["render"];
    props: RuntimeInlineTextEffectRenderProps;
}): React.ReactElement | null {
    return render(props);
}

export function narrowWordRenderProps(props: EngineWordRenderProps): RuntimeInlineTextEffectRenderProps {
    const data = props.data;
    return {
        children: props.children,
        text: props.text,
        fullText: props.fullText,
        revealed: props.revealed,
        done: props.done,
        style: props.style,
        hasRuby: Boolean(props.config?.ruby),
        params: data && typeof data === "object" ? data as RuntimeInlineTextEffectRenderProps["params"] : {},
    };
}

type BoundaryProps = { id: string; fallback: React.ReactNode; children?: React.ReactNode };

/**
 * Draws the word as the engine laid it out when the plugin's renderer throws. The failure is
 * reported once per effect: a line re-renders on every revealed character, and a renderer that
 * throws once throws on all of them.
 */
class InlineTextEffectBoundary extends React.Component<BoundaryProps, { failed: boolean }> {
    private static readonly reported = new Set<string>();

    state = { failed: false };

    static getDerivedStateFromError(): { failed: boolean } {
        return { failed: true };
    }

    componentDidCatch(error: unknown): void {
        if (InlineTextEffectBoundary.reported.has(this.props.id)) {
            return;
        }
        InlineTextEffectBoundary.reported.add(this.props.id);
        console.error(`[inline text effect ${this.props.id}] renderer failed; the text is drawn without the effect.`, error);
    }

    render(): React.ReactNode {
        return this.state.failed ? this.props.fallback : this.props.children;
    }
}
