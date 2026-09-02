import type { BlueprintFrontendKind } from "@shared/types/blueprint/document";
import { useTranslation } from "@/lib/i18n";

/**
 * Which of the two a revision is: a blueprint, or a script.
 *
 * The label is the category rather than the language. An author holds one distinction here - a
 * graph on a canvas, or a file they own - and printing "TypeScript" where the other side says
 * "Blueprint" asked them to hold two.
 */
export function BlueprintFrontendBadge({ kind }: { kind: BlueprintFrontendKind }) {
    const { t } = useTranslation();
    const isTs = kind === "typescript";
    const label = isTs ? t("blueprint.frontend.script") : t("blueprint.frontend.visual");
    return (
        <span
            className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-2xs font-medium tracking-wide ${
                isTs ? "bg-warning/15 text-warning" : "bg-primary/15 text-primary"
            }`}
        >
            {label}
        </span>
    );
}
