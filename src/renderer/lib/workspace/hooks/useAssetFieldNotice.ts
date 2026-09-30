import { useMemo } from "react";
import { useOptionalWorkspace } from "@/apps/workspace/context";
import { useTranslation } from "@/lib/i18n";
import { describeAssetFieldFailure } from "@/lib/ui-editor/runtime/assetResolution";
import { resolveAssetDisplayName } from "@/lib/workspace/assets/assetDisplayName";
import { useAssetLibraryRevision } from "@/lib/workspace/hooks/useAssetLibraryRevision";

/**
 * The line an editor field shows under itself when the asset it names did not come, or null while
 * nothing is wrong. See `describeAssetFieldFailure` for what the line says.
 *
 * `failed` is whether the lookup answered with an error. What that error says is deliberately not
 * used: it is written for the log, in English, and it carries the id it could not find - which, for
 * an asset that is no longer in the project, names nothing the author can look for.
 */
export function useAssetFieldNotice(requested: string | null | undefined, failed: boolean): string | null {
    const { t } = useTranslation();
    const workspace = useOptionalWorkspace();
    const services = workspace?.context?.services ?? null;
    // A rename or a delete changes what the line says without changing the id the field holds.
    const libraryRevision = useAssetLibraryRevision();

    return useMemo(() => {
        if (!requested || !failed) {
            return null;
        }
        return describeAssetFieldFailure(requested, resolveAssetDisplayName(services, requested), t);
        // `libraryRevision` is read for its change, not its value.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [requested, failed, services, libraryRevision, t]);
}
