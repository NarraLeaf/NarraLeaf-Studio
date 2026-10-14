import { useTranslation } from "@/lib/i18n";
import { readUIPageMusic, type UIPageMusic } from "@shared/types/ui-editor/pageMusic";
import type { CustomFieldProps } from "../framework/types";
import type { SceneEditorContext } from "../schemas/sceneSchema";
import { MusicSettingField } from "./MusicSettingField";

/**
 * The page's music: the scene inspector's music control, for a page.
 *
 * Plays while the page is the page on screen and hands over when another page with music of its own
 * takes the screen, or when the page leaves it; see `runtime/app/pageMusic.ts` for the whole rule.
 * Each control's edits fold into one undo step, so dragging the volume is one Ctrl+Z.
 */
export function SurfaceMusicField({ data }: CustomFieldProps<SceneEditorContext>) {
    const { t } = useTranslation();
    const music = readUIPageMusic(data.surface);

    return (
        <MusicSettingField
            value={music}
            onChange={(next, edit) => {
                data.documentService.updateSurface(data.surface.id, surface => {
                    const settings = { ...(surface.settings ?? {}) };
                    if (next) {
                        settings.music = next as UIPageMusic;
                    } else {
                        // Cleared means gone, not "options with no clip": a half-filled record would
                        // outlive the choice that made it and keep claiming the asset it no longer plays.
                        delete settings.music;
                    }
                    surface.settings = settings;
                }, { mergeKey: `surface:${data.surface.id}:music:${edit}` });
            }}
            clearLabel={t("properties.scene.clearMusic")}
            selectTitle={t("properties.scene.selectMusic")}
        />
    );
}
