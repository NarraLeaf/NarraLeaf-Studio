import { useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { SquarePen, Trash2 } from "lucide-react";
import type { StoryInterpolationRef } from "@shared/types/story";
import { Select, type SelectOption } from "@/lib/components/elements";
import { useWorkspace } from "@/apps/workspace/context";
import { Services } from "@/lib/workspace/services/services";
import { LocalBlueprintService } from "@/lib/workspace/services/ui-editor/LocalBlueprintService";
import { useOpenBlueprintTarget } from "@/apps/workspace/modules/blueprint-lite/hooks/useOpenBlueprintTarget";
import type { StoryVariableOption } from "./storyInterpolation";

const KIND_OPTIONS: SelectOption[] = [
    { value: "variable", label: "Variable" },
    { value: "blueprint", label: "Blueprint" },
];

const SCOPE_OPTIONS: SelectOption[] = [
    { value: "scene", label: "Scene" },
    { value: "saved", label: "Saved" },
    { value: "persistent", label: "Persistent" },
];

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
}) {
    const panelRef = useRef<HTMLDivElement | null>(null);
    const { context, isInitialized } = useWorkspace();
    const openBlueprint = useOpenBlueprintTarget();
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
    const variableRef = props.value.kind === "variable" ? props.value.target : { scope: "scene" as const, variableId: "" };
    const scope = variableRef.scope;
    const currentId = variableRef.scope === "persistent" ? variableRef.storageKey : variableRef.variableId;
    const declared = props.options[scope];
    const blueprintId = props.value.kind === "blueprint" ? props.value.blueprintId : "";
    const blueprintName = blueprintId
        ? blueprintService?.getBlueprintDocument().blueprints[blueprintId]?.name ?? "Story Action"
        : "Story Action";

    const setKind = (nextKind: string) => {
        if (nextKind === "blueprint") {
            const ensuredId = props.value.kind === "blueprint" && props.value.blueprintId
                ? props.value.blueprintId
                : blueprintService?.ensureStoryActionBlueprint() ?? "";
            props.onChange({ kind: "blueprint", blueprintId: ensuredId });
        } else {
            props.onChange({ kind: "variable", target: { scope: "scene", variableId: "" } });
        }
    };
    const setScope = (next: string) => {
        props.onChange({
            kind: "variable",
            target: next === "persistent" ? { scope: "persistent", storageKey: "" } : { scope: next as "scene" | "saved", variableId: "" },
        });
    };
    const setVariable = (id: string) => {
        props.onChange({
            kind: "variable",
            target: scope === "persistent" ? { scope: "persistent", storageKey: id } : { scope, variableId: id },
        });
    };
    const openEditor = () => {
        let id = blueprintId;
        if (!id) {
            id = blueprintService?.ensureStoryActionBlueprint() ?? "";
            props.onChange({ kind: "blueprint", blueprintId: id });
        }
        if (id) {
            openBlueprint({ blueprintId: id, ownerKind: "storyAction", title: "Story Action" });
        }
    };

    const variableOptions: SelectOption[] = declared.length
        ? declared.map(option => ({ value: option.id, label: option.name }))
        : [{ value: "", label: "No variables declared" }];

    const top = Math.min(props.anchor.bottom + 6, window.innerHeight - 200);
    const left = Math.min(props.anchor.left, window.innerWidth - 256);

    return createPortal(
        <div
            ref={panelRef}
            className="fixed z-[70] w-60 rounded-lg border border-white/15 bg-[#16191e] p-2 shadow-2xl"
            style={{ top, left: Math.max(8, left) }}
            onMouseDown={event => event.stopPropagation()}
        >
            <div className="mb-1.5 text-[11px] font-medium tracking-wide text-slate-400">Insert value</div>
            <div className="flex flex-col gap-1.5">
                <Select options={KIND_OPTIONS} value={kind} onChange={value => setKind(String(value))} size="sm" fullWidth portalMenu menuZIndex={MENU_Z} menuDataAttributes={{ "data-select-menu": "true" }} />
                {kind === "variable" ? (
                    <>
                        <Select options={SCOPE_OPTIONS} value={scope} onChange={value => setScope(String(value))} size="sm" fullWidth portalMenu menuZIndex={MENU_Z} menuDataAttributes={{ "data-select-menu": "true" }} />
                        <Select
                            options={variableOptions}
                            value={currentId}
                            onChange={value => setVariable(String(value))}
                            placeholder="Select a variable…"
                            size="sm"
                            fullWidth
                            portalMenu
                            menuZIndex={MENU_Z}
                            menuDataAttributes={{ "data-select-menu": "true" }}
                        />
                    </>
                ) : (
                    <div className="flex flex-col gap-1.5 rounded-md border border-white/10 bg-[#101216] p-2">
                        <div className="flex items-center justify-between gap-2">
                            <span className="min-w-0 truncate text-xs text-slate-200">{blueprintName}</span>
                            <span className="shrink-0 text-[10px] text-emerald-300/80">On Call → value</span>
                        </div>
                        <button
                            type="button"
                            className="flex h-7 w-fit items-center gap-1 rounded-md border border-white/10 px-2 text-[11px] text-slate-200 hover:border-primary/50 hover:text-white"
                            onClick={openEditor}
                        >
                            <SquarePen className="h-3 w-3" />
                            Open blueprint editor
                        </button>
                        <div className="text-[10px] leading-snug text-amber-300/70">
                            Blueprint text interpolation is not yet evaluated inline at runtime.
                        </div>
                    </div>
                )}
            </div>
            <button
                type="button"
                className="mt-2 flex items-center gap-1 text-xs text-slate-400 transition-colors hover:text-red-300"
                onClick={props.onRemove}
            >
                <Trash2 className="h-3 w-3" />
                Remove
            </button>
        </div>,
        document.body,
    );
}
