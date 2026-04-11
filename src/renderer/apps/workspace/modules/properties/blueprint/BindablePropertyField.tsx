import {
    cloneElement,
    isValidElement,
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
    type ReactElement,
} from "react";
import { Search, X } from "lucide-react";
import type { FieldDefinition } from "../framework/types";
import type { UIInspectorData } from "@/lib/ui-editor/widget-modules/types";
import type { PropertyFieldBindingMeta } from "./bindingMeta";
import { usePropertyBindingState } from "./usePropertyBindingState";
import { EnhancedInput } from "@/lib/components/inputs/EnhancedInput";

type Props<TData> = {
    field: FieldDefinition<TData> & { binding: PropertyFieldBindingMeta };
    data: UIInspectorData;
    onSaving: (saving: boolean) => void;
    children: ReactElement;
};

function statusBadgeClass(status: string): string {
    if (status === "bound") {
        return "bg-cyan-500/15 text-cyan-200 border-cyan-500/30";
    }
    if (status === "broken") {
        return "bg-amber-500/15 text-amber-200 border-amber-500/30";
    }
    return "bg-white/5 text-gray-400 border-white/10";
}

export function BindablePropertyField<TData>({ field, data, onSaving, children }: Props<TData>) {
    const bp = usePropertyBindingState(data, field.binding);
    const [pickerOpen, setPickerOpen] = useState(false);
    const [query, setQuery] = useState("");
    const [newFieldName, setNewFieldName] = useState("");
    const wrapRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!pickerOpen) {
            return undefined;
        }
        const onDoc = (e: MouseEvent) => {
            const el = wrapRef.current;
            if (el && e.target instanceof Node && !el.contains(e.target)) {
                setPickerOpen(false);
            }
        };
        document.addEventListener("mousedown", onDoc);
        return () => document.removeEventListener("mousedown", onDoc);
    }, [pickerOpen]);

    useEffect(() => {
        if (pickerOpen) {
            setQuery("");
            setNewFieldName(field.binding.propPath);
        }
    }, [field.binding.propPath, pickerOpen]);

    const filteredCandidates = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) {
            return bp.fieldCandidates;
        }
        return bp.fieldCandidates.filter(
            c => c.name.toLowerCase().includes(q) || c.id.toLowerCase().includes(q),
        );
    }, [bp.fieldCandidates, query]);

    const openPicker = useCallback(() => {
        setPickerOpen(true);
    }, []);

    const pickExisting = useCallback(
        (id: string) => {
            onSaving(true);
            try {
                bp.bindToExistingField(id);
            } finally {
                onSaving(false);
            }
            setPickerOpen(false);
        },
        [bp, onSaving],
    );

    const submitNew = useCallback(() => {
        const name = newFieldName.trim();
        if (!name) {
            return;
        }
        onSaving(true);
        try {
            bp.createAndBindWithName(name);
        } finally {
            onSaving(false);
        }
        setPickerOpen(false);
    }, [bp, newFieldName, onSaving]);

    const child = isValidElement(children)
        ? cloneElement(children as ReactElement<{ field: typeof field; data: TData; onSaving: typeof onSaving }>, {
              field: { ...field, readOnly: Boolean(field.readOnly) || bp.uiLocked },
              data: data as TData,
              onSaving,
          })
        : children;

    return (
        <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
                <span
                    className={`rounded border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${statusBadgeClass(bp.status)}`}
                >
                    {bp.status}
                </span>
                {bp.status === "bound" || bp.status === "broken" ? (
                    <span className="text-[11px] text-gray-400">
                        {bp.fieldLabel ? (
                            <>
                                Field <span className="text-gray-200">{bp.fieldLabel}</span>
                            </>
                        ) : (
                            <span className="text-amber-300/90">Field missing</span>
                        )}
                    </span>
                ) : null}
                {bp.surfaceStateKey ? (
                    <span className="block w-full text-[10px] text-gray-500">
                        Surface state key{" "}
                        <span className="font-mono text-[10px] text-cyan-200/80">{bp.surfaceStateKey}</span>
                        <span className="text-gray-600"> — write via blueprint host </span>
                        <span className="font-mono text-[9px] text-gray-500">state.set(&quot;surface&quot;, …)</span>
                    </span>
                ) : null}
                {bp.status === "broken" && bp.brokenReason ? (
                    <span className="text-[10px] text-gray-500">({bp.brokenReason})</span>
                ) : null}
            </div>
            <div className="relative flex flex-wrap gap-2" ref={wrapRef}>
                {bp.status === "literal" ? (
                    <>
                        <button
                            type="button"
                            disabled={!bp.canBind}
                            className="rounded border border-cyan-500/40 bg-cyan-500/10 px-2 py-1 text-[11px] text-cyan-100 hover:bg-cyan-500/20 disabled:cursor-not-allowed disabled:opacity-40"
                            onClick={() => openPicker()}
                            title={
                                !bp.canBind
                                    ? "Widget main blueprint is not available for this element yet."
                                    : "Search an existing field or create a new one"
                            }
                        >
                            Bind to field…
                        </button>
                        {pickerOpen ? (
                            <div className="absolute left-0 top-full z-50 mt-1 w-[min(100%,20rem)] rounded-lg border border-white/15 bg-[#0b0d12] p-3 shadow-xl">
                                <div className="mb-2 flex items-center justify-between gap-2">
                                    <span className="text-[11px] font-medium text-gray-200">Bind property</span>
                                    <button
                                        type="button"
                                        className="rounded p-0.5 text-gray-500 hover:bg-white/10 hover:text-gray-300"
                                        aria-label="Close binding picker"
                                        onClick={() => setPickerOpen(false)}
                                    >
                                        <X className="h-3.5 w-3.5" />
                                    </button>
                                </div>
                                <div className="mb-2">
                                    <EnhancedInput
                                        value={query}
                                        onChange={setQuery}
                                        placeholder="Search fields…"
                                        leftIcon={<Search className="h-3.5 w-3.5 text-gray-500" />}
                                        className="w-full"
                                        inputClassName="text-[11px]"
                                    />
                                </div>
                                <div className="mb-2 max-h-32 overflow-auto rounded border border-white/10">
                                    {filteredCandidates.length === 0 ? (
                                        <p className="px-2 py-2 text-[10px] text-gray-500">No matching fields.</p>
                                    ) : (
                                        filteredCandidates.map(c => (
                                            <button
                                                key={c.id}
                                                type="button"
                                                className="flex w-full flex-col items-start gap-0.5 px-2 py-1.5 text-left hover:bg-white/5"
                                                onClick={() => pickExisting(c.id)}
                                            >
                                                <span className="text-[11px] text-gray-200">{c.name}</span>
                                                <span className="font-mono text-[9px] text-gray-500">{c.id}</span>
                                            </button>
                                        ))
                                    )}
                                </div>
                                <div className="border-t border-white/10 pt-2">
                                    <p className="mb-1 text-[10px] uppercase tracking-wide text-gray-500">New field</p>
                                    <div className="flex gap-1.5">
                                        <EnhancedInput
                                            value={newFieldName}
                                            onChange={setNewFieldName}
                                            placeholder="Name"
                                            className="min-w-0 flex-1"
                                            inputClassName="text-[11px]"
                                            onKeyDown={e => {
                                                if (e.key === "Enter") {
                                                    e.preventDefault();
                                                    submitNew();
                                                }
                                            }}
                                        />
                                        <button
                                            type="button"
                                            className="shrink-0 rounded border border-cyan-500/40 bg-cyan-500/15 px-2 py-1 text-[10px] font-medium text-cyan-100 hover:bg-cyan-500/25"
                                            onClick={() => submitNew()}
                                        >
                                            Create &amp; bind
                                        </button>
                                    </div>
                                </div>
                            </div>
                        ) : null}
                    </>
                ) : null}
                {bp.status === "bound" ? (
                    <>
                        <button
                            type="button"
                            className="rounded border border-white/10 px-2 py-1 text-[11px] text-gray-200 hover:bg-white/5"
                            onClick={() => bp.goToField()}
                        >
                            Open field
                        </button>
                        <button
                            type="button"
                            className="rounded border border-white/10 px-2 py-1 text-[11px] text-gray-300 hover:bg-white/5"
                            onClick={() => bp.unbind()}
                        >
                            Remove binding
                        </button>
                    </>
                ) : null}
                {bp.status === "broken" ? (
                    <>
                        <button
                            type="button"
                            className="rounded border border-white/10 px-2 py-1 text-[11px] text-gray-300 hover:bg-white/5"
                            onClick={() => bp.unbind()}
                        >
                            Remove broken binding
                        </button>
                    </>
                ) : null}
            </div>
            {child}
        </div>
    );
}
