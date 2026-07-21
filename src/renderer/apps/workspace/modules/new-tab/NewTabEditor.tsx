import { useWorkspaceBackgroundImage } from "@/apps/workspace/components/layout/useWorkspaceBackgroundImage";
import { useWorkspace } from "@/apps/workspace/context";
import { useAssetDropTarget } from "@/apps/workspace/dnd/useAssetDropTarget";
import {
    openAssetPreviewTabsInEditor,
    setWorkspaceSelectionToPrimaryAsset,
} from "@/apps/workspace/modules/assets/dnd/openDraggedAssetsInEditor";
import type { EditorLayout } from "@/apps/workspace/registry/types";
import { useTranslation } from "@/lib/i18n";
import { UIService } from "@/lib/workspace/services/core/UIService";
import { Services, type WorkspaceContext } from "@/lib/workspace/services/services";
import { backgroundLayerStyle } from "@/lib/workspace/services/ui/backgroundSettings";
import type { EditorTabComponentProps } from "@/lib/workspace/services/ui/types";

const LOGO_MASK = "url(/img/narraleaf-studio/logo-icon-white.png)";

/** The group hosting a tab; null when the tab is not in the layout (e.g. mid-close). */
function findGroupIdOfTab(layout: EditorLayout, tabId: string): string | null {
    if ("tabs" in layout) {
        return layout.tabs.some(tab => tab.id === tabId) ? layout.id : null;
    }
    return findGroupIdOfTab(layout.first, tabId) ?? findGroupIdOfTab(layout.second, tabId);
}

function ownGroupId(context: WorkspaceContext, tabId: string): string | undefined {
    const layout = context.services.get<UIService>(Services.UI).getStore().getEditorLayout();
    return findGroupIdOfTab(layout, tabId) ?? undefined;
}

/**
 * A browser-style blank tab: the strip's "+" opens one of these instead of committing to any
 * entity. It shows the same idle canvas as an empty editor group — logo watermark (or the custom
 * workspace background) and nothing else; dropping assets onto it opens their previews in the
 * same group.
 */
export function NewTabEditor({ tabId }: EditorTabComponentProps) {
    const { t } = useTranslation();
    const { context } = useWorkspace();

    const { dropTargetProps, overlayClassName } = useAssetDropTarget({
        onDrop: ({ wire, resolved }) => {
            if (!context || resolved.length === 0) {
                return;
            }
            const primary = resolved.find(a => a.id === wire.p) ?? resolved[0];
            setWorkspaceSelectionToPrimaryAsset(context, primary);
            openAssetPreviewTabsInEditor(context, resolved, { groupId: ownGroupId(context, tabId) });
        },
    });

    // Same custom-background treatment as the empty editor canvas: painted behind this page's own
    // opaque surface, never over real content.
    const { settings, url: backgroundUrl } = useWorkspaceBackgroundImage();

    return (
        <div
            {...dropTargetProps}
            className={`h-full flex items-center justify-center bg-surface relative overflow-hidden transition-colors ${overlayClassName}`}
        >
            {backgroundUrl && (
                <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
                    <div className="absolute" style={backgroundLayerStyle(settings, backgroundUrl)} />
                </div>
            )}
            {!backgroundUrl && (
                <div className="relative z-10 flex flex-col items-center text-center pointer-events-none">
                    <div
                        role="img"
                        aria-label={t("workspace.shell.logoAlt")}
                        className="w-64 h-64 mx-auto mb-8 bg-fg opacity-5"
                        style={{
                            maskImage: LOGO_MASK,
                            WebkitMaskImage: LOGO_MASK,
                            maskSize: "contain",
                            WebkitMaskSize: "contain",
                            maskRepeat: "no-repeat",
                            WebkitMaskRepeat: "no-repeat",
                            maskPosition: "center",
                            WebkitMaskPosition: "center",
                        }}
                    />
                    <h1 className="text-4xl font-light text-fg/5">NarraLeaf Studio</h1>
                </div>
            )}
        </div>
    );
}
