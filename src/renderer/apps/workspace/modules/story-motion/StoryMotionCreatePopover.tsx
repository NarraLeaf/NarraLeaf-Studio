import { useEffect, useRef } from "react";
import { Plus } from "lucide-react";
import type { StoryMotionTargetKind } from "@shared/types/story";
import { AnchoredPanel, type PanelAnchor } from "@/lib/components/elements/HintPopover";
import { Button } from "@/lib/components/elements/Button";
import { useFloatingLayer, useHostDocument } from "@/lib/components/layout";
import { useTranslation } from "@/lib/i18n";
import { cn } from "@/lib/utils/cn";
import { StoryMotionPresetGallery } from "./StoryMotionPresetGallery";
import type { StoryMotionPreviewTarget } from "./storyMotionPreviewTarget";

/** The kinds a motion is made for, in the order the library offers them. */
export const STORY_MOTION_TARGET_KINDS: readonly StoryMotionTargetKind[] = ["character", "image", "text", "layer", "camera"];

const POPOVER_WIDTH_PX = 360;

/**
 * Where a new motion starts: what it is for, then empty or from a preset.
 *
 * The kind comes first because it decides where the motion can be used - a row picks only from
 * motions made for its own kind of object - and because it decides which presets apply. Every preset
 * card previews the move, so the author sees what they are choosing rather than its name.
 */
export function StoryMotionCreatePopover(props: {
    anchor: () => PanelAnchor | null;
    /** The control that opened it, which a press on does not count as a press outside. */
    ownerRef?: React.RefObject<HTMLElement | null>;
    kind: StoryMotionTargetKind;
    onKindChange: (kind: StoryMotionTargetKind) => void;
    target: StoryMotionPreviewTarget;
    stageSize: { width: number; height: number };
    backgroundUrl?: string | null;
    disabled?: boolean;
    onCreate: (presetId?: string) => void;
    onClose: () => void;
}) {
    const { t } = useTranslation();
    const doc = useHostDocument();
    const panelRef = useRef<HTMLDivElement | null>(null);
    const ownerRefs = props.ownerRef ? [props.ownerRef] : [];
    useFloatingLayer({
        open: true,
        onClose: props.onClose,
        panelRef,
        ownerRefs,
        itemSelector: "[data-motion-option]",
    });
    // A press anywhere but the panel and its button puts it away.
    const onClose = props.onClose;
    const ownerRef = props.ownerRef;
    useEffect(() => {
        const onPointerDown = (event: MouseEvent) => {
            const target = event.target as Node | null;
            if (panelRef.current?.contains(target) || ownerRef?.current?.contains(target)) {
                return;
            }
            onClose();
        };
        doc.addEventListener("mousedown", onPointerDown, true);
        return () => doc.removeEventListener("mousedown", onPointerDown, true);
    }, [doc, onClose, ownerRef]);

    return (
        <AnchoredPanel
            anchor={props.anchor}
            width={POPOVER_WIDTH_PX}
            panelRef={panelRef}
            role="dialog"
            className="z-[110] flex max-h-[min(480px,80vh)] flex-col overflow-hidden rounded-lg border border-edge-strong bg-surface-overlay shadow-xl"
        >
            <div className="flex shrink-0 flex-col gap-2 border-b border-edge p-2">
                <div
                    role="radiogroup"
                    aria-label={t("motion.library.targetKind")}
                    className="flex overflow-hidden rounded-md border border-edge"
                >
                    {STORY_MOTION_TARGET_KINDS.map((kind, index) => (
                        <button
                            key={kind}
                            type="button"
                            role="radio"
                            aria-checked={props.kind === kind}
                            className={cn(
                                "min-h-7 flex-1 cursor-default px-2 text-xs transition-colors duration-150",
                                index > 0 && "border-l border-edge",
                                props.kind === kind ? "bg-primary/15 text-fg" : "text-fg-muted hover:bg-fill hover:text-fg",
                            )}
                            onClick={() => props.onKindChange(kind)}
                        >
                            {t(`motion.targetKind.${kind}`)}
                        </button>
                    ))}
                </div>
                <Button
                    variant="ghost"
                    size="sm"
                    className="justify-start gap-1.5"
                    data-motion-option=""
                    disabled={props.disabled}
                    onClick={() => props.onCreate()}
                >
                    <Plus className="h-3.5 w-3.5" />
                    {t("motion.library.blankMotion")}
                </Button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2">
                <StoryMotionPresetGallery
                    targetKind={props.kind}
                    target={props.target}
                    stageSize={props.stageSize}
                    backgroundUrl={props.backgroundUrl}
                    disabled={props.disabled}
                    onPick={presetId => props.onCreate(presetId)}
                />
            </div>
        </AnchoredPanel>
    );
}
