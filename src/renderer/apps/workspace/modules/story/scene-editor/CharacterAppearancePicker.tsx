import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, ImageOff } from "lucide-react";
import type { StoryCharacterVariantSelection } from "@shared/types/story";
import type { Character } from "@/lib/workspace/services/character/Character";
import type { CharacterForm, CharacterVariantGroup } from "@/lib/workspace/services/character/types";
import { useAssetObjectUrl } from "@/lib/workspace/hooks/useAssetObjectUrl";

const COLUMN = "flex w-40 shrink-0 flex-col gap-1";
const CARD = "flex items-center gap-2 rounded-md border p-1.5 text-left text-xs transition-colors";

function groupLabel(name: string): string {
    return name === "__default__" ? "Appearance" : name;
}
function variantLabel(name: string): string {
    return name === "__default__" ? "Default" : name;
}

/** Real groups, or a synthetic single group when the form only has ungrouped variant assets. */
function groupsOf(form: CharacterForm): CharacterVariantGroup[] {
    if (form.groups.length > 0) {
        return form.groups;
    }
    const names = Object.keys(form.variantAssets);
    return names.length > 0
        ? [{ name: "__default__", defaultVariant: names[0], variants: names.map(name => ({ name })) }]
        : [];
}

function variantAssetId(form: CharacterForm, variantName: string | undefined): string | null {
    if (!variantName) {
        return null;
    }
    return form.variantAssets[variantName]?.data?.id ?? null;
}

function formThumbnailId(form: CharacterForm): string | null {
    for (const group of groupsOf(form)) {
        const id = variantAssetId(form, group.defaultVariant ?? group.variants[0]?.name);
        if (id) {
            return id;
        }
    }
    return null;
}

function getVariantSelectionMap(selection: StoryCharacterVariantSelection | undefined, form: CharacterForm): Record<string, string> {
    if (!selection) {
        return {};
    }
    if (Array.isArray(selection)) {
        const groupByVariant = new Map<string, string>();
        for (const group of groupsOf(form)) {
            for (const variant of group.variants) {
                groupByVariant.set(variant.name, group.name);
            }
        }
        const result: Record<string, string> = {};
        for (const variant of selection) {
            const group = groupByVariant.get(variant);
            if (group) {
                result[group] = variant;
            }
        }
        return result;
    }
    return { ...selection };
}

