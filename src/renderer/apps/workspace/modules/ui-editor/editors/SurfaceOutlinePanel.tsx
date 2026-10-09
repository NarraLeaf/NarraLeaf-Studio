import { memo, useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { UILayersPanel } from "@/lib/ui-editor/interaction";
import type { UILayersPanelHandle } from "@/lib/ui-editor/interaction/outline/LayerOutlinePanel";
import type { InputDialog } from "@/lib/components/dialogs";
import type { UIEditorStateService } from "@services/ui-editor/UIEditorStateService";
import type { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";
import { LocalBlueprintService } from "@/lib/workspace/services/ui-editor/LocalBlueprintService";
import type { UIService } from "@/lib/workspace/services/core/UIService";
import type { UIEditorReadOnly } from "@/lib/ui-editor/interaction/readOnlyInteraction";
import { OutlineElementBadgeProvider } from "@/lib/ui-editor/interaction/outline/outlineBadges";
import { UIElementClaimMark, UIElementClaimsProvider, useUIElementClaim } from "../uiLiveSession";
import {
    EditorSidebarResizeHandle,
    editorSidebarCssWidth,
    useEditorSidebarWidth,
} from "@/apps/workspace/components/ui/EditorSidebar";

export type SurfaceOutlinePanelProps = {
    surfaceId: string;
    stateService: UIEditorStateService | null;
    documentService: UIDocumentService | null;
    uiService: UIService | null;
    localBlueprint: LocalBlueprintService | null;
    inputDialog: InputDialog | null;
    allowAddSelectionToComponentLibrary?: boolean;
    /** Passed through to the layer tree; collapsing the panel is editor state and stays live. */
    readOnly?: UIEditorReadOnly;
};

/**
 * Memoised because the editor tab re-renders on every document revision, and this subtree is the
 * most expensive thing under it - one dnd-kit draggable per layer. Every prop here is either a
 * string, a boolean, a service instance or a memoised object, so the comparison holds for edits and
 * releases only when the outline is genuinely being handed something different. What the outline
 * itself has to redraw is decided inside `UILayersPanel`, which watches its own slice of the
 * document.
 */
/**
 * The mark an outline row wears while somebody else in a live session has that element open.
 *
 * Supplied to the outline rather than drawn by them: the layer tree is part of `lib/ui-editor`,
 * which the game runtime compiles, and a live session is Studio's. See `outlineBadges`.
 *
 * ⚠ Surface elements only. A component definition's elements live in their own map and are edited in
 * a component editor, which draws its own outline against the same tree - the componentId there is
 * not this panel's to know, so a row for one would be asking about the wrong address.
 */
function SurfaceOutlineClaimBadge({ elementId }: { elementId: string }) {
    const account = useUIElementClaim(null, elementId);
    return account === null ? null : <UIElementClaimMark account={account} />;
}

export const SurfaceOutlinePanel = memo(function SurfaceOutlinePanel({
    surfaceId,
    stateService,
    documentService,
    uiService,
    localBlueprint,
    inputDialog,
    allowAddSelectionToComponentLibrary = true,
    readOnly,
}: SurfaceOutlinePanelProps) {
    const { t } = useTranslation();
    const [isCollapsed, setCollapsedState] = useState(() => stateService?.getOutlinePanelCollapsed() ?? false);
    const width = useEditorSidebarWidth("uiOutline");
    const layersRef = useRef<UILayersPanelHandle>(null);

    // The outline sits over the canvas, inside the element the canvas menu listens on. Every right
    // click in it is the outline's - the rows and the space under them answer for themselves, and the
    // title row opens the outline's own menu - so none of them may reach the canvas and open a second
    // menu there.
    const handlePanelContextMenu = useCallback((event: MouseEvent<HTMLElement>) => {
        event.preventDefault();
        event.stopPropagation();
        layersRef.current?.openPanelMenu(event);
    }, []);

    useEffect(() => {
        if (!stateService) {
            return undefined;
        }
        setCollapsedState(stateService.getOutlinePanelCollapsed());
        return stateService.on("outlinePanelCollapsedChanged", setCollapsedState);
    }, [stateService]);

    const setCollapsed = useCallback(
        (collapsed: boolean) => {
            setCollapsedState(collapsed);
            stateService?.setOutlinePanelCollapsed(collapsed);
        },
        [stateService],
    );

    const toggleCollapsed = useCallback(() => {
        setCollapsed(!isCollapsed);
    }, [isCollapsed, setCollapsed]);

    if (!surfaceId) {
        return null;
    }

    // A column, so the header keeps its height and the tree gets whatever is left - without this the
    // tree's own `h-full` measured the whole panel and pushed its tail out of view with no way back.
    // No right border: the resize seam on that edge is the line (see `EditorSidebarResizeHandle`).
    // Under a wallpaper it is a dock like the sidebars (`nl-sidebar-surface`), its title row a header
    // strip (`nl-frame-surface`), so the background dialog's plates reach it as they reach those.
    const panelClasses = `nl-sidebar-surface absolute inset-y-0 left-0 z-10 flex flex-col bg-surface-sunken transition-transform duration-200 ease-out ${
        isCollapsed ? "-translate-x-full opacity-0 pointer-events-none" : "translate-x-0 opacity-100 pointer-events-auto"
    }`;

    const canShowLayers = Boolean(stateService) && Boolean(documentService) && Boolean(localBlueprint);

    return (
        <>
            <div
                className={panelClasses}
                style={{ width: editorSidebarCssWidth("uiOutline", width) }}
                onContextMenu={handlePanelContextMenu}
            >
                <div className="nl-frame-surface shrink-0 bg-surface-sunken px-3 py-2 border-b border-edge text-xs text-fg-subtle flex items-center justify-between">
                    <span>{t("uiEditor.editor.outlineTitle")}</span>
                    <button
                        type="button"
                        className="text-fg-muted hover:text-fg transition-colors"
                        onClick={toggleCollapsed}
                        data-tip={isCollapsed ? t("uiEditor.editor.expandOutline") : t("uiEditor.editor.collapseOutline")} aria-label={isCollapsed ? t("uiEditor.editor.expandOutline") : t("uiEditor.editor.collapseOutline")}
                    >
                        {isCollapsed ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
                    </button>
                </div>
                {!isCollapsed && (
                    // `min-h-0` is what lets a flex child shrink below its content; without it the
                    // overflow never engages. `overscroll-contain` keeps a wheel that runs off the end
                    // of the tree from reaching the canvas behind it and zooming instead.
                    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
                        {canShowLayers ? (
                            <UIElementClaimsProvider>
                            <OutlineElementBadgeProvider value={SurfaceOutlineClaimBadge}>
                            <UILayersPanel
                                ref={layersRef}
                                surfaceId={surfaceId}
                                stateService={stateService!}
                                documentService={documentService!}
                                uiService={uiService}
                                localBlueprint={localBlueprint!}
                                inputDialog={inputDialog}
                                allowAddSelectionToComponentLibrary={allowAddSelectionToComponentLibrary}
                                readOnly={readOnly}
                            />
                            </OutlineElementBadgeProvider>
                            </UIElementClaimsProvider>
                        ) : (
                            <div className="p-4 text-xs text-fg-subtle">{t("uiEditor.editor.loadingServices")}</div>
                        )}
                    </div>
                )}
                <EditorSidebarResizeHandle id="uiOutline" edge="right" />
            </div>
            {isCollapsed && (
                <button
                    type="button"
                    className="absolute left-3 top-3 z-20 h-10 w-10 flex items-center justify-center rounded-full border border-edge-strong bg-surface-canvas/80 text-fg-muted hover:text-fg focus:outline-none"
                    onClick={() => setCollapsed(false)}
                    data-tip={t("uiEditor.editor.expandOutline")} aria-label={t("uiEditor.editor.expandOutline")}
                >
                    <ChevronDown className="w-4 h-4" />
                </button>
            )}
        </>
    );
});
