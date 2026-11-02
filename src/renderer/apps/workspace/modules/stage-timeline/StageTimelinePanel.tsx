/**
 * The stage timeline (bottom dock): the scene the author is editing, one lane per thing on the stage,
 * one column per row that runs.
 *
 * It follows the story scene tab the live preview follows, and its cursor is that tab's editor
 * cursor: a press on a column moves the editor there, and moving in the editor moves the column.
 * Everything it draws comes from one whole-scene walk ({@link walkStoryStageTimeline}), the same
 * walk the preview poses its stage from, so a column and the preview of its row agree.
 *
 * Comments in English per project convention.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import type { PanelComponentProps } from "../types";
import { useTranslation } from "@/lib/i18n";
import { EmptyState } from "@/lib/components/elements";
import { useWorkspace } from "@/apps/workspace/context";
import { Services } from "@/lib/workspace/services/services";
import type { AssetsService } from "@/lib/workspace/services/core/AssetsService";
import type { CharacterService } from "@/lib/workspace/services/core/CharacterService";
import type { PanelStateService } from "@/lib/workspace/services/core/PanelStateService";
import type { VoiceService } from "@/lib/workspace/services/voice/VoiceService";
import type { VoiceDocument } from "@shared/types/voice";
import type { StoryBlockId } from "@shared/types/story";
import { walkStoryStageTimeline } from "@/lib/ui-editor/runtime/game/storyStageSnapshot";
import { getStoryPreviewHub, useStoryPreviewHubValue, type StoryPreviewHub } from "../story/scene-editor/preview/storyPreviewHub";
import { useStoryDocument } from "../story/scene-editor/preview/StoryScenePreviewFloatHost";
import { characterIdentity } from "../story/scene-editor/StoryRowGutter";
import { storySpeakerPaint } from "../story/scene-editor/storySpeakerIdentity";
import {
    buildStageTimelineModel,
    sceneBlockOrder,
    stageTimelineColumns,
    stageTimelineCursorColumn,
    stageTimelineThrough,
    type StageTimelineLayoutMode,
    type StageTimelineNames,
} from "./stageTimelineModel";
import { StageTimelineView, type StageTimelineLanePaint } from "./StageTimelineView";
import { STAGE_TIMELINE_PANEL_ID } from "./stageTimelineIds";

type StageTimelinePanelState = { layout?: StageTimelineLayoutMode };

const selectTargetTab = (hub: StoryPreviewHub) => hub.getTab(hub.getTarget());

export function StageTimelinePanel(_props: PanelComponentProps) {
    const { t } = useTranslation();
    const { context, isInitialized } = useWorkspace();
    const ready = Boolean(context && isInitialized);
    const hub = useMemo(() => (context && ready ? getStoryPreviewHub(context) : null), [context, ready]);
    const tab = useStoryPreviewHubValue(hub, selectTargetTab, undefined);
    const storyId = tab?.storyId ?? null;
    const sceneId = tab?.sceneId ?? null;
    const selectCursor = useCallback((value: StoryPreviewHub) => value.getCursor(sceneId), [sceneId]);
    const cursor = useStoryPreviewHubValue(hub, selectCursor, undefined);
    const document = useStoryDocument(ready ? context : null, storyId);
    const scene = document && sceneId ? document.scenes[sceneId] ?? null : null;

    const panelState = useMemo(() => (context && ready ? context.services.get<PanelStateService>(Services.PanelState) : null), [context, ready]);
    const [layout, setLayout] = useState<StageTimelineLayoutMode>(
        () => panelState?.getPanelState<StageTimelinePanelState>(STAGE_TIMELINE_PANEL_ID)?.layout ?? "equal",
    );
    const changeLayout = useCallback((next: StageTimelineLayoutMode) => {
        setLayout(next);
        panelState?.setPanelState<StageTimelinePanelState>(STAGE_TIMELINE_PANEL_ID, { layout: next });
    }, [panelState]);
    const [zoom, setZoom] = useState(1);

    // The option picked at each menu, per scene: a menu the author has not picked goes down its first.
    const [picks, setPicks] = useState<{ sceneId: string | null; map: ReadonlyMap<StoryBlockId, StoryBlockId> }>({ sceneId: null, map: new Map() });
    const scenePicks = picks.sceneId === sceneId ? picks.map : EMPTY_PICKS;
    const pick = useCallback((choiceId: StoryBlockId, optionId: StoryBlockId) => {
        setPicks(current => {
            const map = new Map(current.sceneId === sceneId ? current.map : EMPTY_PICKS);
            map.set(choiceId, optionId);
            return { sceneId, map };
        });
    }, [sceneId]);

    const names = useTimelineNames(context, ready);

    const throughKey = scene ? stageTimelineThrough(scene, cursor, scenePicks).join("\n") : "";
    const model = useMemo(() => {
        if (!document || !scene || !sceneId) {
            return null;
        }
        const walk = walkStoryStageTimeline({
            document,
            sceneId,
            through: throughKey ? throughKey.split("\n") : [],
        });
        return buildStageTimelineModel({ walk, scene, names: names.names });
    }, [document, names, scene, sceneId, throughKey]);

    const order = useMemo(() => (scene ? sceneBlockOrder(scene) : new Map<StoryBlockId, number>()), [scene]);
    const columns = useMemo(() => (model ? stageTimelineColumns(model.timings, layout, zoom) : []), [layout, model, zoom]);
    const cursorColumn = model ? stageTimelineCursorColumn(model.blockIds, cursor, order) : -1;

    const paints = useMemo(() => {
        const result = new Map<string, StageTimelineLanePaint>();
        for (const lane of model?.lanes ?? []) {
            if (lane.characterId) {
                result.set(lane.id, storySpeakerPaint(characterIdentity(lane.characterId, names.characters).paint));
            }
        }
        return result;
    }, [model, names.characters]);

    const stepTo = useCallback((blockId: StoryBlockId) => {
        tab?.stepTo(blockId);
    }, [tab]);

    if (!tab || !scene) {
        return <EmptyState size="sm" className="h-full" description={t("story.timeline.empty")} />;
    }
    if (!model || model.blockIds.length === 0) {
        return <EmptyState size="sm" className="h-full" description={t("story.timeline.emptyScene")} />;
    }
    return (
        <StageTimelineView
            scene={scene}
            model={model}
            columns={columns}
            cursorColumn={cursorColumn}
            layout={layout}
            onLayoutChange={changeLayout}
            zoom={zoom}
            onZoomChange={setZoom}
            paints={paints}
            characters={names.characters}
            onStepTo={stepTo}
            onPick={pick}
        />
    );
}

const EMPTY_PICKS: ReadonlyMap<StoryBlockId, StoryBlockId> = new Map();

/**
 * The names and lengths the model puts on things, kept current with the cast, the asset library and
 * the primary voice language's takes.
 */
