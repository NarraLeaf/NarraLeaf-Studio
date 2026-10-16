import { readUIPageMusicChoice, type UIPageMusicSetting } from "@shared/types/ui-editor/pageMusic";
import { useTranslation } from "@/lib/i18n";
import type { CustomFieldProps } from "../framework/types";
import type { SceneEditorContext } from "../schemas/sceneSchema";
import { MusicField } from "./MusicField";

/**
 * The page's music, the body of the page inspector's Music section.
 *
 * The music setting every other music in Studio uses ({@link MusicField}) - one picker row and the
 * playback options folded under it - with the row saying which of the page's three answers holds:
 *
 *  - no clip reads **Keep the current music**, which is what the page does: it leaves whatever is
 *    playing alone. It is written as no field at all, and the row says it in words so the empty
 *    state is never a blank the author has to interpret;
 *  - a clip plays that clip;
 *  - **No music**, offered beside Choose on the empty row, silences the page; Clear goes back to
 *    keeping.
 *
 * The whole rule - Back, Replace Page, the nodes that set it from a graph, a game holding the
 * screen - is `runtime/app/pageMusic.ts`.
 */
export function SurfaceMusicField({ data, readOnly }: CustomFieldProps<SceneEditorContext>) {
    const { t } = useTranslation();
    const choice = readUIPageMusicChoice(data.surface);

    const write = (next: UIPageMusicSetting | null, edit: string) => {
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

    const silent = choice.kind === "silence";
    return (
        <MusicField
            music={choice.kind === "play" ? choice.music : null}
            onChange={write}
            emptyLabel={silent ? t("properties.music.silent") : t("properties.music.keep")}
            {...(silent
                ? { onClearEmpty: () => write(null, "silence") }
                : { emptyActions: [{ label: t("properties.music.silent"), onClick: () => write({ silent: true }, "silence") }] })}
            chooseLabel={t("properties.music.choosePage")}
            readOnly={readOnly}
        />
    );
}
