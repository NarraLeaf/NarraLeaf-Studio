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
import type { CharacterService } from "@/lib/workspace/services/core/CharacterService";
import type { PanelStateService } from "@/lib/workspace/services/core/PanelStateService";
import type { VoiceService } from "@/lib/workspace/services/voice/VoiceService";
import type { VariableRegistryService } from "@/lib/workspace/services/variables/VariableRegistryService";
import type { StoryService } from "@/lib/workspace/services/story/StoryService";
import type { VoiceDocument } from "@shared/types/voice";
import type { StoryAnimationAsset, StoryBlockId, StoryScene } from "@shared/types/story";
import { buildSavedRuntimeTable } from "@shared/variables/variableRegistryModel";
import { resolveAssetDisplayName } from "@/lib/workspace/assets/assetDisplayName";
import { useAssetLibraryRevision } from "@/lib/workspace/hooks/useAssetLibraryRevision";
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
    type StageTimelineNames,
} from "./stageTimelineModel";
import { StageTimelineView, type StageTimelineLanePaint } from "./StageTimelineView";
import { STAGE_TIMELINE_PANEL_ID } from "./stageTimelineIds";

type StageTimelinePanelState = { showAllRows?: boolean };

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
    const [showAllRows, setShowAllRows] = useState(
        () => panelState?.getPanelState<StageTimelinePanelState>(STAGE_TIMELINE_PANEL_ID)?.showAllRows ?? false,
    );
    const changeShowAllRows = useCallback((next: boolean) => {
        setShowAllRows(next);
        panelState?.setPanelState<StageTimelinePanelState>(STAGE_TIMELINE_PANEL_ID, { showAllRows: next });
    }, [panelState]);
    const [zoom, setZoom] = useState(1);

    // The option picked at each menu, per scene: a menu the author has not picked goes down its first.
    const [picks, setPicks] = useState<{ sceneId: string | null; map: ReadonlyMap<StoryBlockId, StoryBlockId> }>({ sceneId: null, map: new Map() });
    const scenePicks = picks.sceneId === sceneId ? picks.map : EMPTY_PICKS;
    const pick = useCallback((choiceId: StoryBlockId, optionId: StoryBlockId) => {
        let current = cursor && scene ? scene.blocks[cursor] : undefined;
        while (current?.parentId && current.parentId !== choiceId) {
            current = scene?.blocks[current.parentId];
        }
        if (current?.parentId === choiceId && current.id !== optionId) {
            tab?.stepTo(choiceId);
        }
        setPicks(current => {
            const map = new Map(current.sceneId === sceneId ? current.map : EMPTY_PICKS);
            map.set(choiceId, optionId);
            return { sceneId, map };
        });
    }, [cursor, scene, sceneId, tab]);

    const names = useTimelineNames(context, ready);
    const animations = useTimelineAnimations(context, ready, scene);
    const registryService = useMemo(() => (context && ready ? context.services.get<VariableRegistryService>(Services.VariableRegistry) : null), [context, ready]);
    const [registryRevision, setRegistryRevision] = useState(0);
    useEffect(() => registryService?.onRegistryChanged(() => setRegistryRevision(revision => revision + 1)), [registryService]);
    const savedVariables = useMemo(
        () => registryService ? buildSavedRuntimeTable(registryService.getRegistry()) : undefined,
        [registryRevision, registryService],
    );

    const throughKey = scene ? stageTimelineThrough(scene, cursor, scenePicks).join("\n") : "";
    const model = useMemo(() => {
        if (!document || !scene || !sceneId) {
            return null;
        }
        const walk = walkStoryStageTimeline({
            document,
            sceneId,
            through: throughKey ? throughKey.split("\n") : [],
            savedVariables,
            animations,
        });
        return buildStageTimelineModel({ walk, scene, names: names.names });
    }, [animations, document, names, savedVariables, scene, sceneId, throughKey]);

    const order = useMemo(() => (scene ? sceneBlockOrder(scene) : new Map<StoryBlockId, number>()), [scene]);
    const textWidths = useMemo(() => (model ? model.lines.map(line => (line === null ? null : measureLine(line))) : []), [model]);
    const columns = useMemo(() => stageTimelineColumns(textWidths, zoom), [textWidths, zoom]);
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
            showAllRows={showAllRows}
            onShowAllRowsChange={changeShowAllRows}
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
const EMPTY_ANIMATIONS: ReadonlyMap<string, StoryAnimationAsset> = new Map();

