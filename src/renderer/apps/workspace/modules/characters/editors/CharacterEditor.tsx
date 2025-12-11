import { useEffect, useMemo, useState } from "react";
import { Plus, Settings } from "lucide-react";
import { EditorComponentProps } from "../../types";
import { Character } from "@/lib/workspace/services/character/Character";
import { CharacterForm, CharacterVariantGroup } from "@/lib/workspace/services/character/types";

type CharacterEditorPayload = {
    character: Character;
};

const fallbackColors = ["#f97316", "#22c55e", "#6366f1", "#eab308", "#14b8a6", "#ec4899", "#0ea5e9"];

function pickColor(index: number): string {
    return fallbackColors[index % fallbackColors.length];
}

export function CharacterEditor({ payload }: EditorComponentProps<CharacterEditorPayload>) {
    const appearance = payload?.character.profile.appearance;
    const [characterVersion, setCharacterVersion] = useState(0);
    const forms = useMemo(() => appearance?.getForms() ?? [], [appearance, characterVersion]);

    const [activeFormName, setActiveFormName] = useState(forms[0]?.name ?? "");
    const [selectedVariants, setSelectedVariants] = useState<Record<string, string>>({});
    const [version, setVersion] = useState(0);

    // When version or forms change, recompute active form and selections.
    const formList = useMemo(() => appearance?.getForms() ?? [], [appearance, version]);
    const activeForm = useMemo<CharacterForm | undefined>(() => {
        if (!formList.length) return undefined;
        return formList.find(f => f.name === activeFormName) ?? formList[0];
    }, [formList, activeFormName]);

    useEffect(() => {
        if (!activeForm) {
            setSelectedVariants({});
            return;
        }
        setActiveFormName(activeForm.name);
        setSelectedVariants(prev => {
            const next: Record<string, string> = {};
            activeForm.groups.forEach(group => {
                const prevSelected = prev[group.name];
                const stillValid = prevSelected && group.variants.some(v => v.name === prevSelected);
                next[group.name] = stillValid
                    ? prevSelected
                    : group.defaultVariant || group.variants[0]?.name || "";
            });
            return next;
        });
    }, [activeForm]);

    const forceRefresh = () => setVersion(v => v + 1);

    useEffect(() => {
        if (!payload?.character) return;
        const unsubscribe = payload.character.subscribe(() => {
            setCharacterVersion(v => v + 1);
        });
        return () => unsubscribe();
    }, [payload?.character]);

    const handleVariantSelect = (groupName: string, variantName: string) => {
        setSelectedVariants(prev => ({ ...prev, [groupName]: variantName }));
    };

    const handleAddForm = () => {
        if (!appearance) return;
        const name = window.prompt("Enter new form name");
        if (!name) return;
        if (appearance.getForm(name)) {
            window.alert("Form already exists");
            return;
        }
        appearance.ensureForm(name);
        setActiveFormName(name);
        forceRefresh();
    };

    const handleDeleteForm = (name: string) => {
        if (!appearance) return;
        if (!window.confirm(`Delete form "${name}"? Groups and variants inside will be removed.`)) return;
        appearance.removeForm(name);
        const remaining = appearance.getForms();
        setActiveFormName(remaining[0]?.name ?? "");
        forceRefresh();
    };

    const handleAddGroup = (formName: string) => {
        if (!appearance) return;
        const name = window.prompt("Enter new group name");
        if (!name) return;
        const form = appearance.getForm(formName);
        if (form?.groups.some(g => g.name === name)) {
            window.alert("Group already exists");
            return;
        }
        appearance.createGroup(formName, name, [], null);
        forceRefresh();
    };

    const handleDeleteGroup = (formName: string, groupName: string) => {
        if (!appearance) return;
        if (!window.confirm(`Delete group "${groupName}"? Variants inside will be removed.`)) return;
        appearance.removeGroup(formName, groupName);
        forceRefresh();
    };

    const handleAddVariant = (formName: string, group: CharacterVariantGroup) => {
        if (!appearance) return;
        const name = window.prompt("Enter new variant name");
        if (!name) return;
        if (group.variants.some(v => v.name === name)) {
            window.alert("Variant already exists");
            return;
        }
        const created = appearance.createVariantInGroup(formName, group.name, name);
        if (!group.defaultVariant) {
            group.defaultVariant = created.name;
        }
        forceRefresh();
    };

    const handleDeleteVariant = (formName: string, group: CharacterVariantGroup, variantName: string) => {
        if (!appearance) return;
        if (!window.confirm(`Delete variant "${variantName}"?`)) return;
        appearance.removeVariant(formName, group.name, variantName);
        forceRefresh();
    };

    const handleFormSettings = () => {
        // Placeholder for future form-level settings
        console.log("Open form settings");
    };

    const handleVariantSettings = () => {
        // Placeholder for future variant-level settings
        console.log("Open variant settings");
    };

    return (
        <div className="h-full bg-[#0f1115] text-gray-200 flex flex-col">
            <div className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
                <span className="text-sm font-semibold truncate">
                    {payload?.character.profile.getProfile().name || "Character"}
                </span>
                <span className="text-xs text-gray-500">Character Editor</span>
            </div>

            <div className="flex-1 grid grid-cols-[240px_1fr_280px] gap-0 overflow-hidden">
                <div className="border-r border-white/10 overflow-y-auto">
                    <div className="px-3 py-2 text-xs text-gray-400 flex items-center justify-between">
                        <span className="uppercase tracking-wide text-[11px] text-gray-400">Forms</span>
                        <div className="flex items-center gap-1">
                            <button
                                className="p-1 rounded-md text-gray-200 hover:text-white hover:bg-white/10 transition-colors"
                                onClick={handleAddForm}
                                title="Add form"
                                aria-label="Add form"
                            >
                                <Plus className="w-4 h-4" />
                            </button>
                            <button
                                className="p-1 rounded-md text-gray-300 hover:text-white hover:bg-white/10 transition-colors"
                                onClick={handleFormSettings}
                                title="Form settings"
                                aria-label="Form settings"
                            >
                                <Settings className="w-4 h-4" />
                            </button>
                        </div>
                    </div>
                    <div className="space-y-1 px-2 pb-3">
                        {formList.map((form, idx) => (
                            <div
                                key={form.name}
                                className={`w-full px-3 py-2 rounded-md border transition-colors cursor-pointer flex items-center justify-between ${form.name === activeForm?.name
                                    ? "border-primary/60 bg-primary/10 text-white"
                                    : "border-white/10 hover:border-white/20 text-gray-200"
                                    }`}
                                onClick={() => setActiveFormName(form.name)}
                            >
                                <div className="flex items-center gap-2 min-w-0">
                                    <span
                                        className="w-3 h-3 rounded-full flex-shrink-0"
                                        style={{ backgroundColor: pickColor(idx) }}
                                    />
                                    <span className="text-sm truncate">{form.name}</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <span className="text-[11px] text-gray-400">{form.groups.length} groups</span>
                                    <button
                                        className="text-[11px] text-gray-400 hover:text-red-400"
                                        onClick={(e) => { e.stopPropagation(); handleDeleteForm(form.name); }}
                                        title="Delete form"
                                    >
                                        Delete
                                    </button>
                                </div>
                            </div>
                        ))}
                        {formList.length === 0 && (
                            <div className="px-3 py-2 text-sm text-gray-500">No forms available</div>
                        )}
                    </div>
                </div>

                <div className="flex flex-col">
                    <div className="px-4 py-2 border-b border-white/10 flex items-center gap-3">
                        <span className="text-sm font-semibold">Preview</span>
                        {activeForm && (
                            <span className="text-xs text-gray-500">Current form: {activeForm.name}</span>
                        )}
                    </div>
                    <div className="flex-1 flex flex-col items-center justify-center gap-4">
                        <div className="w-64 h-64 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center relative overflow-hidden">
                            {activeForm ? (
                                <div className="flex flex-col items-center gap-3">
                                    <div
                                        className="w-32 h-32 rounded-full border-4 border-white/20"
                                        style={{ background: pickColor(formList.findIndex(f => f.name === activeForm.name)) }}
                                    />
                                    <div className="flex flex-wrap gap-2 justify-center max-w-[240px]">
                                        {activeForm.groups.map(group => {
                                            const variantId = selectedVariants[group.name];
                                            const variant = group.variants.find(v => v.name === variantId);
                                            return (
                                                <span
                                                    key={group.name}
                                                    className="text-[11px] px-2 py-1 rounded-full bg-white/10 border border-white/10"
                                                >
                                                    {group.name}: {variant?.name || "Unselected"}
                                                </span>
                                            );
                                        })}
                                    </div>
                                </div>
                            ) : (
                                <span className="text-gray-500 text-sm">No forms available</span>
                            )}
                        </div>
                    </div>
                </div>

                <div className="border-l border-white/10 overflow-y-auto">
                    <div className="px-4 py-2 border-b border-white/10 flex items-center justify-between">
                    <span className="uppercase tracking-wide text-[11px] text-gray-400">Variants</span>
                        <div className="flex items-center gap-1">
                            <button
                                className="p-1 rounded-md text-gray-200 hover:text-white hover:bg-white/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                                onClick={() => activeForm && handleAddGroup(activeForm.name)}
                                disabled={!activeForm}
                                title="Add group"
                                aria-label="Add group"
                            >
                                <Plus className="w-4 h-4" />
                            </button>
                            <button
                                className="p-1 rounded-md text-gray-300 hover:text-white hover:bg-white/10 transition-colors"
                                onClick={handleVariantSettings}
                                title="Variant settings"
                                aria-label="Variant settings"
                            >
                                <Settings className="w-4 h-4" />
                            </button>
                        </div>
                    </div>
                    <div className="p-3 space-y-3">
                        {activeForm?.groups.map(group => (
                            <div key={group.name} className="border border-white/10 rounded-lg">
                                <div className="px-3 py-2 border-b border-white/10 flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <span className="text-sm text-white">{group.name}</span>
                                        <span className="text-[11px] text-gray-400">{group.variants.length} variants</span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <button
                                            className="text-[11px] text-primary hover:text-primary/80"
                                            onClick={() => handleAddVariant(activeForm.name, group)}
                                        >
                                            Add variant
                                        </button>
                                        <button
                                            className="text-[11px] text-red-400 hover:text-red-300"
                                            onClick={() => handleDeleteGroup(activeForm.name, group.name)}
                                        >
                                            Delete group
                                        </button>
                                    </div>
                                </div>
                                <div className="p-2 space-y-2">
                                    {group.variants.map(variant => {
                                        const selected = selectedVariants[group.name] === variant.name;
                                        return (
                                            <div
                                                key={variant.name}
                                                className={`flex items-center justify-between px-3 py-2 rounded-md border transition-colors ${selected
                                                    ? "border-primary/60 bg-primary/10 text-white"
                                                    : "border-white/10 hover:border-white/20 text-gray-200"
                                                    }`}
                                            >
                                                <button
                                                    className="flex-1 text-left"
                                                    onClick={() => handleVariantSelect(group.name, variant.name)}
                                                >
                                                    <span className="text-sm">{variant.name}</span>
                                                    {selected && (
                                                        <span className="text-[11px] text-primary ml-2">Selected</span>
                                                    )}
                                                </button>
                                                <button
                                                    className="text-[11px] text-red-400 hover:text-red-300 ml-2"
                                                    onClick={() => handleDeleteVariant(activeForm.name, group, variant.name)}
                                                    title="Delete variant"
                                                >
                                                    Delete
                                                </button>
                                            </div>
                                        );
                                    })}
                                    {group.variants.length === 0 && (
                                        <div className="text-xs text-gray-500 px-2">No variants yet, click "Add variant".</div>
                                    )}
                                </div>
                            </div>
                        ))}
                        {!activeForm && (
                            <div className="text-sm text-gray-500">Select a form from the left.</div>
                        )}
                        {activeForm && activeForm.groups.length === 0 && (
                            <div className="text-sm text-gray-500">This form has no groups yet, use the plus button above.</div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}