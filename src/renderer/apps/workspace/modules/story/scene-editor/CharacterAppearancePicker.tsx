import { ImageOff, ZoomIn, ZoomOut } from "lucide-react";
import type { StoryCharacterTagSelection } from "@shared/types/story";
import type { Character } from "@/lib/workspace/services/character/Character";
import { getInterface } from "@/lib/app/bridge";
import { IconButton } from "@/lib/components/elements";
import {
    APPEARANCE_PREVIEW_HEIGHT_KEY,
    APPEARANCE_PREVIEW_HEIGHTS,
    resolveAppearancePreviewHeight,
    stepAppearancePreviewHeight,
} from "@/lib/settings/appearancePreviewOptions";
import { useGlobalSetting } from "@/lib/settings/useGlobalSetting";
import { useAssetObjectUrl } from "@/lib/workspace/hooks/useAssetObjectUrl";
import { useCompositedSprite } from "@/lib/workspace/hooks/useCompositedSprite";
import { useTranslation } from "@/lib/i18n";

const CARD = "flex items-center gap-2 rounded-md border p-1.5 text-left text-xs transition-colors";
const SELECTED = "border-primary/60 bg-primary/15";
const UNSELECTED = "border-edge hover:bg-fill-subtle";

function Thumb(props: { assetId: string | null; className?: string; alt?: string }) {
    const { url } = useAssetObjectUrl(props.assetId);
    if (!url) {
        return (
            <div className={["grid place-items-center rounded-md bg-fill-subtle text-fg-subtle", props.className ?? ""].join(" ")}>
                <ImageOff className="h-4 w-4" />
            </div>
        );
    }
    return <img src={url} alt={props.alt ?? ""} className={["object-contain", props.className ?? ""].join(" ")} draggable={false} />;
}

function Empty(props: { text: string }) {
    return <div className="rounded-md border border-dashed border-edge bg-fill-subtle p-3 text-xs text-fg-subtle">{props.text}</div>;
}

/**
 * Pick what a character shows on a row.
 *
 * The two appearance kinds ask different questions, so this is two controls. A preset character
 * offers its finished sprites and the row stores one pose id. A layered character offers one row of
 * tags per axis, and stores only the axes the author actually touched — a deliberately partial
 * selection, because that is how the engine switches tags: setting the mood leaves the outfit as an
 * earlier row put it. Clicking the chosen tag again drops that axis from the row, which is how an
 * author takes an axis back out after changing their mind.
 */
export function CharacterAppearancePicker(props: {
    character: Character;
    pose: string | undefined;
    tags: StoryCharacterTagSelection | undefined;
    onChange: (next: { pose: string | undefined; tags: StoryCharacterTagSelection | undefined }) => void;
}) {
    const { t } = useTranslation();
    const appearance = props.character.profile.appearance;

    if (appearance.getKind() === "preset") {
        const poses = appearance.getPoses();
        if (poses.length === 0) {
            return <Empty text={t("story.appearance.noPoses")} />;
        }
        const selected = props.pose ?? appearance.getDefaultPoseId() ?? undefined;
        return (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-2 rounded-lg border border-edge bg-fill-subtle p-2">
                {poses.map(pose => (
                    <button
                        key={pose.id}
                        type="button"
                        onClick={() => props.onChange({ pose: pose.id, tags: undefined })}
                        className={[CARD, pose.id === selected ? SELECTED : UNSELECTED].join(" ")}
                    >
                        <Thumb assetId={pose.assetId} className="h-10 w-10 shrink-0" alt={pose.name} />
                        <span className="min-w-0 flex-1 truncate text-fg">{pose.name}</span>
                    </button>
                ))}
            </div>
        );
    }

    const axes = appearance.getAxes().filter(axis => axis.tags.length > 0);
    if (axes.length === 0) {
        return <Empty text={t("story.appearance.noAxes")} />;
    }

    const toggle = (axisId: string, tagId: string) => {
        const next = { ...props.tags };
        if (next[axisId] === tagId) {
            delete next[axisId];
        } else {
            next[axisId] = tagId;
        }
        props.onChange({ pose: undefined, tags: Object.keys(next).length > 0 ? next : undefined });
    };

    return (
        <div className="flex flex-col gap-2 rounded-lg border border-edge bg-fill-subtle p-2">
            {/* What the row will actually put on stage. A stack has no single file to thumbnail, and
                a column of tag names does not tell an author whether the combination reads. */}
            <StackPreview character={props.character} tags={props.tags} />
            <div className="flex min-w-0 flex-1 flex-col gap-2">
            {axes.map(axis => {
                const chosen = props.tags?.[axis.id];
                return (
                    <div key={axis.id} className="flex flex-col gap-1">
                        <div className="flex items-baseline gap-2 px-1">
                            <span className="text-2xs font-medium tracking-wide text-fg-subtle">{axis.name}</span>
                            {/* An axis this row leaves alone keeps whatever an earlier row set, which is
                                not the same as falling back to the default — say which it is. */}
                            {!chosen && <span className="text-2xs text-fg-subtle">{t("story.appearance.unchanged")}</span>}
                        </div>
                        <div className="flex flex-wrap gap-1">
                            {axis.tags.map(tag => (
                                <button
                                    key={tag.id}
                                    type="button"
                                    onClick={() => toggle(axis.id, tag.id)}
                                    className={[
                                        "rounded-md border px-2 py-1 text-xs transition-colors",
                                        tag.id === chosen ? SELECTED : UNSELECTED,
                                    ].join(" ")}
                                >
                                    {tag.name}
                                </button>
                            ))}
                        </div>
                    </div>
                );
            })}
            </div>
        </div>
    );
}

