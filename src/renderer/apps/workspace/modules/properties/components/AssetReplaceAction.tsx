import { useCallback, useState } from "react";
import { RefreshCw } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import type { Asset } from "@/lib/workspace/services/assets/types";
import { AssetSource } from "@/lib/workspace/services/assets/types";
import { runReplaceAssetContentFlow } from "@/lib/workspace/assets/replaceAssetContentFlow";
import { useFreezeGuard } from "@/apps/workspace/components/ui/freezeGuard";
import { assetLibraryFreezeScope } from "../../assets/assetLiveSession";
import { useWorkspace } from "../../../context";

/**
 * "Point this record at a different file" — the inspector's half of the replace entry (the other is
 * the asset row's context menu).
 *
 * It sits next to the file's own readings (hash, size, dimensions) because that is what it changes:
 * the id, the name, the tags and every reference survive, so nothing below this button moves.
 *
 * ⚠ **Guarded, which it was not before this.** Left unguarded it was a button that opened a file
 * picker under a freeze and threw the answer away. It names the same scope the fields around it do -
 * a session carries the whole library, files included - so it greys with them and works with them.
 */
export function AssetReplaceAction({ asset }: { asset: Asset }) {
    const { t } = useTranslation();
    const { context } = useWorkspace();
    const freeze = useFreezeGuard(assetLibraryFreezeScope());
    const [busy, setBusy] = useState(false);

    const handleReplace = useCallback(async () => {
        if (!context || busy) {
            return;
        }
        setBusy(true);
        try {
            await runReplaceAssetContentFlow(context, asset, t);
        } finally {
            setBusy(false);
        }
    }, [asset, busy, context, t]);

    if (asset.source !== AssetSource.Local) {
        return null;
    }

    return (
        <button
            type="button"
            onClick={freeze.run(handleReplace)}
            {...freeze.writes(busy || !context)}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md border border-edge bg-surface-raised text-xs text-fg-muted hover:bg-fill transition-colors disabled:opacity-50 cursor-default"
        >
            <RefreshCw className={`w-3 h-3 ${busy ? "animate-spin" : ""}`} />
            <span>{t("assets.menu.replaceContent")}</span>
        </button>
    );
}
