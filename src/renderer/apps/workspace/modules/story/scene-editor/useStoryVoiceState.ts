import { useCallback, useEffect, useMemo, useState } from "react";
import { useWorkspace } from "@/apps/workspace/context";
import { useRegistry } from "@/apps/workspace/registry";
import { Services } from "@/lib/workspace/services/services";
import { VoiceService } from "@/lib/workspace/services/voice/VoiceService";
import { AssetsService } from "@/lib/workspace/services/core/AssetsService";
import { AssetType } from "@/lib/workspace/services/assets/assetTypes";
import { deriveVoiceUnitState, type VoiceUnitState } from "@/lib/workspace/services/voice/voiceModel";
import { serializeSegmentSourceText } from "@shared/utils/localizationText";
import type { StoryBlock } from "@shared/types/story";
import type { VoiceDocument, VoiceLocaleEntry } from "@shared/types/voice";
import { createVoiceEditorTab } from "../../voice/openVoiceEditorTab";
import { toggleVoiceAudition, useVoiceAuditionKey } from "./voiceAudition";

/** The voiceable segment of a block (spoken narration/dialogue), or null. */
export function voiceableSegment(block: StoryBlock): { textId: string; sourceText: string } | null {
    if (block.kind !== "nodeAction") {
        return null;
    }
    const payload = block.payload;
    if (payload.action === "narration" || payload.action === "dialogue") {
        return { textId: payload.text.textId, sourceText: serializeSegmentSourceText(payload.text) };
    }
    return null;
}

export type StoryVoiceState = {
    /** The block's voiceable segment, or null when the row cannot carry a take. */
    segment: { textId: string; sourceText: string } | null;
    /** The primary voice locale, or null when the project has no voiced language. */
    primary: VoiceLocaleEntry | null;
    /** Take state in the primary locale: "missing" (no take), "linked"/"approved", or "stale". */
    state: VoiceUnitState;
    /** Whether a take exists at all (state !== "missing"). */
    hasTake: boolean;
    /** Whether the take is out of date with the current line text. */
    stale: boolean;
    /** Whether this row's take is the one currently auditioning. */
    isPlaying: boolean;
    /** Play this row's take, or stop it if it is already playing. No-op without a take. */
    toggleAudition: () => void;
    /** Open the primary locale's voice table (where assignment / management live). */
    openVoiceTable: () => void;
};

/**
 * The shared voice-state read for a story row (WI-4). Extracted from `StoryVoiceIndicator` so the row
 * mic, the row audition button, and the inspector voice section all query takes one way — the primary
 * locale's document, cached by the voice service — instead of each re-deriving it. Also wires the
 * shared single-player audition and the jump to the voice table.
 */
export function useStoryVoiceState(block: StoryBlock): StoryVoiceState {
    const { context, isInitialized } = useWorkspace();
    const { openEditorTab } = useRegistry();

    const voiceService = useMemo(
        () => (context && isInitialized ? context.services.get<VoiceService>(Services.Voice) : null),
        [context, isInitialized],
    );
    const assetsService = useMemo(
        () => (context && isInitialized ? context.services.get<AssetsService>(Services.Assets) : null),
        [context, isInitialized],
    );

    const [primary, setPrimary] = useState<VoiceLocaleEntry | null>(null);
    const [doc, setDoc] = useState<VoiceDocument | null>(null);

    useEffect(() => {
        if (!voiceService) {
            setPrimary(null);
            return;
        }
        const read = () => setPrimary(voiceService.getConfiguration().voicedLocales[0] ?? null);
        read();
        return voiceService.onConfigChanged(read);
    }, [voiceService]);

    useEffect(() => {
        if (!voiceService || !primary) {
            setDoc(null);
            return;
        }
        const locale = primary.code;
        let disposed = false;
        setDoc(voiceService.getDocumentIfLoaded(locale) ?? null);
        void voiceService.loadDocument(locale).then(loaded => {
            if (!disposed) {
                setDoc(loaded);
            }
        }).catch(() => undefined);
        const unsubscribe = voiceService.onDocumentChanged(event => {
            if (event.locale === locale) {
                setDoc(event.document);
            }
        });
        return () => {
            disposed = true;
            unsubscribe();
        };
    }, [voiceService, primary]);

    const segment = voiceableSegment(block);
    const unit = segment ? doc?.units[segment.textId] : undefined;
    const state = segment ? deriveVoiceUnitState(unit, segment.sourceText) : "missing";
    const assetId = unit?.assetId;

    // Namespaced by locale + line so the same take auditions as one entry across every surface.
    const auditionKey = segment && primary ? `voice-audition:${primary.code}:${segment.textId}` : null;
    const playingKey = useVoiceAuditionKey();
    const isPlaying = auditionKey !== null && playingKey === auditionKey;

    const toggleAudition = useCallback(() => {
        if (!auditionKey || !assetId || !assetsService) {
            return;
        }
        void toggleVoiceAudition(auditionKey, async () => {
            const asset = assetsService.getAssets()[AssetType.Audio]?.[assetId];
            if (!asset) {
                return null;
            }
            const result = await assetsService.fetch(asset);
            return result.success ? new Uint8Array((result.data as { data: Uint8Array }).data) : null;
        });
    }, [assetId, assetsService, auditionKey]);

    const openVoiceTable = useCallback(() => {
        if (primary) {
            openEditorTab(createVoiceEditorTab(primary.code, primary.displayName));
        }
    }, [openEditorTab, primary]);

    return {
        segment,
        primary,
        state,
        hasTake: state !== "missing",
        stale: state === "stale",
        isPlaying,
        toggleAudition,
        openVoiceTable,
    };
}
