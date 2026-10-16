import { useEffect, useState } from "react";
import { readUIPageMusicChoice, type UIPageMusicSetting } from "@shared/types/ui-editor/pageMusic";
import { useTranslation } from "@/lib/i18n";
import { Select } from "@/lib/components/elements";
import type { CustomFieldProps } from "../framework/types";
import type { SceneEditorContext } from "../schemas/sceneSchema";
import { MusicField } from "./MusicField";

type MusicMode = "keep" | "play" | "silence";

/**
 * The page's music, the body of the page inspector's Music section.
 *
 * One choice of three, always named: keep whatever is playing, play this, or no music. Keep is what
 * a page nobody touched does, and it is written as no field at all; the choice still says it in
 * words, so the section always states what the page will do. Play opens the music setting every
 * other music in Studio uses ({@link MusicField}). The whole rule - Back, Replace Page, the nodes
 * that set it from a graph, a game holding the screen - is `runtime/app/pageMusic.ts`.
 */
export function SurfaceMusicField({ data, readOnly }: CustomFieldProps<SceneEditorContext>) {
    const { t } = useTranslation();
    const choice = readUIPageMusicChoice(data.surface);
    // Play picked, and no music chosen yet. Nothing is written until there is a clip - a record that
    // says "play" and names nothing would be one more state for the page to be in - so the choice
    // is held here, and the page goes on doing what it does until a clip is picked.
    const [choosing, setChoosing] = useState(false);
    useEffect(() => {
        setChoosing(false);
    }, [data.surface.id]);
    const mode: MusicMode = choosing ? "play" : choice.kind;

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

    const pickMode = (value: string | number) => {
        const next = String(value) as MusicMode;
        if (next === "play") {
            setChoosing(choice.kind !== "play");
            return;
        }
        setChoosing(false);
        if (next !== choice.kind) {
            write(next === "silence" ? { silent: true } : null, "mode");
        }
    };

    return (
        <div className="flex flex-col gap-1.5">
            <Select
                size="sm"
                fullWidth
                value={mode}
                readOnly={readOnly}
                ariaLabel={t("properties.music.title")}
                options={[
                    { value: "keep", label: t("properties.music.keep") },
                    { value: "play", label: t("properties.music.play") },
                    { value: "silence", label: t("properties.music.silent") },
                ]}
                onChange={pickMode}
            />
            {mode === "play" ? (
                <MusicField
                    music={choice.kind === "play" ? choice.music : null}
                    onChange={(next, edit) => {
                        // A clip cleared leaves Play picked with nothing chosen, ready for the next one.
                        setChoosing(next === null);
                        write(next, edit);
                    }}
                    emptyLabel={t("properties.music.notChosen")}
                    chooseLabel={t("properties.music.choosePage")}
                    readOnly={readOnly}
                />
            ) : null}
        </div>
    );
}