/**
 * The whole stack under the row's selection, composited.
 *
 * Sized to be looked at, and given the row to itself. It was first a 56px thumbnail, then a share of
 * the picker's width standing beside the tag rows - and a share of a rail that is 400px wide is still
 * only 160px of picture, most of which a portrait spends on empty margins. The question this preview
 * exists to answer is whether a combination of tags reads as a character, and that is a question
 * about a face, so the picture needs the width of the panel and a height the author chooses.
 *
 * The height is the author's, remembered globally (`editor.appearancePreviewHeight`): a rail this
 * narrow is a budget, and how much of it a sprite is worth depends on the character being staged and
 * on the screen. The two buttons walk a ladder of sizes rather than dragging an edge, because each
 * size is a separately cached composite and a drag would decode one for every pixel it crossed.
 */
function StackPreview(props: { character: Character; tags: StoryCharacterTagSelection | undefined }) {
    const { t } = useTranslation();
    const height = useGlobalSetting(APPEARANCE_PREVIEW_HEIGHT_KEY, resolveAppearancePreviewHeight);
    // Twice the drawn height, so the composite still has pixels to spare on a HiDPI screen. It is a
    // rung of the ladder either way, so zooming in and back out re-uses the two cached bitmaps
    // instead of decoding a third.
    const { url } = useCompositedSprite(props.character, { tags: props.tags }, height * 2);

    const setHeight = (direction: 1 | -1) => {
        void getInterface().app.state.setGlobalState(
            APPEARANCE_PREVIEW_HEIGHT_KEY,
            stepAppearancePreviewHeight(height, direction),
        );
    };

    // Nothing composited - the tags name no art, or none of it has been drawn yet. Says so in the
    // smallest box that can say it: the author's chosen height is for a picture, and an empty
    // rectangle 288px tall would push the tags it belongs to off the panel to show nothing at all.
    // The zoom buttons go with it, since there is nothing here to zoom.
    if (!url) {
        return (
            <div className="grid h-20 w-full shrink-0 place-items-center rounded-md bg-fill text-fg-subtle">
                <ImageOff className="h-4 w-4" />
            </div>
        );
    }

    return (
        <div className="relative w-full shrink-0 overflow-hidden rounded-md bg-fill" style={{ height }}>
            <img src={url} alt="" draggable={false} className="h-full w-full object-contain" />
            {/* Over the picture rather than under it: a portrait leaves its corners empty, and a
                control strip of its own would spend a row of the rail on two buttons. */}
            <div className="absolute right-1 top-1 flex gap-0.5 rounded-md bg-surface-overlay/80 p-0.5">
                <IconButton
                    size="sm"
                    variant="ghost"
                    aria-label={t("story.appearance.previewSmaller")}
                    data-tip={t("story.appearance.previewSmaller")}
                    disabled={height <= APPEARANCE_PREVIEW_HEIGHTS[0]}
                    onClick={() => setHeight(-1)}
                >
                    <ZoomOut className="h-3.5 w-3.5" />
                </IconButton>
                <IconButton
                    size="sm"
                    variant="ghost"
                    aria-label={t("story.appearance.previewLarger")}
                    data-tip={t("story.appearance.previewLarger")}
                    disabled={height >= APPEARANCE_PREVIEW_HEIGHTS[APPEARANCE_PREVIEW_HEIGHTS.length - 1]}
                    onClick={() => setHeight(1)}
                >
                    <ZoomIn className="h-3.5 w-3.5" />
                </IconButton>
            </div>
        </div>
    );
}
