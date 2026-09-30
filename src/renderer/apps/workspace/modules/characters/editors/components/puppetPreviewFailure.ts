import type { InterpolationParams, TranslationKey } from "@shared/i18n";
import { SurfacePuppetUnavailableError } from "@/lib/ui-editor/runtime/game/surfacePuppetSession";

/**
 * The line under "This model could not be drawn": why, when the mount was refused before it began -
 * no model bundle, no runtime chosen, the chosen runtime not installed, a project not trusted. The
 * same sentences the puppet widget's placeholder says for the same four refusals, so the preview and
 * the widget never disagree about one puppet.
 *
 * Null for a mount that got under way and then failed. What that threw is the runtime's own message
 * - code the project supplies, or a module load error that names the bundle's `app://` address - and
 * it goes to the console, not under the preview.
 */
export function describePuppetPreviewFailure(
    reason: unknown,
    backend: string,
    t: (key: TranslationKey, params?: InterpolationParams) => string,
): string | null {
    if (!(reason instanceof SurfacePuppetUnavailableError)) {
        return null;
    }
    switch (reason.reason) {
        case "no-model":
            return t("widgets.puppet.placeholderNoModel");
        case "no-backend":
            return t("widgets.puppet.placeholderUnconfigured");
        case "backend-missing":
            return t("widgets.puppet.placeholderBackendMissing", { backend });
        case "distrusted":
            return t("widgets.puppet.placeholderDistrusted");
        default: {
            const unconsidered: never = reason.reason;
            return unconsidered;
        }
    }
}
