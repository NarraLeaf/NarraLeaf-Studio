import { useEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import { AlertTriangle, Check, ChevronDown, Image as ImageIcon, Layers, Search, Type, UserRound } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type {
    StoryDisplayableBuiltin,
    StoryDisplayableTargetKind,
    StoryDisplayableTargetRef,
    StoryDocument,
    StorySceneId,
} from "@shared/types/story";
import { DISPLAYABLE_BUILTIN_META, resolveDisplayableTargetRef } from "@shared/types/story";
import { useAssetObjectUrl } from "@/lib/workspace/hooks/useAssetObjectUrl";
import { listSceneDisplayableTargets, type SceneDisplayableRef } from "../../story-motion/storyMotionPreviewTarget";

const FIELD_LABEL_CLASS = "block text-xs font-medium text-gray-400 mb-1";

const KIND_META: Record<StoryDisplayableTargetKind, { label: string; icon: LucideIcon }> = {
    character: { label: "Character", icon: UserRound },
    image: { label: "Image", icon: ImageIcon },
    text: { label: "Text", icon: Type },
    layer: { label: "Layer", icon: Layers },
};

/** Built-in stage singletons offered at the top of every target list, in display order. */
const BUILTIN_ORDER: StoryDisplayableBuiltin[] = ["background", "backgroundLayer", "displayableLayer"];

function sameName(left: string, right: string): boolean {
    return left.trim().toLowerCase() === right.trim().toLowerCase();
}

function matchesTarget(option: SceneDisplayableRef, target: { name: string; kind?: string; sourceBlockId?: string }): boolean {
    if (target.sourceBlockId) {
        return option.sourceBlockId === target.sourceBlockId;
    }
    // Legacy targets (no stable id) still match on name + optional kind.
    return sameName(option.name, target.name ?? "") && (target.kind === undefined || option.kind === target.kind);
}

/**
 * Target picker for `displayable` actions. The list is the full set of transformable stage objects:
 * the built-in singletons every scene has (scene background + the two built-in layers) followed by
 * the named displayables declared by earlier action blocks (characters / images / texts / custom
 * layers). Displayables can only be declared statically, so the named ones are discoverable by
 * scanning the scene; picking any option sets the ref (built-in id, or name + kind + stable block id)
 * so the author never retypes a name or infers a kind.
 */
export function DisplayableTargetField(props: {
    label?: string;
    document: StoryDocument;
    sceneId: StorySceneId;
    blockId: string;
    target: StoryDisplayableTargetRef;
    onChange: (target: StoryDisplayableTargetRef) => void;
}) {
    const rootRef = useRef<HTMLDivElement | null>(null);
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState("");

    const options = useMemo(
        () => listSceneDisplayableTargets(props.document, props.sceneId, props.blockId),
        [props.document, props.sceneId, props.blockId],
    );

    const target = props.target;
    const selected = useMemo(
        () => (target.builtin ? null : options.find(option => matchesTarget(option, target)) ?? null),
        [options, target],
    );
    // Resolve through the stable anchor so the label follows renames; fall back to the stored name.
    // Built-ins (scene background / built-in layers) always resolve to their label + kind.
    const scene = props.document.scenes[props.sceneId];
    const resolved = resolveDisplayableTargetRef(scene, target);
    const name = selected?.name ?? resolved.name;
    const unresolved = !target.builtin && name.trim().length > 0 && !selected;

    const placement = useAutoMenuPlacement(rootRef, open, 320);

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

    // Reset the search each time the menu re-opens so it never opens pre-filtered.
    useEffect(() => {
        if (!open) {
            setQuery("");
        }
    }, [open]);

    const filtered = useMemo(() => {
        const normalized = query.trim().toLowerCase();
        if (!normalized) {
            return options;
        }
        return options.filter(option =>
            option.name.toLowerCase().includes(normalized) || option.kind.includes(normalized));
    }, [options, query]);

    const filteredBuiltins = useMemo(() => {
        const normalized = query.trim().toLowerCase();
        if (!normalized) {
            return BUILTIN_ORDER;
        }
        return BUILTIN_ORDER.filter(builtin => {
            const meta = DISPLAYABLE_BUILTIN_META[builtin];
            return meta.label.toLowerCase().includes(normalized) || meta.kind.includes(normalized);
        });
    }, [query]);

    const choose = (option: SceneDisplayableRef) => {
        props.onChange({ name: option.name, kind: option.kind, sourceBlockId: option.sourceBlockId });
        setOpen(false);
    };

    const chooseBuiltin = (builtin: StoryDisplayableBuiltin) => {
        const meta = DISPLAYABLE_BUILTIN_META[builtin];
        props.onChange({ builtin, kind: meta.kind, name: meta.label });
        setOpen(false);
    };

    const displayKind = selected?.kind ?? resolved.kind ?? target.kind ?? "image";
    const TriggerIcon = unresolved ? AlertTriangle : KIND_META[displayKind].icon;

    return (
        <div ref={rootRef} className="relative">
            <label className={FIELD_LABEL_CLASS}>{props.label ?? "Target"}</label>
            <button
                type="button"
                className="flex h-9 w-full min-w-0 items-center gap-2 rounded-md border border-white/10 bg-[#1e1f22] px-3 text-left text-sm text-gray-300 transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/60"
                onClick={() => setOpen(current => !current)}
            >
                {name ? (
                    <>
                        <TriggerIcon className={["h-3.5 w-3.5 shrink-0", unresolved ? "text-amber-400" : "text-slate-400"].join(" ")} />
                        <span className="truncate text-slate-100">{name}</span>
                        {unresolved ? (
                            <span
                                className="shrink-0 rounded bg-amber-400/10 px-1 text-[10px] text-amber-300/90"
                                title="Not created earlier in this scene — pick an existing displayable"
                            >
                                Not on stage
                            </span>
                        ) : (
                            <span className="shrink-0 text-[11px] text-slate-500">{target.builtin ? "Built-in" : KIND_META[displayKind].label}</span>
                        )}
                    </>
                ) : (
                    <span className="truncate italic text-gray-500">Select displayable…</span>
                )}
                <ChevronDown className="ml-auto h-3.5 w-3.5 shrink-0 text-slate-500" />
            </button>
            {open ? (
                <div
                    className={[
                        "absolute left-0 z-50 w-full min-w-[260px] overflow-hidden rounded-xl border border-white/10 bg-[#181b20] shadow-xl",
                        placement === "above" ? "bottom-full mb-1" : "top-full mt-1",
                    ].join(" ")}
                >
                    {options.length + BUILTIN_ORDER.length > 5 ? (
                        <div className="flex items-center gap-2 border-b border-white/10 px-2.5 py-1.5">
                            <Search className="h-3.5 w-3.5 shrink-0 text-slate-500" />
                            <input
                                autoFocus
                                value={query}
                                onChange={event => setQuery(event.target.value)}
                                placeholder="Search stage displayables"
                                className="w-full bg-transparent text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none"
                            />
                        </div>
                    ) : null}
                    <div className="max-h-72 overflow-auto p-1">
                        {filteredBuiltins.map(builtin => (
                            <BuiltinTargetRow
                                key={`builtin-${builtin}`}
                                builtin={builtin}
                                active={target.builtin === builtin}
                                onChoose={() => chooseBuiltin(builtin)}
                            />
                        ))}
                        {filteredBuiltins.length > 0 && filtered.length > 0 ? (
                            <div className="my-1 border-t border-white/[0.06]" />
                        ) : null}
                        {filtered.map(option => (
                            <DisplayableOptionRow
                                key={option.sourceBlockId}
                                option={option}
                                active={selected?.sourceBlockId === option.sourceBlockId}
                                onChoose={() => choose(option)}
                            />
                        ))}
                        {filteredBuiltins.length === 0 && filtered.length === 0 ? (
                            <div className="px-2 py-3 text-center text-xs text-slate-500">No match.</div>
                        ) : null}
                    </div>
                </div>
            ) : null}
        </div>
    );
}

function BuiltinTargetRow(props: {
    builtin: StoryDisplayableBuiltin;
    active: boolean;
    onChoose: () => void;
}) {
    const meta = DISPLAYABLE_BUILTIN_META[props.builtin];
    const Icon = KIND_META[meta.kind].icon;
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
                <Icon className="h-3.5 w-3.5 text-slate-400" />
            </span>
            <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-slate-100">{meta.label}</span>
                <span className="block truncate text-[11px] text-slate-500">{meta.hint}</span>
            </span>
            {props.active ? <Check className="h-3.5 w-3.5 shrink-0 text-primary" /> : null}
        </button>
    );
}

