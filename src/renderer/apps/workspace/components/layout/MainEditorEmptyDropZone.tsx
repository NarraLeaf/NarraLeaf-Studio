import { useAssetDropTarget } from "@/apps/workspace/dnd/useAssetDropTarget";
import { useWorkspace } from "@/apps/workspace/context";
import {
    openAssetPreviewTabsInEditor,
    setWorkspaceSelectionToPrimaryAsset,
} from "@/apps/workspace/modules/assets/dnd/openDraggedAssetsInEditor";
import { useTranslation } from "@/lib/i18n";
import { useWorkspaceBackgroundImage } from "./useWorkspaceBackgroundImage";

const LOGO_MASK = "url(/img/narraleaf-studio/logo-icon-white.png)";

interface MainEditorEmptyDropZoneProps {
    groupId: string;
}

/**
 * Empty editor canvas drop target: open asset previews in the default editor group.
 */
export function MainEditorEmptyDropZone({ groupId }: MainEditorEmptyDropZoneProps) {
    const { t } = useTranslation();
    const { context } = useWorkspace();

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

    return (
        <div
            {...dropTargetProps}
            className={`h-full flex items-center justify-center bg-surface relative overflow-hidden rounded-sm transition-colors ${overlayClassName}`}
        >
            {!backgroundUrl && (
                <div className="text-center text-fg-subtle relative z-10 pointer-events-none">
                    <div className="relative mb-8">
                        {/*
                          * The logo art is a fixed white silhouette, which is invisible against the
                          * light theme's surface. Drawing it as a mask over `bg-fg` instead lets the
                          * watermark take the theme's foreground colour — the same way the wordmark
                          * below follows `text-fg`.
                          */}
                        <div
                            role="img"
                            aria-label={t("workspace.shell.logoAlt")}
                            className="w-64 h-64 mx-auto bg-fg opacity-5"
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
                    </div>

                    <div className="space-y-4">
                        <h1 className="text-4xl font-light text-fg/5">NarraLeaf Studio</h1>
                    </div>
                </div>
            )}
        </div>
    );
}
