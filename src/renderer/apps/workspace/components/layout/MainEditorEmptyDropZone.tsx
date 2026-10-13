import { Search } from "lucide-react";
import { useAssetDropTarget } from "@/apps/workspace/dnd/useAssetDropTarget";
import { useWorkspace } from "@/apps/workspace/context";
import {
    openAssetPreviewTabsInEditor,
    setWorkspaceSelectionToPrimaryAsset,
} from "@/apps/workspace/modules/assets/dnd/openDraggedAssetsInEditor";
import { useTranslation } from "@/lib/i18n";
import { Services } from "@/lib/workspace/services/services";
import { UIService } from "@/lib/workspace/services/core/UIService";
import { useShortcutLabels } from "../../hooks/useShortcutLabels";
import { QUICK_OPEN_BINDING_ID } from "./QuickOpenPicker";
import { useWorkspaceBackgroundImage } from "./useWorkspaceBackgroundImage";
import { ProductLogoWatermark } from "./ProductLogoWatermark";

interface MainEditorEmptyDropZoneProps {
    groupId: string;
}

/**
 * Empty editor canvas drop target: open asset previews in the default editor group.
 */
export function MainEditorEmptyDropZone({ groupId }: MainEditorEmptyDropZoneProps) {
    const { t } = useTranslation();
    const { context, recovery } = useWorkspace();
    const shortcuts = useShortcutLabels();

    const { dropTargetProps, overlayClassName } = useAssetDropTarget({
        onDrop: ({ wire, resolved }) => {
            if (!context || resolved.length === 0) {
                return;
            }
            const primary = resolved.find(a => a.id === wire.p) ?? resolved[0];
            setWorkspaceSelectionToPrimaryAsset(context, primary);
            openAssetPreviewTabsInEditor(context, resolved, { groupId });
        },
    });

    // A custom workspace background shows through the whole window (as a translucent underlay behind
    // the chrome — see WorkspaceLayout), so the faint logo watermark would fight it for the same
    // space. Hide the watermark whenever a background is set; the wallpaper is the backdrop instead.
    const { url: backgroundUrl } = useWorkspaceBackgroundImage();

    // Same as the strip's "+": Quick Open, where anything with a tab is picked by name. A recovery
    // window has no Quick Open, and draws no button for it.
    const openQuickOpen = () => {
        context?.services.get<UIService>(Services.UI).keybindings.trigger(QUICK_OPEN_BINDING_ID);
    };
    const quickOpenLabel = t("workspace.shell.quickOpen.title");

    return (
        <div
            {...dropTargetProps}
            className={`h-full flex items-center justify-center bg-surface relative overflow-hidden rounded-sm transition-colors ${overlayClassName}`}
        >
            <div className="relative z-10 flex flex-col items-center text-center text-fg-subtle pointer-events-none">
                {!backgroundUrl && (
                    <div>
                        <div className="relative mb-8">
                            <ProductLogoWatermark />
                        </div>

                        <div className="space-y-4 mb-8">
                            <h1 className="text-4xl font-light text-fg/5">NarraLeaf Studio</h1>
                        </div>
                    </div>
                )}

                {recovery ? null : (
                    <button
                        type="button"
                        onClick={openQuickOpen}
                        className="pointer-events-auto flex items-center gap-2 px-4 h-9 rounded-md border border-edge bg-surface/60 text-sm text-fg-muted hover:text-fg hover:bg-surface transition-colors"
                        data-tip={quickOpenLabel}
                        data-tip-shortcut={shortcuts.forBinding(QUICK_OPEN_BINDING_ID)}
                    >
                        <Search className="w-4 h-4" />
                        <span>{quickOpenLabel}</span>
                    </button>
                )}
            </div>
        </div>
    );
}