function DisplayableOptionRow(props: {
    option: SceneDisplayableRef;
    active: boolean;
    onChoose: () => void;
}) {
    const meta = KIND_META[props.option.kind];
    const Icon = meta.icon;
    const { url } = useAssetObjectUrl(props.option.assetId);
    const preview = props.option.text ?? "";

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
            <span className="grid h-7 w-7 shrink-0 place-items-center overflow-hidden rounded border border-white/10 bg-white/[0.04]">
                {url ? (
                    <img src={url} alt="" className="h-full w-full object-cover" draggable={false} />
                ) : (
                    <Icon className="h-3.5 w-3.5 text-slate-400" />
                )}
            </span>
            <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-slate-100">{props.option.name}</span>
                <span className="block truncate text-[11px] text-slate-500">
                    {meta.label}{preview ? ` · ${preview}` : ""}
                </span>
            </span>
            {props.active ? <Check className="h-3.5 w-3.5 shrink-0 text-primary" /> : null}
        </button>
    );
}

type MenuPlacement = "above" | "below";

export function useAutoMenuPlacement(anchorRef: RefObject<HTMLElement | null>, open: boolean, expectedHeight: number): MenuPlacement {
    const [placement, setPlacement] = useState<MenuPlacement>("below");

    useEffect(() => {
        if (!open) {
            return;
        }
        const updatePlacement = () => {
            const rect = anchorRef.current?.getBoundingClientRect();
            if (!rect) {
                return;
            }
            const gap = 8;
            const spaceBelow = window.innerHeight - rect.bottom - gap;
            const spaceAbove = rect.top - gap;
            setPlacement(spaceBelow < expectedHeight && spaceAbove > spaceBelow ? "above" : "below");
        };
        updatePlacement();
        const raf = window.requestAnimationFrame(updatePlacement);
        window.addEventListener("resize", updatePlacement);
        window.addEventListener("scroll", updatePlacement, true);
        return () => {
            window.cancelAnimationFrame(raf);
            window.removeEventListener("resize", updatePlacement);
            window.removeEventListener("scroll", updatePlacement, true);
        };
    }, [anchorRef, open, expectedHeight]);

    return placement;
}
