import { useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { Trash2 } from "lucide-react";
import type { StoryInterpolationRef } from "@shared/types/story";
import { Select, type SelectOption } from "@/lib/components/elements";
import { useWorkspace } from "@/apps/workspace/context";
import { Services } from "@/lib/workspace/services/services";
import { LocalBlueprintService } from "@/lib/workspace/services/ui-editor/LocalBlueprintService";
import { useOpenBlueprintTarget } from "@/apps/workspace/modules/blueprint-lite/hooks/useOpenBlueprintTarget";
import { useTranslation } from "@/lib/i18n";
import { StoryActionBlueprintPreviewCard } from "./StoryActionBlueprintPreviewCard";
import { rememberInterpolationKind, type StoryVariableOption } from "./storyInterpolation";

const MENU_Z = 80;

/**
 * Inline interpolation config popover, mirroring the Pause popover: pick a variable value, or bind a
 * Story Action Blueprint (with a preview + editor entry) whose Return Value renders inline.
 */
export function InterpolationPopover(props: {
    anchor: { top: number; left: number; bottom: number };
    value: StoryInterpolationRef;
    options: { scene: StoryVariableOption[]; saved: StoryVariableOption[]; persistent: StoryVariableOption[] };
    onChange: (interp: StoryInterpolationRef) => void;
    onRemove: () => void;
    onClose: () => void;
    /** Commit the in-progress text edit — called before navigating to the blueprint editor. */
    onCommitTextEdit?: () => void;
}) {
    const { t } = useTranslation();
    const panelRef = useRef<HTMLDivElement | null>(null);
    const { context, isInitialized } = useWorkspace();
    const openBlueprint = useOpenBlueprintTarget();
    const kindOptions: SelectOption[] = useMemo(() => [
        { value: "variable", label: t("story.interpolation.kindVariable") },
        { value: "blueprint", label: t("story.interpolation.kindBlueprint") },
    ], [t]);
    const blueprintService = useMemo(
        () => (context && isInitialized ? context.services.get<LocalBlueprintService>(Services.LocalBlueprint) : null),
        [context, isInitialized],
    );

    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                event.stopPropagation();
                props.onClose();
            }
        };
        window.addEventListener("keydown", onKey, true);
        return () => window.removeEventListener("keydown", onKey, true);
    }, [props]);

    useEffect(() => {
        const onDown = (event: MouseEvent) => {
            const target = event.target as HTMLElement | null;
            if (panelRef.current?.contains(target) || target?.closest?.("[data-select-menu]")) {
                return;
            }
            props.onClose();
        };
        globalThis.document.addEventListener("mousedown", onDown, true);
        return () => globalThis.document.removeEventListener("mousedown", onDown, true);
    }, [props]);

    const kind = props.value.kind;
    const blueprintId = props.value.kind === "blueprint" ? props.value.blueprintId : "";

    // One flat list of every declared variable (scene / saved / persistent). Scope is inferred from the
    // chosen variable — the author no longer picks a scope first — and the value type shows on the right.
    const allVariables = useMemo(
        () => [
            ...props.options.scene.map(v => ({ key: `scene:${v.id}`, scope: "scene" as const, id: v.id, name: v.name, valueType: v.valueType })),
            ...props.options.saved.map(v => ({ key: `saved:${v.id}`, scope: "saved" as const, id: v.id, name: v.name, valueType: v.valueType })),
            ...props.options.persistent.map(v => ({ key: `persistent:${v.id}`, scope: "persistent" as const, id: v.id, name: v.name, valueType: v.valueType })),
        ],
        [props.options],
    );
    const currentVariableKey = props.value.kind === "variable"
        ? props.value.target.scope === "persistent"
            ? `persistent:${props.value.target.storageKey}`
            : `${props.value.target.scope}:${props.value.target.variableId}`
        : "";

    const setKind = (nextKind: string) => {
        rememberInterpolationKind(nextKind === "blueprint" ? "blueprint" : "variable");
        if (nextKind === "blueprint") {
            // Do NOT create the blueprint here: mutating the blueprint document mid-edit re-renders the
            // row and drops this uncommitted kind switch. The blueprint is created lazily on open.
            props.onChange(
                props.value.kind === "blueprint"
                    ? props.value
                    : { kind: "blueprint", blueprintId: "" },
            );
        } else {
            props.onChange({ kind: "variable", target: { scope: "scene", variableId: "" } });
        }
    };
    const setVariableByKey = (key: string) => {
        const opt = allVariables.find(v => v.key === key);
        if (!opt) return;
        props.onChange({
            kind: "variable",
            target: opt.scope === "persistent" ? { scope: "persistent", storageKey: opt.id } : { scope: opt.scope, variableId: opt.id },
        });
    };
    const openEditor = () => {
        let id = blueprintId;
        if (!id) {
            id = blueprintService?.ensureStoryActionBlueprint({ mode: "value" }) ?? "";
            props.onChange({ kind: "blueprint", blueprintId: id });
        }
        if (!id) {
            return;
        }
        // Persist the (possibly just-created) binding before navigating to the blueprint editor —
        // otherwise the uncommitted id is dropped and the entry shows "No blueprint" on return.
        props.onCommitTextEdit?.();
        openBlueprint({ blueprintId: id, ownerKind: "storyAction", title: t("story.interpolation.storyValueTitle") });
    };

    const variableOptions: SelectOption[] = allVariables.length
        ? allVariables.map(option => ({ value: option.key, label: option.name, secondaryLabel: option.valueType }))
        : [{ value: "", label: t("story.interpolation.noVariables") }];

    const top = Math.min(props.anchor.bottom + 6, window.innerHeight - 200);
    const left = Math.min(props.anchor.left, window.innerWidth - 256);

    return createPortal(
        <div
            ref={panelRef}
            className="fixed z-[70] w-60 rounded-lg border border-edge bg-surface-raised p-2 shadow-2xl"
            style={{ top, left: Math.max(8, left) }}
            onMouseDown={event => event.stopPropagation()}
        >
            <div className="mb-1.5 text-2xs font-medium tracking-wide text-fg-muted">{t("story.interpolation.title")}</div>
            <div className="flex flex-col gap-1.5">
                <Select options={kindOptions} value={kind} onChange={value => setKind(String(value))} size="sm" fullWidth portalMenu menuZIndex={MENU_Z} menuDataAttributes={{ "data-select-menu": "true" }} />
                {kind === "variable" ? (
                    <Select
                        options={variableOptions}
                        value={currentVariableKey}
                        onChange={value => setVariableByKey(String(value))}
                        placeholder={t("story.interpolation.selectVariable")}
                        size="sm"
                        fullWidth
                        portalMenu
                        menuZIndex={MENU_Z}
                        menuDataAttributes={{ "data-select-menu": "true" }}
                    />
                ) : (
                    <StoryActionBlueprintPreviewCard
                        blueprintId={blueprintId}
                        onOpen={openEditor}
                        heightClassName="h-[84px]"
                    />
                )}
            </div>
            <button
                type="button"
                className="mt-2 flex items-center gap-1 text-xs text-fg-muted transition-colors hover:text-danger"
                onClick={props.onRemove}
            >
                <Trash2 className="h-3 w-3" />
                {t("common.remove")}
            </button>
        </div>,
        document.body,
    );
}
