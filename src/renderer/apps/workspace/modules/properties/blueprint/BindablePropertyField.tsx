import { cloneElement, isValidElement, type ReactElement } from "react";
import type { FieldDefinition } from "../framework/types";
import type { UIInspectorData } from "@/lib/ui-editor/widget-modules/types";
import type { PropertyFieldBindingMeta } from "./bindingMeta";
import { usePropertyBindingState } from "./usePropertyBindingState";

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
                        {bp.declarationLabel ? (
                            <>
                                Declaration <span className="text-gray-200">{bp.declarationLabel}</span>
                            </>
                        ) : (
                            <span className="text-amber-300/90">Declaration missing</span>
                        )}
                    </span>
                ) : null}
                {bp.status === "broken" && bp.brokenReason ? (
                    <span className="text-[10px] text-gray-500">({bp.brokenReason})</span>
                ) : null}
            </div>
            <div className="flex flex-wrap gap-2">
                {bp.status === "literal" ? (
                    <button
                        type="button"
                        disabled={!bp.canBind}
                        className="rounded border border-cyan-500/40 bg-cyan-500/10 px-2 py-1 text-[11px] text-cyan-100 hover:bg-cyan-500/20 disabled:cursor-not-allowed disabled:opacity-40"
                        onClick={() => bp.bind()}
                        title={!bp.canBind ? "Widget main blueprint is not available for this element yet." : undefined}
                    >
                        Bind to declaration…
                    </button>
                ) : null}
                {bp.status === "bound" ? (
                    <>
                        <button
                            type="button"
                            className="rounded border border-white/10 px-2 py-1 text-[11px] text-gray-200 hover:bg-white/5"
                            onClick={() => bp.goToDeclaration()}
                        >
                            Open declaration
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
