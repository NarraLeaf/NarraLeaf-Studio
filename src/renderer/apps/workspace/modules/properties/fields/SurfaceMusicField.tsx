import { readUIPageMusic } from "@shared/types/ui-editor/pageMusic";
import { useTranslation } from "@/lib/i18n";
import type { CustomFieldProps } from "../framework/types";
import type { SceneEditorContext } from "../schemas/sceneSchema";
import { MusicField, type MusicEdit, type MusicSetting } from "./MusicField";

/**
 * The page's music, the body of the page inspector's Music section ({@link MusicField}).
 *
 * Plays while the page is the page on screen and hands over when another page with music of its own
 * takes the screen, or when the page leaves it; see `runtime/app/pageMusic.ts` for the whole rule.
 */
export function SurfaceMusicField({ data, readOnly }: CustomFieldProps<SceneEditorContext>) {
    const { t } = useTranslation();

    const write = (next: MusicSetting | null, edit: MusicEdit) => {
        data.documentService.updateSurface(data.surface.id, surface => {
            const settings = { ...(surface.settings ?? {}) };
            if (next) {
                settings.music = next;
            } else {
                // Cleared means gone, not "options with no clip": a half-filled record would
                // outlive the choice that made it and keep claiming the asset it no longer plays.
                delete settings.music;
            }
            surface.settings = settings;
        }, { mergeKey: `surface:${data.surface.id}:music:${edit}` });
    };

    return (
        <MusicField
            music={readUIPageMusic(data.surface)}
            onChange={write}
            chooseLabel={t("properties.music.choosePage")}
            readOnly={readOnly}
        />
    );
}
