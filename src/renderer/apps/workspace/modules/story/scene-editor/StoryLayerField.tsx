import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Check, ChevronDown, Layers, Plus } from "lucide-react";
import type {
    StoryDocument,
    StoryLayerRef,
    StorySceneId,
} from "@shared/types/story";
import { DEFAULT_LAYER_OPTIONS, resolveStoryLayerRef } from "@shared/types/story";
import { useTranslation } from "@/lib/i18n";
import { listSceneDisplayableTargets } from "../../story-motion/storyMotionPreviewTarget";
import { useAutoMenuPlacement } from "./DisplayableTargetField";

const FIELD_LABEL_CLASS = "block text-xs font-medium text-fg-muted mb-1";

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
    const { t } = useTranslation();
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
            <label className={FIELD_LABEL_CLASS}>{props.label ?? t("story.layerField.label")}</label>
            <button
                type="button"
                className="flex h-9 w-full min-w-0 items-center gap-2 rounded-md border border-edge bg-surface-raised px-3 text-left text-sm text-fg-muted transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/60"
                onClick={() => setOpen(current => !current)}
            >
                <TriggerIcon className={["h-3.5 w-3.5 shrink-0", unresolved ? "text-warning" : "text-fg-muted"].join(" ")} />
                <span className="truncate text-fg">{resolved.name || t("story.layerField.defaultName")}</span>
                {unresolved ? (
                    <span
                        className="shrink-0 rounded bg-warning/10 px-1 text-2xs text-warning"
                        title={t("story.layerField.notOnStageTitle")}
                    >
                        {t("story.stage.notOnStage")}
                    </span>
                ) : resolved.kind === "default" ? (
                    <span className="shrink-0 text-2xs text-fg-subtle">{t("story.stage.builtin")}</span>
                ) : null}
                <ChevronDown className="ml-auto h-3.5 w-3.5 shrink-0 text-fg-subtle" />
            </button>
            {open ? (
                <div
                    className={[
                        "absolute left-0 z-50 w-full min-w-[240px] overflow-hidden rounded-xl border border-edge bg-surface-raised shadow-xl",
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
                            <div className="my-1 border-t border-edge-subtle" />
                        ) : null}
                        {customLayers.map(option =>
                            option.kind === "custom" ? (
                                <LayerRow
                                    key={option.sourceBlockId}
                                    label={option.name}
                                    hint={t("story.layerField.hint")}
                                    active={selectedCustomId === option.sourceBlockId}
                                    onChoose={() => chooseCustom(option)}
                                />
                            ) : null,
                        )}
                        <div className="my-1 border-t border-edge-subtle" />
                        <button
                            type="button"
                            className="flex w-full items-center gap-2.5 rounded px-2 py-1.5 text-left text-sm text-primary transition-colors hover:bg-primary/10"
                            onClick={createLayer}
                        >
                            <span className="grid h-7 w-7 shrink-0 place-items-center rounded border border-primary/30 bg-primary/10">
                                <Plus className="h-3.5 w-3.5" />
                            </span>
                            <span className="min-w-0 flex-1 truncate">{t("story.layerField.createNew")}</span>
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
                props.active ? "bg-primary/15 text-fg" : "hover:bg-fill",
            ].join(" ")}
            onClick={props.onChoose}
        >
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded border border-edge bg-fill-subtle">
                <Layers className="h-3.5 w-3.5 text-fg-muted" />
            </span>
            <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-fg">{props.label}</span>
                <span className="block truncate text-2xs text-fg-subtle">{props.hint}</span>
            </span>
            {props.active ? <Check className="h-3.5 w-3.5 shrink-0 text-primary" /> : null}
        </button>
    );
}
