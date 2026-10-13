import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, ChevronDown, Layers, Plus, SlidersHorizontal } from "lucide-react";
import type {
    StoryDocument,
    StoryLayerRef,
    StorySceneId,
    StorySceneLayer,
} from "@shared/types/story";
import { resolveStoryLayerRef, sceneLayerStack, storyLayerRefFor, storyLayerRefIs } from "@shared/types/story";
import { storyLayerDistanceLabel, storyLayerLabel, storySceneLayerLabel } from "@/lib/story/storyLayerLabel";
import { useTranslation } from "@/lib/i18n";
import { STAGE_OPTION_SELECTOR, useAutoMenuPlacement } from "./DisplayableTargetField";
import { useFloatingLayer } from "@/lib/components/layout";

const FIELD_LABEL_CLASS = "block text-xs font-medium text-fg-muted mb-1";

/**
 * Layer picker for `image` / `text` / `layer` rows: every layer of the scene's stack, front to back,
 * each with how much of the camera's movement it follows - so picking a layer is also seeing where it
 * is. The author picks one (bound by id, so it follows renames), adds a new one to the scene's stack
 * and binds to it, or goes to the scene's layers to arrange them.
 */
export function StoryLayerField(props: {
    label?: string;
    document: StoryDocument;
    sceneId: StorySceneId;
    blockId: string;
    value: StoryLayerRef | undefined;
    onChange: (ref: StoryLayerRef) => void;
    /** Add a layer to the scene's stack; returns its id (or null). */
    onCreateLayer: () => string | null;
    /** Show the scene's layers - the live preview's layer view. Absent where there is none to show. */
    onManageLayers?: () => void;
}) {
    const { t } = useTranslation();
    const rootRef = useRef<HTMLDivElement | null>(null);
    const triggerRef = useRef<HTMLButtonElement | null>(null);
    const menuRef = useRef<HTMLDivElement | null>(null);
    const [open, setOpen] = useState(false);
    // A floating layer, like the target field's list beside it: it opens on the current layer, the
    // arrows walk the rows (the actions at the end included), Escape closes the list and not the
    // inspector around it, and focus goes back to the field's button.
    useFloatingLayer({
        open,
        onClose: () => setOpen(false),
        panelRef: menuRef,
        ownerRefs: [triggerRef],
        itemSelector: STAGE_OPTION_SELECTOR,
    });

    // Not memoised on the scene: the story service edits it in place, so the same object comes back
    // after a change.
    const scene = props.document.scenes[props.sceneId];
    const stack = sceneLayerStack(scene);
    const resolved = resolveStoryLayerRef(scene, props.value);
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

    const choose = (layer: StorySceneLayer) => {
        props.onChange(storyLayerRefFor(layer));
        setOpen(false);
    };
    const createLayer = () => {
        const id = props.onCreateLayer();
        if (id) {
            props.onChange({ kind: "custom", sourceBlockId: id });
        }
        setOpen(false);
    };
    const manageLayers = () => {
        setOpen(false);
        props.onManageLayers?.();
    };

    const TriggerIcon = unresolved ? AlertTriangle : Layers;

    return (
        <div ref={rootRef} className="relative">
            <label className={FIELD_LABEL_CLASS}>{props.label ?? t("story.layerField.label")}</label>
            <button
                ref={triggerRef}
                type="button"
                aria-expanded={open}
                className="flex h-9 w-full min-w-0 items-center gap-2 rounded-md border border-edge bg-surface-raised px-3 text-left text-sm text-fg-muted transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/60"
                onClick={() => setOpen(current => !current)}
            >
                <TriggerIcon className={["h-3.5 w-3.5 shrink-0", unresolved ? "text-warning" : "text-fg-muted"].join(" ")} />
                <span className="truncate text-fg">{storyLayerLabel(resolved)}</span>
                {unresolved ? (
                    <span
                        className="shrink-0 rounded-md bg-warning/10 px-1 text-2xs text-warning"
                        data-tip={t("story.layerField.notOnStageTitle")}
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
                    ref={menuRef}
                    className={[
                        "absolute left-0 z-50 w-full min-w-[240px] overflow-hidden rounded-xl border border-edge bg-surface-raised shadow-xl",
                        placement === "above" ? "bottom-full mb-1" : "top-full mt-1",
                    ].join(" ")}
                >
                    <div className="max-h-72 overflow-auto p-1">
                        <div className="px-2 pb-1 pt-0.5 text-2xs text-fg-subtle">{t("story.sceneLayers.frontToBack")}</div>
                        {stack.map(layer => (
                            <LayerRow
                                key={layer.kind === "custom" ? layer.id : layer.kind}
                                label={storySceneLayerLabel(layer)}
                                hint={layer.kind === "displayable" ? t("story.layerField.displayableHint") : storyLayerDistanceLabel(layer)}
                                active={!unresolved && storyLayerRefIs(scene, props.value, layer)}
                                onChoose={() => choose(layer)}
                            />
                        ))}
                        <div className="my-1 border-t border-edge-subtle" />
                        <ActionRow icon={Plus} label={t("story.layerField.createNew")} onChoose={createLayer} />
                        {props.onManageLayers ? (
                            <ActionRow icon={SlidersHorizontal} label={t("story.layerField.manage")} onChoose={manageLayers} />
                        ) : null}
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
                "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors",
                props.active ? "bg-primary/15 text-fg" : "hover:bg-fill",
            ].join(" ")}
            onClick={props.onChoose}
        >
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md border border-edge bg-fill-subtle">
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

function ActionRow(props: { icon: typeof Plus; label: string; onChoose: () => void }) {
    const Icon = props.icon;
    return (
        <button
            type="button"
            role="option"
            aria-selected={false}
            className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm text-primary transition-colors hover:bg-primary/10"
            onClick={props.onChoose}
        >
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md border border-primary/30 bg-primary/10">
                <Icon className="h-3.5 w-3.5" />
            </span>
            <span className="min-w-0 flex-1 truncate">{props.label}</span>
        </button>
    );
}
