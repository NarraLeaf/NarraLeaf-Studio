import { useSyncExternalStore } from "react";

/**
 * One number an inline text effect lets the author set, drawn as a slider in the effect panel.
 *
 * Numbers only: a run's parameters are written into the document and into scripts as `key=value`,
 * and a slider with a range is the one control every effect so far has needed.
 */
export type PluginInlineTextEffectParamDef = {
    /** Unique within the effect. Keys the stored value; never displayed. */
    key: string;
    /** Author-facing name of the parameter, in the interface language. Read like the effect's. */
    label: string;
    min: number;
    max: number;
    /** The slider's increment. Defaults to a hundredth of the range. */
    step?: number;
    /** The value a run takes when the author has not moved the slider. Not stored. */
    default: number;
};

/**
 * An inline text effect's entry in the dialogue toolbar. The id is the one the runtime entry
 * registers the renderer under, and the one the run stores.
 */
export type PluginInlineTextEffectDef = {
    /** Must start with the plugin id and be declared in `contributes.inlineTextEffects`. */
    id: string;
    /**
     * Author-facing name, in the interface language. Read each time the panel draws, so a getter
     * over the plugin's translator follows a language switch without registering again.
     */
    label: string;
    params?: readonly PluginInlineTextEffectParamDef[];
};

export type InlineTextEffectEntry = {
    id: string;
    label: string;
    params: readonly PluginInlineTextEffectParamDef[];
    ownerPluginId: string;
};

const entries = new Map<string, InlineTextEffectEntry>();
const listeners = new Set<() => void>();
let snapshot: readonly InlineTextEffectEntry[] = [];

function publish(): void {
    snapshot = Array.from(entries.values());
    for (const listener of listeners) {
        listener();
    }
}

/**
 * The effects the loaded plugins offer, for the dialogue toolbar.
 *
 * Process-wide like the widget module registry: a workspace window holds one project, and a plugin's
 * registration lives exactly as long as the plugin, which unregisters through the cleanup it was
 * handed.
 */
export const inlineTextEffectRegistry = {
    register(entry: InlineTextEffectEntry): () => void {
        const existing = entries.get(entry.id);
        if (existing && existing.ownerPluginId !== entry.ownerPluginId) {
            throw new Error(`Inline text effect already registered by another owner: ${entry.id}`);
        }
        entries.set(entry.id, entry);
        publish();
        return () => {
            if (entries.get(entry.id) === entry) {
                entries.delete(entry.id);
                publish();
            }
        };
    },
    get(id: string): InlineTextEffectEntry | undefined {
        return entries.get(id);
    },
    list(): readonly InlineTextEffectEntry[] {
        return snapshot;
    },
    subscribe(listener: () => void): () => void {
        listeners.add(listener);
        return () => {
            listeners.delete(listener);
        };
    },
};

export function useInlineTextEffects(): readonly InlineTextEffectEntry[] {
    return useSyncExternalStore(inlineTextEffectRegistry.subscribe, inlineTextEffectRegistry.list, inlineTextEffectRegistry.list);
}

/**
 * The definition as the registry keeps it, or the reason it cannot be kept. Parameters with a key
 * used twice, a range that is empty, or a default outside it are refused rather than repaired: a
 * slider that cannot reach the stored value would silently rewrite the run the author set.
 */
export function normalizeInlineTextEffectDef(
    def: PluginInlineTextEffectDef,
    ownerPluginId: string,
): InlineTextEffectEntry | string {
    const id = typeof def?.id === "string" ? def.id.trim() : "";
    if (!id || typeof def.label !== "string" || !def.label.trim()) {
        return "Inline text effect requires an id and a label";
    }
    const params: PluginInlineTextEffectParamDef[] = [];
    for (const param of def.params ?? []) {
        const key = typeof param?.key === "string" ? param.key.trim() : "";
        if (!key || !/^[A-Za-z][A-Za-z0-9_]*$/.test(key)) {
            return `Inline text effect ${id}: parameter key must be a word of letters, digits and underscores: ${String(param?.key)}`;
        }
        if (params.some(existing => existing.key === key)) {
            return `Inline text effect ${id}: parameter key is used twice: ${key}`;
        }
        const { min, max } = param;
        if (!Number.isFinite(min) || !Number.isFinite(max) || !(max > min)) {
            return `Inline text effect ${id}: parameter ${key} needs a range with max above min`;
        }
        if (!Number.isFinite(param.default) || param.default < min || param.default > max) {
            return `Inline text effect ${id}: parameter ${key} has a default outside its range`;
        }
        const step = typeof param.step === "number" && param.step > 0 ? param.step : (max - min) / 100;
        const source = param;
        params.push({
            key,
            get label() {
                return typeof source.label === "string" && source.label ? source.label : key;
            },
            min,
            max,
            step,
            default: param.default,
        });
    }
    return {
        id,
        get label() {
            return typeof def.label === "string" && def.label ? def.label : id;
        },
        params,
        ownerPluginId,
    };
}
