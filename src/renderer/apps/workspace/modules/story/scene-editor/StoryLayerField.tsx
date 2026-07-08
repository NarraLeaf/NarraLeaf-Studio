import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Check, ChevronDown, Layers, Plus } from "lucide-react";
import type {
    StoryDocument,
    StoryLayerRef,
    StorySceneId,
} from "@shared/types/story";
import { DEFAULT_LAYER_OPTIONS, resolveStoryLayerRef } from "@shared/types/story";
import { listSceneDisplayableTargets } from "../../story-motion/storyMotionPreviewTarget";
import { useAutoMenuPlacement } from "./DisplayableTargetField";

const FIELD_LABEL_CLASS = "block text-xs font-medium text-gray-400 mb-1";

type LayerOption =
    | { kind: "default"; layer: "background" | "displayable"; label: string; hint: string }
    | { kind: "custom"; sourceBlockId: string; name: string };

/**
 * Layer picker for `image` / `text` actions. Render layers can only be declared statically — the
 * two NarraLeaf-React built-ins (`Scene.displayableLayer` / `Scene.backgroundLayer`) or an earlier
 * `layer` create block — so every valid layer is discoverable by scanning the scene. The author
 * picks one (bound by stable id, so it follows renames) instead of retyping a name, or creates a
 * new layer inline, which inserts a `layer` block just above and binds to it.
 */
export function StoryLayerField(props: {
    label?: string;
    document: StoryDocument;
    sceneId: StorySceneId;
    blockId: string;
    value: StoryLayerRef | undefined;
    onChange: (ref: StoryLayerRef) => void;
    /** Insert a new `layer` create block before this block; returns the new block id (or null). */
    onCreateLayer: () => string | null;
}) {
    const rootRef = useRef<HTMLDivElement | null>(null);
    const [open, setOpen] = useState(false);

    const customLayers = useMemo<LayerOption[]>(
        () =>
            listSceneDisplayableTargets(props.document, props.sceneId, props.blockId)
                .filter(option => option.kind === "layer")
                .map(option => ({ kind: "custom", sourceBlockId: option.sourceBlockId, name: option.name })),
        [props.document, props.sceneId, props.blockId],
    );

    const scene = props.document.scenes[props.sceneId];
    const resolved = resolveStoryLayerRef(scene, props.value);
    const selectedCustomId = resolved.kind === "custom" ? resolved.sourceBlockId : undefined;
    const selectedDefault = resolved.kind === "default" ? resolved.layer : undefined;
    const unresolved = resolved.kind === "custom" && !resolved.resolved;

    const placement = useAutoMenuPlacement(rootRef, open, 300);

    useEffect(() => {
        if (!open) {
            return;
        }
        const handlePointerDown = (event: PointerEvent) => {
            if (!rootRef.current?.contains(event.target as Node)) {
                setOpen(false);
            }
        };
        window.addEventListener("pointerdown", handlePointerDown);
        return () => window.removeEventListener("pointerdown", handlePointerDown);
    }, [open]);

    const chooseDefault = (layer: "background" | "displayable") => {
        props.onChange({ kind: "default", layer });
        setOpen(false);
    };
    const chooseCustom = (option: Extract<LayerOption, { kind: "custom" }>) => {
        props.onChange({ kind: "custom", sourceBlockId: option.sourceBlockId, name: option.name });
        setOpen(false);
    };
    const createLayer = () => {
        const newBlockId = props.onCreateLayer();
        if (newBlockId) {
            props.onChange({ kind: "custom", sourceBlockId: newBlockId });
        }
        setOpen(false);
    };

    const TriggerIcon = unresolved ? AlertTriangle : Layers;

    return (
        <div ref={rootRef} className="relative">
            <label className={FIELD_LABEL_CLASS}>{props.label ?? "Layer"}</label>
            <button
                type="button"
                className="flex h-9 w-full min-w-0 items-center gap-2 rounded-md border border-white/10 bg-[#1e1f22] px-3 text-left text-sm text-gray-300 transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/60"
                onClick={() => setOpen(current => !current)}
            >
                <TriggerIcon className={["h-3.5 w-3.5 shrink-0", unresolved ? "text-amber-400" : "text-slate-400"].join(" ")} />
                <span className="truncate text-slate-100">{resolved.name || "Displayable layer"}</span>
                {unresolved ? (
                    <span
                        className="shrink-0 rounded bg-amber-400/10 px-1 text-[10px] text-amber-300/90"
                        title="No layer with this name is declared earlier in this scene — pick an existing layer"
                    >
                        Not on stage
                    </span>
                ) : resolved.kind === "default" ? (
                    <span className="shrink-0 text-[11px] text-slate-500">Built-in</span>
                ) : null}
                <ChevronDown className="ml-auto h-3.5 w-3.5 shrink-0 text-slate-500" />
            </button>
            {open ? (
                <div
                    className={[
                        "absolute left-0 z-50 w-full min-w-[240px] overflow-hidden rounded-xl border border-white/10 bg-[#181b20] shadow-xl",
                        placement === "above" ? "bottom-full mb-1" : "top-full mt-1",
                    ].join(" ")}
                >
                    <div className="max-h-72 overflow-auto p-1">
                        {DEFAULT_LAYER_OPTIONS.map(option => (
                            <LayerRow
                                key={`default-${option.layer}`}
                                label={option.label}
                                hint={option.hint}
                                active={selectedDefault === option.layer}
                                onChoose={() => chooseDefault(option.layer)}
                            />
                        ))}
                        {customLayers.length > 0 ? (
                            <div className="my-1 border-t border-white/[0.06]" />
                        ) : null}
                        {customLayers.map(option =>
                            option.kind === "custom" ? (
                                <LayerRow
                                    key={option.sourceBlockId}
                                    label={option.name}
                                    hint="Layer"
                                    active={selectedCustomId === option.sourceBlockId}
                                    onChoose={() => chooseCustom(option)}
                                />
                            ) : null,
                        )}
                        <div className="my-1 border-t border-white/[0.06]" />
                        <button
                            type="button"
                            className="flex w-full items-center gap-2.5 rounded px-2 py-1.5 text-left text-sm text-primary transition-colors hover:bg-primary/10"
                            onClick={createLayer}
                        >
                            <span className="grid h-7 w-7 shrink-0 place-items-center rounded border border-primary/30 bg-primary/10">
                                <Plus className="h-3.5 w-3.5" />
                            </span>
                            <span className="min-w-0 flex-1 truncate">Create new layer</span>
                        </button>
                    </div>
                </div>
            ) : null}
        </div>
    );
}

function LayerRow(props: {
    label: string;
    hint: string;
    active: boolean;
    onChoose: () => void;
}) {
    return (
        <button
            type="button"
            role="option"
            aria-selected={props.active}
            className={[
                "flex w-full items-center gap-2.5 rounded px-2 py-1.5 text-left transition-colors",
                props.active ? "bg-primary/15 text-white" : "hover:bg-white/[0.06]",
            ].join(" ")}
            onClick={props.onChoose}
        >
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded border border-white/10 bg-white/[0.04]">
                <Layers className="h-3.5 w-3.5 text-slate-400" />
            </span>
            <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-slate-100">{props.label}</span>
                <span className="block truncate text-[11px] text-slate-500">{props.hint}</span>
            </span>
            {props.active ? <Check className="h-3.5 w-3.5 shrink-0 text-primary" /> : null}
        </button>
    );
}
