import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Trash2 } from "lucide-react";
import type { StoryCharacterTagSelection, StoryInlineEvent } from "@shared/types/story";
import type { Character } from "@/lib/workspace/services/character/Character";
import { AssetType } from "@/lib/workspace/services/assets/assetTypes";
import { useTranslation } from "@/lib/i18n";
import { CharacterAppearancePicker } from "./CharacterAppearancePicker";
import { AssetField } from "./AssetField";
import { useFloatingLayer, useHostDocument } from "@/lib/components/layout";
import { NumericDraftEnhancedInput } from "@/lib/components/inputs/NumericDraftEnhancedInput";
import { formatStorySecondsValue, storySecondsToMs } from "@shared/utils/storyTime";
import { ownInlineFadeMs } from "@shared/story/inlineExpressionFade";
import { keepStoryKeysInPopover } from "./PausePopover";

/**
 * Inline reveal-time event config popover, mirroring the Pause / Interpolation popovers. The
 * expression target reuses {@link CharacterAppearancePicker} (form + differential) — the same picker
 * the `/show` `/face` action uses — and an optional sound effect reuses the asset picker. The token
 * always belongs to the row's speaking character, so `character` is fixed by the caller.
 */
export function ExpressionPopover(props: {
    anchor: { top: number; left: number; bottom: number };
    value: StoryInlineEvent;
    character: Character | null;
    /**
     * The fade this change takes when it sets none: the one in effect after the changes before it in
     * the scene (see `inlineExpressionFade`). Shown in the field while the change inherits.
     */
    inheritedFadeMs: number;
    onChange: (event: StoryInlineEvent) => void;
    onRemove: () => void;
    onClose: () => void;
}) {
    const { t } = useTranslation();
    const doc = useHostDocument();
    const panelRef = useRef<HTMLDivElement | null>(null);
    // Takes the focus and keeps Tab inside, like every popover on a chip in the row being edited (see
    // `PausePopover`). The sound picker opens a dialog of its own above this, which closes first.
    useFloatingLayer({ open: true, onClose: props.onClose, panelRef, scope: "trap" });
    const characterId = props.character?.profile.getId();

    useEffect(() => {
        const onDown = (event: MouseEvent) => {
            const target = event.target as HTMLElement | null;
            // The sound picker renders its own portal overlay (`.nl-window-content-layer`); a click
            // inside it (or any Select menu) must not dismiss this popover.
            if (
                panelRef.current?.contains(target) ||
                target?.closest?.("[data-select-menu]") ||
                target?.closest?.(".nl-window-content-layer")
            ) {
                return;
            }
            props.onClose();
        };
        doc.addEventListener("mousedown", onDown, true);
        return () => doc.removeEventListener("mousedown", onDown, true);
    }, [doc, props]);

    const expression = props.value.expression;

    const setAppearance = (next: { pose: string | undefined; tags: StoryCharacterTagSelection | undefined }) => {
        if (!characterId) {
            return;
        }
        // The fade belongs to the token, not to the look it switches to - picking another look keeps
        // it, and keeps it inheriting when it was.
        const fadeMs = expression ? ownInlineFadeMs(props.value) : undefined;
        props.onChange({
            ...props.value,
            expression: { characterId, pose: next.pose, tags: next.tags, ...(fadeMs !== undefined ? { fadeMs } : {}) },
        });
    };
    // A value typed here is this change's own, 0 included: an explicit 0 turns the fade off for this
    // change and for the ones after it that inherit, where clearing the value hands it back to the
    // one before. Equal to the inherited value or not, it stays its own until it is cleared.
    const setFade = (ms: number | undefined) => {
        if (!expression) {
            return;
        }
        const { fadeMs, ...rest } = expression;
        void fadeMs;
        props.onChange({
            ...props.value,
            expression: ms === undefined ? rest : { ...rest, fadeMs: Math.max(0, Math.round(ms)) },
        });
    };
    const ownFadeMs = expression ? ownInlineFadeMs(props.value) : undefined;
    const inherits = ownFadeMs === undefined;
    const setSound = (assetId: string | undefined) => {
        const { sound, ...rest } = props.value;
        void sound;
        props.onChange(assetId ? { ...rest, sound: { assetId } } : rest);
    };

    const view = doc.defaultView ?? window;
    const top = Math.min(props.anchor.bottom + 6, view.innerHeight - 360);
    const left = Math.min(props.anchor.left, view.innerWidth - 432);

    return createPortal(
        <div
            ref={panelRef}
            // The appearance preview inside is as tall as the author asked for, while the panel is
            // placed from its anchor rather than sized to fit - so it is told what is left of the
            // window below it and scrolls instead of running off the bottom.
            className="fixed z-[70] w-[26rem] overflow-y-auto rounded-lg border border-edge bg-surface-raised p-2 shadow-2xl"
            style={{ top, left: Math.max(8, left), maxHeight: Math.max(240, view.innerHeight - top - 8) }}
            data-help-topic="storyInlineExpression"
            onMouseDown={event => event.stopPropagation()}
            onKeyDown={keepStoryKeysInPopover}
        >
            <div className="mb-1.5 text-2xs text-fg-muted">{t("story.inlineEvent.title")}</div>
            {props.character ? (
                <CharacterAppearancePicker
                    character={props.character}
                    pose={expression?.pose}
                    tags={expression?.tags}
                    onChange={setAppearance}
                />
            ) : (
                <div className="rounded-md border border-dashed border-edge bg-fill-subtle p-3 text-xs text-fg-subtle">
                    {t("story.inlineEvent.noCharacter")}
                </div>
            )}
            {expression ? (
                <div className="mt-2">
                    <div className="flex items-center gap-1.5">
                        <span className="text-xs text-fg-muted">{t("story.inlineEvent.fade")}</span>
                        <NumericDraftEnhancedInput
                            committedDisplay={formatStorySecondsValue(ownFadeMs ?? props.inheritedFadeMs)}
                            onFiniteNumber={seconds => setFade(storySecondsToMs(seconds))}
                            // Emptying the field is the keyboard's way back to inheriting.
                            onEmpty={() => setFade(undefined)}
                            type="text"
                            inputMode="decimal"
                            popoverWhenNarrow={false}
                            // An inherited value reads quieter than one this change sets, as an inherited
                            // differential chip does beside an owned one.
                            className="w-20"
                            inputClassName={inherits ? "text-fg-muted" : undefined}
                            aria-label={t("story.inlineEvent.fade")}
                        />
                        <span className="text-xs text-fg-muted">{t("story.inlineEvent.fadeSeconds")}</span>
                        {inherits ? (
                            <span className="text-2xs text-fg-subtle">{t("story.inlineEvent.fadeInherited")}</span>
                        ) : (
                            <button
                                type="button"
                                className="text-2xs text-fg-muted transition-colors hover:text-fg"
                                onClick={() => setFade(undefined)}
                            >
                                {t("story.inlineEvent.fadeInherit")}
                            </button>
                        )}
                    </div>
                    <div className="mt-1 text-2xs text-fg-subtle">{t("story.inlineEvent.fadeHint")}</div>
                </div>
            ) : null}
            <div className="mt-2">
                <AssetField
                    label={t("story.inlineEvent.sound")}
                    assetType={AssetType.Audio}
                    assetId={props.value.sound?.assetId}
                    onChange={setSound}
                />
            </div>
            <button
                type="button"
                className="mt-2 flex items-center gap-1 text-xs text-fg-muted transition-colors hover:text-danger"
                onClick={props.onRemove}
            >
                <Trash2 className="h-3 w-3" />
                {t("common.remove")}
            </button>
        </div>,
        doc.body,
    );
}
