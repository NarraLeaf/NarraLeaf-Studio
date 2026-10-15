import { useMemo, useRef, useState } from "react";
import { Image as ImageIcon, Trash2 } from "lucide-react";
import type { StoryScene, StorySceneUpdate } from "@shared/types/story";
import type { Translator } from "@shared/i18n";
import { useTranslation } from "@/lib/i18n";
import { useWorkspace } from "@/apps/workspace/context";
import { Services } from "@/lib/workspace/services/services";
import type { AssetsService } from "@/lib/workspace/services/core/AssetsService";
import { useAssetObjectUrl } from "@/lib/workspace/hooks/useAssetObjectUrl";
import { AssetSelector } from "@/apps/workspace/modules/assets/components/AssetSelector";
import { useAssetSetPickerSource } from "@/apps/workspace/modules/assets/state/useAssetSetPickerSource";
import { AssetType } from "@/lib/workspace/services/assets/assetTypes";
import type { Asset } from "@/lib/workspace/services/assets/types";
import { createPropertyEditorSchema, defineField } from "../framework";
import { MusicField } from "../fields/MusicField";
import type {
    CustomFieldDefinition,
    CustomFieldProps,
    SectionFieldDefinition,
    TextFieldDefinition,
    TextareaFieldDefinition,
} from "../framework/types";

/** Translator function, threaded into schema builders since they run outside React. */
type TranslateFn = Translator["t"];

/**
 * What the right rail edits when a story scene tab is in front and no row is focused.
 *
 * `onUpdateScene` is the scene editor controller's `updateSceneMetadata` — the same function the
 * inline scene header card commits through. Deliberately not a `StoryService` handle: the controller
 * is what records the undo snapshot, so writing round it would make an edit from here unreachable by
 * Ctrl+Z (and an edit from the header card a different number of steps than one from here).
 */
export type StorySceneEditorContext = {
    scene: StoryScene;
    onUpdateScene: (patch: StorySceneUpdate) => boolean;
};

/**
 * The scene's default backdrop, as a picker.
 *
 * A `thumbnail` field would be the framework's nearest stock control, but it crops the picked image
 * and writes a NEW asset — this field references an existing one by id, so it has to be its own
 * control. The shape follows the inline scene header card, which picks the same value the same way.
 */
function SceneDefaultBackgroundField({ data }: CustomFieldProps<StorySceneEditorContext>) {
    const { t } = useTranslation();
    const { context, isInitialized } = useWorkspace();
    const [selectorOpen, setSelectorOpen] = useState(false);
    const selectButtonRef = useRef<HTMLButtonElement | null>(null);
    const assetId = data.scene.defaultBackgroundAssetId ?? null;
    const { url } = useAssetObjectUrl(assetId);
    const assetsService = useMemo(
        () => (context && isInitialized ? context.services.get<AssetsService>(Services.Assets) : null),
        [context, isInitialized],
    );
    // The picked image by name, never by id — the rail's own rule (a bare uuid names nothing).
    const asset = assetId ? assetsService?.getAssets()[AssetType.Image]?.[assetId] ?? null : null;
    // A scene's background is the field a set is most often wanted for, and assembly resolves the
    // scene's own two asset fields, so the picker offers them here.
    const { virtualGroups, resolveAssetPreviewUrl, findSet } = useAssetSetPickerSource({
        context,
        isInitialized,
        assetType: AssetType.Image,
        enabled: true,
    });
    const set = assetId && !asset ? findSet(assetId) : null;
    const label = asset?.name
        ?? set?.set.name
        ?? (assetId ? t("story.background.missingImage") : t("story.background.none"));

    const handleSelect = (assets: Asset[]) => {
        const selected = assets[0];
        setSelectorOpen(false);
        if (selected) {
            data.onUpdateScene({ defaultBackgroundAssetId: selected.id });
        }
    };

    return (
        <div>
            <button
                type="button"
                className="relative block aspect-[16/9] w-full overflow-hidden rounded-md border border-edge bg-surface text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/70"
                onClick={() => setSelectorOpen(true)}
            >
                {url ? (
                    <img src={url} alt="" className="absolute inset-0 h-full w-full object-cover" draggable={false} />
                ) : (
                    <span className="flex h-full w-full items-center justify-center text-fg-subtle">
                        <ImageIcon className="h-6 w-6" />
                    </span>
                )}
            </button>
            <div className="mt-2 flex gap-2">
                <button
                    ref={selectButtonRef}
                    type="button"
                    className="flex h-9 min-w-0 flex-1 items-center rounded-md border border-edge bg-surface-raised px-3 text-left text-sm text-fg-muted hover:border-primary/40"
                    onClick={() => setSelectorOpen(true)}
                >
                    <span className={["truncate", asset ? "" : "italic text-fg-subtle"].join(" ")}>{label}</span>
                </button>
                <button
                    type="button"
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-edge bg-fill-subtle text-fg-muted hover:border-danger/40 hover:text-danger disabled:cursor-not-allowed disabled:opacity-40"
                    disabled={!assetId}
                    data-tip={t("story.sceneEditor.clearBackground")} aria-label={t("story.sceneEditor.clearBackground")}
                    onClick={() => data.onUpdateScene({ defaultBackgroundAssetId: null })}
                >
                    <Trash2 className="h-3.5 w-3.5" />
                </button>
            </div>

            <AssetSelector
                visible={selectorOpen}
                assetType={AssetType.Image}
                onClose={() => setSelectorOpen(false)}
                onConfirm={handleSelect}
                selectedIds={assetId ? [assetId] : []}
                anchorRef={selectButtonRef}
                title={t("story.sceneEditor.selectDefaultBackground")}
                multiple={false}
                {...(virtualGroups ? { virtualGroups, resolveAssetPreviewUrl } : {})}
            />
        </div>
    );
}