function useTimelineNames(context: ReturnType<typeof useWorkspace>["context"], ready: boolean) {
    const characterService = useMemo(() => (context && ready ? context.services.get<CharacterService>(Services.Character) : null), [context, ready]);
    const assetsService = useMemo(() => (context && ready ? context.services.get<AssetsService>(Services.Assets) : null), [context, ready]);
    const voiceService = useMemo(() => (context && ready ? context.services.get<VoiceService>(Services.Voice) : null), [context, ready]);

    const [characterRevision, setCharacterRevision] = useState(0);
    useEffect(() => characterService?.subscribe(() => setCharacterRevision(revision => revision + 1)), [characterService]);
    const characters = useMemo(() => characterService?.listCharacter() ?? [], [characterRevision, characterService]);

    const [voice, setVoice] = useState<VoiceDocument | null>(null);
    useEffect(() => {
        if (!voiceService) {
            setVoice(null);
            return;
        }
        let disposed = false;
        const load = () => {
            const primary = voiceService.getConfiguration().voicedLocales[0];
            if (!primary) {
                setVoice(null);
                return;
            }
            setVoice(voiceService.getDocumentIfLoaded(primary.code) ?? null);
            void voiceService.loadDocument(primary.code).then(loaded => {
                if (!disposed) {
                    setVoice(loaded);
                }
            }).catch(() => undefined);
        };
        load();
        const offConfig = voiceService.onConfigChanged(load);
        const offDocument = voiceService.onDocumentChanged(event => {
            if (event.locale === voiceService.getConfiguration().voicedLocales[0]?.code) {
                setVoice(event.document);
            }
        });
        return () => {
            disposed = true;
            offConfig();
            offDocument();
        };
    }, [voiceService]);

    return useMemo(() => {
        const names: StageTimelineNames = {
            asset: assetId => {
                for (const group of Object.values(assetsService?.getAssets() ?? {})) {
                    const asset = (group as Record<string, { name?: string }> | undefined)?.[assetId];
                    if (asset?.name) {
                        return asset.name;
                    }
                }
                return null;
            },
            character: characterId => characters.find(character => character.profile.getId() === characterId)?.profile.getName() ?? null,
            appearance: (characterId, appearanceId) => {
                const appearance = characters.find(character => character.profile.getId() === characterId)?.profile.appearance;
                if (!appearance) {
                    return null;
                }
                return appearance.getPose(appearanceId)?.name
                    ?? appearance.getAxes().flatMap(axis => axis.tags).find(tag => tag.id === appearanceId)?.name
                    ?? null;
            },
            voiceSeconds: textId => voice?.units[textId]?.duration,
        };
        return { names, characters };
    }, [assetsService, characters, voice]);
}
