import type { CustomFieldProps } from "@/apps/workspace/modules/properties/framework/types";
import type { UIInspectorData } from "@/lib/ui-editor/widget-modules/types";
import { useTranslation } from "@/lib/i18n";
import { useBlueprintEventBindingState } from "./useBlueprintEventBindingState";

/**
 * Properties-panel block: wire widget runtime events to blueprint layers (uidoc `blueprintEvent`).
 */
export function BlueprintEventBindingField(props: CustomFieldProps<UIInspectorData>) {
    const { t } = useTranslation();
    const { data } = props;
    const { rows, hasEvents } = useBlueprintEventBindingState(data);

    if (!hasEvents) {
        return null;
    }

    return (
        <div className="mt-2 space-y-2 border-t border-edge-subtle pt-3">
            <p className="text-2xs tracking-wide text-fg-subtle">{t("properties.events.title")}</p>
            <div className="flex flex-wrap gap-1.5">
                {rows.map(row => (
                    <span
                        key={row.eventId}
                        className="rounded border border-edge bg-[#0d0f11] px-2 py-1 text-2xs text-fg"
                        title={row.description}
                    >
                        {row.displayName}
                    </span>
                ))}
            </div>
            {rows.some(row => row.legacyGraphEventId && row.legacyGraphEventId !== row.eventId) ? (
                <p className="text-2xs text-amber-200/90">{t("properties.events.legacy")}</p>
            ) : null}
        </div>
    );
}
