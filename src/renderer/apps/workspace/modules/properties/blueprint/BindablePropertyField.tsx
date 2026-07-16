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
import { useTranslation } from "@/lib/i18n";
import type { FieldDefinition } from "../framework/types";
import type { UIInspectorData } from "@/lib/ui-editor/widget-modules/types";
import type { PropertyFieldBindingMeta } from "./bindingMeta";
import { usePropertyBindingState, type FieldStateScope } from "./usePropertyBindingState";
import { EnhancedInput } from "@/lib/components/inputs/EnhancedInput";

type Props<TData> = {
    field: FieldDefinition<TData> & { binding: PropertyFieldBindingMeta };
    data: UIInspectorData;
    onSaving: (saving: boolean) => void;
    children: ReactElement;
};

function statusBadgeClass(status: string): string {
    if (status === "bound") {
        return "bg-binding/15 text-binding border-binding/30";
    }
    if (status === "broken") {
        return "bg-warning/15 text-warning border-warning/30";
    }
    return "bg-fill-subtle text-fg-muted border-edge";
}

export function BindablePropertyField<TData>({ field, data, onSaving, children }: Props<TData>) {
    const { t } = useTranslation();
    const bp = usePropertyBindingState(data, field.binding);
    const scopeLabel = (scope: FieldStateScope | null): string =>
        scope === "global"
            ? t("properties.binding.scopeApp")
            : scope === "item"
              ? t("properties.binding.scopeItem")
              : t("properties.binding.scopePage");
    const [pickerOpen, setPickerOpen] = useState(false);
    const [query, setQuery] = useState("");
    const [newFieldName, setNewFieldName] = useState("");
    const [newFieldScope, setNewFieldScope] = useState<FieldStateScope>("surface");
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
        document.addEventListener("mousedown", onDoc, true);
        return () => document.removeEventListener("mousedown", onDoc, true);
    }, [pickerOpen]);

    useEffect(() => {
        if (pickerOpen) {
            setQuery("");
            setNewFieldName(field.binding.propPath);
            setNewFieldScope("surface");
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
            bp.createAndBindWithName(name, newFieldScope);
        } finally {
            onSaving(false);
        }
        setPickerOpen(false);
    }, [bp, newFieldName, newFieldScope, onSaving]);

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
                    className={`rounded border px-2 py-0.5 text-2xs font-medium capitalize tracking-wide ${statusBadgeClass(bp.status)}`}
                >
                    {bp.status}
                </span>
                {bp.status === "bound" || bp.status === "broken" ? (
                    <span className="text-2xs text-fg-muted">
                        {bp.fieldLabel ? (
                            <>
                                {t("properties.binding.fieldLabel")} <span className="text-fg">{bp.fieldLabel}</span>
                            </>
                        ) : (
                            <span className="text-warning">{t("properties.binding.fieldMissing")}</span>
                        )}
                    </span>
                ) : null}
                {bp.stateKey ? (
                    <span className="block w-full text-2xs text-fg-subtle">
                        {t("properties.binding.scopeKey", { scope: scopeLabel(bp.stateScope) })}{" "}
                        <span className="font-mono text-2xs text-binding">{bp.stateKey}</span>
                    </span>
                ) : null}
                {bp.status === "broken" && bp.brokenReason ? (
                    <span className="text-2xs text-fg-subtle">({bp.brokenReason})</span>
                ) : null}
            </div>
            <div className="relative flex flex-wrap gap-2" ref={wrapRef}>
                {bp.status === "literal" ? (
                    <>
                        <button
                            type="button"
                            disabled={!bp.canBind}
                            className="rounded border border-binding/40 bg-binding/10 px-2 py-1 text-2xs text-binding hover:bg-binding/20 disabled:cursor-not-allowed disabled:opacity-40"
                            onClick={() => openPicker()}
                            title={
                                !bp.canBind
                                    ? t("properties.binding.notReady")
                                    : undefined
                            }
                        >
                            {t("properties.binding.bindToField")}
                        </button>
                        {pickerOpen ? (
                            <div className="absolute left-0 top-full z-50 mt-1 w-[min(100%,20rem)] rounded-lg border border-edge bg-surface-sunken p-3 shadow-xl">
                                <div className="mb-2 flex items-center justify-between gap-2">
                                    <span className="text-2xs font-medium text-fg">{t("properties.binding.bindProperty")}</span>
                                    <button
                                        type="button"
                                        className="rounded p-0.5 text-fg-subtle hover:bg-fill hover:text-fg-muted"
                                        aria-label={t("properties.binding.closePicker")}
                                        onClick={() => setPickerOpen(false)}
                                    >
                                        <X className="h-3.5 w-3.5" />
                                    </button>
                                </div>
                                <div className="mb-2">
                                    <EnhancedInput
                                        value={query}
                                        onChange={setQuery}
                                        placeholder={t("properties.binding.searchFields")}
                                        leftIcon={<Search className="h-3.5 w-3.5 text-fg-subtle" />}
                                        className="w-full"
                                        inputClassName="text-2xs"
                                    />
                                </div>
                                <div className="mb-2 max-h-32 overflow-auto rounded border border-edge">
                                    {filteredCandidates.length === 0 ? (
                                        <p className="px-2 py-2 text-2xs text-fg-subtle">{t("properties.binding.noMatches")}</p>
                                    ) : (
                                        filteredCandidates.map(c => (
                                            <button
                                                key={c.id}
                                                type="button"
                                                className="flex w-full flex-col items-start gap-0.5 px-2 py-1.5 text-left hover:bg-fill-subtle"
                                                onClick={() => pickExisting(c.id)}
                                            >
                                                <span className="text-2xs text-fg">{c.name}</span>
                                            </button>
                                        ))
                                    )}
                                </div>
                                <div className="border-t border-edge pt-2">
                                    <p className="mb-1 text-2xs tracking-wide text-fg-subtle">{t("properties.binding.newField")}</p>
                                    <div className="mb-1.5 flex gap-1">
                                        {(["surface", "global", "item"] as const).map(scope => (
                                            <button
                                                key={scope}
                                                type="button"
                                                className={`rounded px-2 py-0.5 text-2xs font-medium transition-colors ${
                                                    newFieldScope === scope
                                                        ? "bg-binding/20 text-binding border border-binding/40"
                                                        : "bg-fill-subtle text-fg-muted border border-edge hover:bg-fill"
                                                }`}
                                                onClick={() => setNewFieldScope(scope)}
                                            >
                                                {scopeLabel(scope)}
                                            </button>
                                        ))}
                                    </div>
                                    <div className="flex gap-1.5">
                                        <EnhancedInput
                                            value={newFieldName}
                                            onChange={setNewFieldName}
                                            placeholder={t("common.name")}
                                            className="min-w-0 flex-1"
                                            inputClassName="text-2xs"
                                            onKeyDown={e => {
                                                if (e.key === "Enter") {
                                                    e.preventDefault();
                                                    submitNew();
                                                }
                                            }}
                                        />
                                        <button
                                            type="button"
                                            className="shrink-0 rounded border border-binding/40 bg-binding/15 px-2 py-1 text-2xs font-medium text-binding hover:bg-binding/25"
                                            onClick={() => submitNew()}
                                        >
                                            {t("properties.binding.createAndBind")}
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
                            className="rounded border border-edge px-2 py-1 text-2xs text-fg hover:bg-fill-subtle"
                            onClick={() => bp.goToField()}
                        >
                            {t("properties.binding.openField")}
                        </button>
                        <button
                            type="button"
                            className="rounded border border-edge px-2 py-1 text-2xs text-fg-muted hover:bg-fill-subtle"
                            onClick={() => bp.unbind()}
                        >
                            {t("properties.binding.removeBinding")}
                        </button>
                    </>
                ) : null}
                {bp.status === "broken" ? (
                    <>
                        <button
                            type="button"
                            className="rounded border border-edge px-2 py-1 text-2xs text-fg-muted hover:bg-fill-subtle"
                            onClick={() => bp.unbind()}
                        >
                            {t("properties.binding.removeBroken")}
                        </button>
                    </>
                ) : null}
            </div>
            {child}
        </div>
    );
}