/** Load the same referenced motions the story preview passes to its stage walk. */
function useTimelineAnimations(context: ReturnType<typeof useWorkspace>["context"], ready: boolean, scene: StoryScene | null) {
    const service = useMemo(() => (context && ready ? context.services.get<StoryService>(Services.Story) : null), [context, ready]);
    const [loaded, setLoaded] = useState<{ scene: StoryScene; service: StoryService; animations: ReadonlyMap<string, StoryAnimationAsset> } | null>(null);
    useEffect(() => {
        if (!scene || !service) {
            return;
        }
        const ids = new Set<string>();
        const visit = (value: unknown): void => {
            if (!value || typeof value !== "object") {
                return;
            }
            if (Array.isArray(value)) {
                value.forEach(visit);
                return;
            }
            const record = value as Record<string, unknown>;
            if (typeof record.animationId === "string" && record.animationId) {
                ids.add(record.animationId);
            }
            Object.values(record).forEach(visit);
        };
        Object.values(scene.blocks).forEach(block => visit(block.payload));
        let generation = 0;
        let disposed = false;
        const load = () => {
            const current = ++generation;
            void Promise.all([...ids].map(async id => {
                try {
                    return [id, await service.loadAnimationAsset(id)] as const;
                } catch {
                    return null;
                }
            })).then(entries => {
                if (!disposed && current === generation) {
                    setLoaded({ scene, service, animations: new Map(entries.filter(entry => entry !== null)) });
                }
            });
        };
        load();
        const unsubscribe = service.onAnimationsChanged(load);
        return () => { disposed = true; unsubscribe(); };
    }, [scene, service]);
    return loaded?.scene === scene && loaded.service === service ? loaded.animations : EMPTY_ANIMATIONS;
}

let measureContext: CanvasRenderingContext2D | null | undefined;

/**
 * How wide a line's words are in the dialogue strip (`text-2xs`, the app's own face), so its column
 * can hold it whole. Zero where there is no canvas to measure with, which leaves the column one unit.
 */
function measureLine(text: string): number {
    if (measureContext === undefined) {
        measureContext = typeof window.document?.createElement === "function"
            ? window.document.createElement("canvas").getContext("2d")
            : null;
    }
    if (!measureContext) {
        return 0;
    }
    measureContext.font = `11px ${getComputedStyle(window.document.body).fontFamily}`;
    return Math.ceil(measureContext.measureText(text).width);
}

/**
 * The names and lengths the model puts on things, kept current with the cast, the asset library and
 * the primary voice language's takes.
 */
function useTimelineNames(context: ReturnType<typeof useWorkspace>["context"], ready: boolean) {
    const characterService = useMemo(() => (context && ready ? context.services.get<CharacterService>(Services.Character) : null), [context, ready]);
    const voiceService = useMemo(() => (context && ready ? context.services.get<VoiceService>(Services.Voice) : null), [context, ready]);
    const assetRevision = useAssetLibraryRevision();

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
        let generation = 0;
        const load = () => {
            const current = ++generation;
            const primary = voiceService.getConfiguration().voicedLocales[0];
            if (!primary) {
                setVoice(null);
                return;
            }
            setVoice(voiceService.getDocumentIfLoaded(primary.code) ?? null);
            void voiceService.loadDocument(primary.code).then(loaded => {
                if (!disposed && current === generation) {
                    setVoice(loaded);
                }
            }).catch(() => undefined);
        };
        load();
        const offConfig = voiceService.onConfigChanged(load);
        const offDocument = voiceService.onDocumentChanged(event => {
            if (event.locale === voiceService.getConfiguration().voicedLocales[0]?.code) {
                generation += 1;
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
            asset: assetId => resolveAssetDisplayName(ready ? context?.services : null, assetId),
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
    }, [assetRevision, characters, context, ready, voice]);
}
