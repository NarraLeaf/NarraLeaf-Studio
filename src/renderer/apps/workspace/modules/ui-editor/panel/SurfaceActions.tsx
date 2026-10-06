import { ClipboardPaste, LayoutTemplate, Plus } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { useFreezeGuard } from "../../../components/ui/freezeGuard";
import { interfaceDocumentFreezeScope } from "../uiLiveSession";

type SurfaceActionsProps = {
    onCreate: () => void;
    createLabel: string;
    createDisabled: boolean;
    onOpenTemplateStore: () => void;
    templateLabel: string;
    templateDisabled: boolean;
    /**
     * Add the interface on the machine's clipboard, or undefined when there is not one.
     *
     * Undefined removes the control rather than greying it. A disabled Paste is the affordance for
     * something the author could do and cannot right now - which is what the freeze guard renders,
     * and it says why. "Nothing has been copied" is not that: it is the ordinary state of a
     * clipboard, and a permanently greyed row over it teaches nothing.
     */
    onPaste?: () => void;
    pasteLabel: string;
};

const CREATE_CLASS =
    "flex h-10 items-center justify-center gap-2 rounded-md border border-edge-strong bg-surface-raised px-3 text-xs font-semibold text-fg transition-colors disabled:opacity-50 disabled:cursor-not-allowed hover:bg-fill hover:text-fg";
const SECONDARY_CLASS =
    "flex h-10 shrink-0 items-center justify-center gap-2 rounded-md border border-edge bg-surface-raised px-3 text-xs text-fg-muted transition-colors disabled:opacity-50 disabled:cursor-not-allowed hover:bg-fill hover:text-fg";

export function SurfaceActions({
    onCreate,
    createLabel,
    createDisabled,
    onOpenTemplateStore,
    templateLabel,
    templateDisabled,
    onPaste,
    pasteLabel,
}: SurfaceActionsProps) {
    // All three write: one creates a surface, one opens the store whose Apply imports a template
    // bundle into the interface document, and one adds a copied interface to it.
    const freeze = useFreezeGuard(interfaceDocumentFreezeScope());
    return (
        <div className="shrink-0 px-2 mt-2 space-y-1.5">
            <div className="flex gap-2">
                <button
                    type="button"
                    onClick={onCreate}
                    {...freeze.writes(createDisabled)}
                    className={cn(CREATE_CLASS, "min-w-0 flex-1")}
                >
                    <Plus className="w-4 h-4 shrink-0" />
                    <span className="truncate">{createLabel}</span>
                </button>
                <button
                    type="button"
                    onClick={onOpenTemplateStore}
                    // An icon beside Create: the name is its tip and what a screen reader says.
                    {...freeze.writes(templateDisabled, templateLabel)}
                    aria-label={templateLabel}
                    data-surface-template-store=""
                    className={SECONDARY_CLASS}
                >
                    <LayoutTemplate className="w-4 h-4 shrink-0" />
                </button>
                {onPaste && (
                    <button
                        type="button"
                        onClick={onPaste}
                        {...freeze.writes(false, pasteLabel)}
                        aria-label={pasteLabel}
                        className={SECONDARY_CLASS}
                    >
                        <ClipboardPaste className="w-4 h-4" />
                    </button>
                )}
            </div>
        </div>
    );
}
