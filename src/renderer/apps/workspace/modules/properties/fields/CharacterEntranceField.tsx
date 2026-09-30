import { useMemo, useState } from "react";
import type { StoryTransformProps, StoryTransformRef } from "@shared/types/story";
import { useTranslation } from "@/lib/i18n";
import { Services } from "@/lib/workspace/services/services";
import type { ProjectService } from "@/lib/workspace/services/core/ProjectService";
import { useWorkspace } from "@/apps/workspace/context";
import { TransformChannelEditor } from "@/apps/workspace/modules/story/scene-editor/TransformChannelEditor";
import { resolveStoryMotionStageSize } from "@/apps/workspace/modules/story-motion/StoryMotionEditorTab";
import { CharacterEntrancePreview } from "./CharacterEntrancePreview";
import type { CustomFieldProps } from "../framework/types";
import type { CharacterEditorContext } from "../schemas/characterSchema";

/**
 * What this character's entrances fall back to, channel by channel.
 *
 * How big a sprite is drawn, which way it faces and where its feet land come from the artwork's
 * pixel size against the stage's - one answer for the whole cast list, restated on every `/show` row
 * until it lived here. A row still wins on any channel it names, and only on that channel, so
 * `/show Alice pos=left` moves her without resizing her.
 *
 * The story inspector shows what an entrance row inherits from here under a heading of its own, so
 * the numbers are readable from the row as well as from the character - and editing one there takes
 * that channel over for that row alone.
 *
 * A `custom` field rather than one of the framework's, because what it edits is a bag of channels
 * rather than a value: it renders the story inspector's own channel list, which is the surface an
 * author already uses to state the same props on a row. `scope="characterDefaults"` is what keeps
 * the picker to the channels this record can hold - a duration or a reveal belongs to the row that
 * plays an entrance, not to the character entering.
 */
export function CharacterEntranceField({ data }: CustomFieldProps<CharacterEditorContext>) {
    const { t } = useTranslation();
    const profile = data.character.profile;
    // Local, but tagged with whose value it is: the panel reuses one mounted field across
    // characters, so a plain `useState` would show the previous character's defaults until
    // something else re-rendered. Same shape as `CharacterVoiceTrackField`.
    const characterId = profile.getId();
    const [draft, setDraft] = useState(() => ({ characterId, props: profile.getEntranceTransform() }));
    const value = draft.characterId === characterId ? draft.props : profile.getEntranceTransform();

    const { context, isInitialized } = useWorkspace();
    const projectService = useMemo(
        () => (context && isInitialized ? context.services.get<ProjectService>(Services.Project) : null),
        [context, isInitialized],
    );
    // The project's own resolution, so the box has the shape of the stage this character enters.
    const stageSize = useMemo(() => resolveStoryMotionStageSize(projectService), [projectService]);

    // The character's own art, so the channel tiles are drawn on her rather than on the bundled
    // sample. Only a preset appearance can answer with one picture: a layered or runtime-drawn
    // character is assembled at play time, and picking one layer would show a part as the whole.
    const appearance = profile.appearance;
    const previewAssetId = appearance.getKind() === "preset"
        ? appearance.resolvePoseAssetId(undefined) ?? undefined
        : undefined;

    const commit = (next: StoryTransformRef): void => {
        commitProps(next.to);
    };

    const commitProps = (props: StoryTransformProps | undefined): void => {
        setDraft({ characterId, props });
        profile.setEntranceTransform(props);
        // What the setter kept, which is not always what it was handed: a channel this record cannot
        // carry is dropped, and the panel has to show the stored answer rather than the asked one.
        setDraft({ characterId, props: profile.getEntranceTransform() });
    };

    return (
        <div className="min-w-0 space-y-2">
            <CharacterEntrancePreview
                character={data.character}
                value={value}
                stageSize={stageSize}
                onCommit={commitProps}
            />
            <TransformChannelEditor
                value={{ mode: "props", to: value ?? {} }}
                targetKind="character"
                scope="characterDefaults"
                previewAssetId={previewAssetId}
                onChange={commit}
            />
            {value === undefined && (
                <p className="mt-1 text-xs text-fg-subtle">{t("characters.properties.entranceEmpty")}</p>
            )}
        </div>
    );
}
