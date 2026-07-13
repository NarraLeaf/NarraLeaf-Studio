import type { BlueprintFrontendKind } from "@shared/types/blueprint/document";
import { useTranslation } from "@/lib/i18n";

export function BlueprintFrontendBadge({ kind }: { kind: BlueprintFrontendKind }) {
    const { t } = useTranslation();
    const isTs = kind === "typescript";
    // "TypeScript" is a product name and stays untranslated.
    const label = isTs ? "TypeScript" : t("blueprint.frontend.visual");
    return (
        <span
            className={`inline-flex items-center rounded px-1.5 py-0.5 text-2xs font-medium tracking-wide ${
                isTs ? "bg-amber-500/15 text-amber-200/90" : "bg-cyan-500/15 text-cyan-200/90"
            }`}
        >
            {label}
        </span>
    );
}
