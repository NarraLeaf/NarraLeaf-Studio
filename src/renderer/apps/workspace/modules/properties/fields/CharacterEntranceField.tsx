import { useEffect, useMemo, useState } from "react";
import type { StoryTransformProps, StoryTransformRef } from "@shared/types/story";
import { useTranslation } from "@/lib/i18n";
import { Services } from "@/lib/workspace/services/services";
import type { ProjectService } from "@/lib/workspace/services/core/ProjectService";
import { useWorkspace } from "@/apps/workspace/context";
import { TransformChannelEditor } from "@/apps/workspace/modules/story/scene-editor/TransformChannelEditor";
import { resolveStoryMotionStageSize } from "@/apps/workspace/modules/story-motion/StoryMotionEditorTab";
import { Button, type ContextMenuDef } from "@/lib/components/elements";
import { useCompositedSprite } from "@/lib/workspace/hooks/useCompositedSprite";
import { framedEntrance, type EntranceMatch } from "@/lib/workspace/services/agent/spriteStage";
import { castEntranceMatches, measureCharacterSprite, type SpriteHeadDetector } from "@/lib/workspace/services/agent/spriteFacts";
import { CharacterEntrancePreview, SPRITE_COMPOSITE_PX } from "./CharacterEntrancePreview";
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
/** The head model, loaded on first use: it is a few megabytes of WebAssembly and weights. */
const detectHead: SpriteHeadDetector = async layers =>
    (await import("@/lib/workspace/services/character/headDetector")).detectHeadFrame(layers);

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

    // The standard framing (`framedEntrance`), measured on her figure when asked for: where the
    // silhouette sits in the picture and, from the head model, how many heads tall she is. The model
    // loads only here, on the author's click - never on its own. Same composite the preview asks for,
    // so the compositor answers both from one entry; its `size` is the artwork's.
    const sprite = useCompositedSprite(data.character, {}, SPRITE_COMPOSITE_PX);
    const [framing, setFraming] = useState(false);
    const applyFramed = async (): Promise<void> => {
        const size = sprite.size;
        if (!context || !isInitialized || !size || framing) {
            return;
        }
        setFraming(true);
        try {
            const measure = await measureCharacterSprite(context, data.character, detectHead);
            commitProps(framedEntrance(size, stageSize, measure ?? undefined));
        } finally {
            setFraming(false);
        }
    };

    // Cast members whose art is the same size: drawn to one scale, so sharing their defaults keeps
    // the difference in heights that framing each character on her own would erase.
    const [matched, setMatched] = useState<{ characterId: string; matches: EntranceMatch[] }>({ characterId, matches: [] });
    useEffect(() => {
        if (!context || !isInitialized || !sprite.size) {
            return;
        }
        let live = true;
        void castEntranceMatches(context, data.character, sprite.size)
            .then(matches => { if (live) setMatched({ characterId, matches }); })
            .catch(() => undefined);
        return () => { live = false; };
    }, [characterId, context, data.character, isInitialized, sprite.size]);
    const matches = matched.characterId === characterId ? matched.matches : [];
    const sameAs = (props: StoryTransformProps) => JSON.stringify(props) === JSON.stringify(value);

    const applyFramedLabel = t("characters.properties.entranceApplyFramed");
    const matchLabel = (match: EntranceMatch) => t("characters.properties.entranceMatch", { name: match.name });
    const menuItems: ContextMenuDef | undefined = sprite.size
        ? [
            { id: "apply-framed", label: applyFramedLabel, disabled: framing, onClick: () => void applyFramed() },
            ...matches.slice(0, 5).map((match, index) => ({
                id: `match-${index}`,
                label: matchLabel(match),
                disabled: sameAs(match.props),
                onClick: () => commitProps(structuredClone(match.props)),
            })),
        ]
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
                menuItems={menuItems}
                onChange={commit}
            />
            {value === undefined && (
                <div className="mt-1 flex items-center gap-2">
                    <p className="min-w-0 flex-1 text-xs text-fg-subtle">{t("characters.properties.entranceEmpty")}</p>
                    {matches[0] && (
                        <Button size="sm" onClick={() => commitProps(structuredClone(matches[0].props))}>{matchLabel(matches[0])}</Button>
                    )}
                    {sprite.size && (
                        <Button size="sm" disabled={framing} onClick={() => void applyFramed()}>{applyFramedLabel}</Button>
                    )}
                </div>
            )}
        </div>
    );
}