/**
 * The scene's opening music, the body of the scene inspector's Music section: the same picker row and
 * folded options as a page's music ({@link MusicField}).
 *
 * Writes the whole record through the scene editor's own commit, which records the undo step. The
 * options end with the bus line, because which of the player's volumes reaches this music follows
 * from where its track sits among the project's tracks, on another surface.
 */
function SceneMusicField({ data, readOnly }: CustomFieldProps<StorySceneEditorContext>) {
    const { t } = useTranslation();
    return (
        <MusicField
            music={data.scene.bgm ?? null}
            onChange={next => {
                data.onUpdateScene({ bgm: next });
            }}
            chooseLabel={t("properties.music.chooseScene")}
            showBus
            readOnly={readOnly}
        />
    );
}

/**
 * Scene-level properties, shown when a story scene tab is in front with no row selected.
 *
 * Exactly the four things `StorySceneUpdate` can write. Nothing here invents a field the document
 * does not have, and nothing here is a second copy of the header card's state — both read the scene
 * off the same document and write through the same commit.
 */
export const storyScenePropertySchema = (t: TranslateFn) =>
    createPropertyEditorSchema<StorySceneEditorContext>({
        id: "story-scene",
        // Never rendered (PropertyEditor draws fields only); kept because the schema type carries it.
        title: t("properties.panel.scene"),
        fields: [
            defineField<StorySceneEditorContext, TextFieldDefinition<StorySceneEditorContext>>({
                id: "storyScene.name",
                type: "text",
                label: t("common.name"),
                maxLength: 120,
                getValue: data => data.scene.name,
                setValue: (data, value) => {
                    data.onUpdateScene({ name: value });
                },
                order: 10,
            }),
            defineField<StorySceneEditorContext, TextareaFieldDefinition<StorySceneEditorContext>>({
                id: "storyScene.description",
                type: "textarea",
                label: t("common.description"),
                rows: 3,
                maxLength: 600,
                placeholder: t("story.sceneEditor.noDescription"),
                getValue: data => data.scene.description ?? "",
                setValue: (data, value) => {
                    data.onUpdateScene({ description: value });
                },
                order: 20,
            }),
            defineField<StorySceneEditorContext, CustomFieldDefinition<StorySceneEditorContext>>({
                id: "storyScene.defaultBackground",
                type: "custom",
                label: t("story.sceneEditor.defaultBackground"),
                component: SceneDefaultBackgroundField,
                order: 30,
            }),
            defineField<StorySceneEditorContext, SectionFieldDefinition<StorySceneEditorContext>>({
                id: "storyScene.music",
                type: "section",
                // A section of its own, as a page's music and an element's sounds have: the clip and
                // the options folded under it are one thing.
                title: t("properties.music.title"),
                fields: [
                    defineField<StorySceneEditorContext, CustomFieldDefinition<StorySceneEditorContext>>({
                        id: "storyScene.music.editor",
                        type: "custom",
                        component: SceneMusicField,
                    }),
                ],
                order: 40,
            }),
        ],
    });
