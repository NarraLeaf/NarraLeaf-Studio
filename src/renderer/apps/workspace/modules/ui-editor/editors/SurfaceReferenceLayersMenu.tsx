import { Layers } from "lucide-react";
import type { UIStageSlotId } from "@shared/types/ui-editor/document";
import { useTranslation } from "@/lib/i18n";
import { Checkbox } from "@/lib/components/elements";
import { getStageSlotLabel } from "@/lib/ui-editor/stageSlotLabel";
import type { GameUiReferenceCandidate } from "@/lib/ui-editor/preview/gameUiReferenceLayers";
import type { UIEditorStateService } from "@/lib/workspace/services/ui-editor/UIEditorStateService";
import { SurfaceEditorToolbarButtonGroup, SurfaceEditorToolbarSegButton } from "./SurfaceEditorToolbarButtonGroup";
import { SurfaceToolbarPopoverPanel, useSurfaceToolbarPopover } from "./SurfaceEditorToolbarPopover";

type Props = {
    stateService: UIEditorStateService;
    /** The other Game UI this project has, one per slot (`listGameUiReferenceCandidates`). */
    candidates: readonly GameUiReferenceCandidate[];
    enabledSlotIds: readonly UIStageSlotId[];
};

/**
 * Toolbar dropdown that picks which other Game UI a Game UI canvas draws as a faint reference.
 *
 * Each surface is its own switch, all off until the author turns one on, and the choice is view
 * state on {@link UIEditorStateService} kept by slot: it never reaches the document, the dirty flag or
 * the undo history. Rows name the surface the game would draw in that slot, with the slot beside it,
 * so two projects that call their quick menu different things still read the same.
 */
export function SurfaceReferenceLayersTrigger({ stateService, candidates, enabledSlotIds }: Props) {
    const { t } = useTranslation();
    const popover = useSurfaceToolbarPopover(candidates.map(candidate => `${candidate.slotId}:${candidate.name}`).join("|"));
    const anyShown = candidates.some(candidate => enabledSlotIds.includes(candidate.slotId));

    return (
        <>
            <SurfaceEditorToolbarButtonGroup aria-label={t("uiEditor.reference.label")}>
                <SurfaceEditorToolbarSegButton
                    ref={popover.triggerRef}
                    type="button"
                    active={popover.open || anyShown}
                    onClick={popover.toggle}
                    data-tip={t("uiEditor.reference.label")}
                    aria-expanded={popover.open}
                    aria-haspopup="dialog"
                >
                    <Layers className="h-4 w-4" />
                </SurfaceEditorToolbarSegButton>
            </SurfaceEditorToolbarButtonGroup>
            <SurfaceToolbarPopoverPanel popover={popover} dataAttribute="game-ui-reference">
                <div className="border-b border-edge px-3 pb-2 text-2xs font-medium text-fg-subtle">
                    {t("uiEditor.reference.heading")}
                </div>
                <div className="pt-1">
                    {candidates.length === 0 ? (
                        <div className="px-3 py-1.5 text-xs text-fg-subtle">{t("uiEditor.reference.none")}</div>
                    ) : (
                        candidates.map(candidate => {
                            const slotLabel = getStageSlotLabel(candidate.slotId, t);
                            const name = candidate.name || slotLabel;
                            return (
                                <Checkbox
                                    key={candidate.slotId}
                                    className="px-3 py-1.5 text-fg hover:bg-fill-subtle"
                                    checked={enabledSlotIds.includes(candidate.slotId)}
                                    onCheckedChange={checked =>
                                        stateService.setPreviewReferenceSlotEnabled(candidate.slotId, checked)
                                    }
                                    data-reference-slot={candidate.slotId}
                                >
                                    <span className="min-w-0 truncate">{name}</span>
                                    {/* The slot, unless the surface is already called by it. */}
                                    {name === slotLabel ? null : (
                                        <span className="ml-auto shrink-0 pl-4 text-2xs text-fg-subtle">{slotLabel}</span>
                                    )}
                                </Checkbox>
                            );
                        })
                    )}
                </div>
            </SurfaceToolbarPopoverPanel>
        </>
    );
}