function normalizeVariantSelection(map: Record<string, string>): StoryCharacterVariantSelection | undefined {
    const entries = Object.entries(map).filter(([, variant]) => variant.trim());
    return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function Thumb(props: { assetId: string | null; className?: string; alt?: string }) {
    const { url } = useAssetObjectUrl(props.assetId);
    if (!url) {
        return (
            <div className={["grid place-items-center rounded bg-black/30 text-slate-600", props.className ?? ""].join(" ")}>
                <ImageOff className="h-4 w-4" />
            </div>
        );
    }
    return <img src={url} alt={props.alt ?? ""} className={["object-contain", props.className ?? ""].join(" ")} draggable={false} />;
}

/**
 * Finder-style miller-column browser for a character's appearance:
 * Form → Appearance group → Variant → large preview. New columns appear as selections are made and
 * the strip auto-scrolls to reveal them.
 */
export function CharacterAppearancePicker(props: {
    character: Character;
    formName: string | undefined;
    variants: StoryCharacterVariantSelection | undefined;
    onChange: (next: { formName: string | undefined; variants: StoryCharacterVariantSelection | undefined }) => void;
}) {
    const forms = props.character.profile.appearance.getForms();
    const defaultFormName = props.character.profile.getDefaultForm();
    const selectedForm = useMemo(
        () => forms.find(form => form.name === props.formName)
            ?? forms.find(form => form.name === defaultFormName)
            ?? forms[0]
            ?? null,
        [forms, props.formName, defaultFormName],
    );
    const groups = selectedForm ? groupsOf(selectedForm) : [];
    const [activeGroup, setActiveGroup] = useState<string | null>(groups[0]?.name ?? null);
    const scrollRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        setActiveGroup(current => (current && groups.some(group => group.name === current) ? current : groups[0]?.name ?? null));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedForm?.name]);

    const selectionMap = selectedForm ? getVariantSelectionMap(props.variants, selectedForm) : {};
    const activeGroupObj = groups.find(group => group.name === activeGroup) ?? null;
    const selectedVariant = activeGroupObj
        ? selectionMap[activeGroupObj.name] ?? activeGroupObj.defaultVariant ?? undefined
        : undefined;

    const columnCount = 1 + (selectedForm ? 1 : 0) + (activeGroupObj ? 1 : 0) + (selectedVariant ? 1 : 0);
    useEffect(() => {
        const el = scrollRef.current;
        if (el) {
            el.scrollTo({ left: el.scrollWidth, behavior: "smooth" });
        }
    }, [columnCount, activeGroup]);

    const selectForm = (name: string) => {
        props.onChange({ formName: name, variants: undefined });
        const nextForm = forms.find(form => form.name === name);
        setActiveGroup(nextForm ? groupsOf(nextForm)[0]?.name ?? null : null);
    };
    const selectVariant = (groupName: string, variant: string) => {
        props.onChange({
            formName: selectedForm?.name,
            variants: normalizeVariantSelection({ ...selectionMap, [groupName]: variant }),
        });
    };

    if (forms.length === 0) {
        return <div className="rounded-md border border-dashed border-white/10 bg-black/10 p-3 text-xs text-slate-500">This character has no forms defined.</div>;
    }

    return (
        <div ref={scrollRef} className="flex gap-3 overflow-x-auto rounded-lg border border-white/10 bg-black/20 p-2">
            <div className={COLUMN}>
                <div className="px-1 text-[10px] font-medium uppercase tracking-wide text-slate-500">Form</div>
                {forms.map(form => {
                    const active = form.name === selectedForm?.name;
                    return (
                        <button
                            key={form.name}
                            type="button"
                            onClick={() => selectForm(form.name)}
                            className={[CARD, active ? "border-primary/60 bg-primary/15" : "border-white/10 hover:bg-white/5"].join(" ")}
                        >
                            <Thumb assetId={formThumbnailId(form)} className="h-8 w-8 shrink-0" />
                            <span className="min-w-0 flex-1 truncate text-slate-200">{form.name}</span>
                            {active ? <ChevronRight className="h-3.5 w-3.5 shrink-0 text-primary" /> : null}
                        </button>
                    );
                })}
            </div>

            {selectedForm ? (
                <div className={COLUMN}>
                    <div className="px-1 text-[10px] font-medium uppercase tracking-wide text-slate-500">Appearance</div>
                    {groups.map(group => {
                        const active = group.name === activeGroup;
                        const currentVariant = selectionMap[group.name] ?? group.defaultVariant ?? group.variants[0]?.name;
                        return (
                            <button
                                key={group.name}
                                type="button"
                                onClick={() => setActiveGroup(group.name)}
                                className={[CARD, active ? "border-primary/60 bg-primary/15" : "border-white/10 hover:bg-white/5"].join(" ")}
                            >
                                <Thumb assetId={variantAssetId(selectedForm, currentVariant)} className="h-8 w-8 shrink-0" />
                                <span className="min-w-0 flex-1">
                                    <span className="block truncate text-slate-200">{groupLabel(group.name)}</span>
                                    <span className="block truncate text-[10px] text-slate-500">{currentVariant ? variantLabel(currentVariant) : "—"}</span>
                                </span>
                                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-500" />
                            </button>
                        );
                    })}
                </div>
            ) : null}

            {activeGroupObj && selectedForm ? (
                <div className={COLUMN}>
                    <div className="px-1 text-[10px] font-medium uppercase tracking-wide text-slate-500">{groupLabel(activeGroupObj.name)}</div>
                    {activeGroupObj.variants.map(variant => {
                        const active = selectionMap[activeGroupObj.name] === variant.name;
                        return (
                            <button
                                key={variant.name}
                                type="button"
                                onClick={() => selectVariant(activeGroupObj.name, variant.name)}
                                className={[CARD, active ? "border-primary/60 bg-primary/15" : "border-white/10 hover:bg-white/5"].join(" ")}
                            >
                                <Thumb assetId={variantAssetId(selectedForm, variant.name)} className="h-8 w-8 shrink-0" />
                                <span className="min-w-0 flex-1 truncate text-slate-200">{variantLabel(variant.name)}</span>
                            </button>
                        );
                    })}
                </div>
            ) : null}

            {selectedForm && selectedVariant ? (
                <div className="flex w-44 shrink-0 flex-col gap-1">
                    <div className="px-1 text-[10px] font-medium uppercase tracking-wide text-slate-500">Preview</div>
                    <div className="grid min-h-[8rem] flex-1 place-items-center rounded-md border border-white/10 bg-[#0f1115] p-2">
                        <Thumb assetId={variantAssetId(selectedForm, selectedVariant)} className="max-h-40 w-full" alt={selectedVariant} />
                    </div>
                    <div className="truncate px-1 text-center text-[11px] text-slate-400">{variantLabel(selectedVariant)}</div>
                </div>
            ) : null}
        </div>
    );
}
