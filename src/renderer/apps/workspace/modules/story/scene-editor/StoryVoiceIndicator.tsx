/**
 * A quiet voice-state marker on a spoken story row. It shows nothing until the
 * line actually has a voice take in the project's primary voice language, so a
 * project without voice — or a line no one has voiced — sees no new chrome. When
 * a take exists it renders a small mic (warning-coloured when the line changed
 * after the take was imported); clicking it opens that language's voice table,
 * where assignment and auditioning live. Read-only by design: the story editor
 * surfaces voice, the voice table manages it.
 * Comments in English per project convention.
 */

import { useEffect, useMemo, useState } from "react";
import { Mic } from "lucide-react";
import { useWorkspace } from "@/apps/workspace/context";
import { useRegistry } from "@/apps/workspace/registry";
import { useTranslation } from "@/lib/i18n";
import { Services } from "@/lib/workspace/services/services";
import { VoiceService } from "@/lib/workspace/services/voice/VoiceService";
import { deriveVoiceUnitState } from "@/lib/workspace/services/voice/voiceModel";
import { serializeSegmentSourceText } from "@shared/utils/localizationText";
import type { StoryBlock } from "@shared/types/story";
import type { VoiceDocument, VoiceLocaleEntry } from "@shared/types/voice";
import { createVoiceEditorTab } from "../../voice/openVoiceEditorTab";

/** The voiceable segment of a block (spoken narration/dialogue), or null. */
function voiceableSegment(block: StoryBlock): { textId: string; sourceText: string } | null {
    if (block.kind !== "nodeAction") {
        return null;
    }
    const payload = block.payload;
    if (payload.action === "narration" || payload.action === "dialogue") {
        return { textId: payload.text.textId, sourceText: serializeSegmentSourceText(payload.text) };
    }
    return null;
}

export function StoryVoiceIndicator({ block }: { block: StoryBlock }) {
    const { context, isInitialized } = useWorkspace();
    const { openEditorTab } = useRegistry();
    const { t } = useTranslation();

    const voiceService = useMemo(
        () => (context && isInitialized ? context.services.get<VoiceService>(Services.Voice) : null),
        [context, isInitialized],
    );

    const [primary, setPrimary] = useState<VoiceLocaleEntry | null>(null);
    const [doc, setDoc] = useState<VoiceDocument | null>(null);

    // Primary voice language (first configured); the story marker tracks it.
    useEffect(() => {
        if (!voiceService) {
            setPrimary(null);
            return;
        }
        const read = () => setPrimary(voiceService.getConfiguration().voicedLocales[0] ?? null);
        read();
        return voiceService.onConfigChanged(read);
    }, [voiceService]);

    // Primary-language voice document (cached across rows by the service).
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
    if (!segment || !primary) {
        return null;
    }
    const state = deriveVoiceUnitState(doc?.units[segment.textId], segment.sourceText);
    if (state === "missing") {
        // No take for this line — the story editor stays clean; voice it in the voice table.
        return null;
    }

    const outdated = state === "stale";
    return (
        <button
            type="button"
            tabIndex={-1}
            title={outdated ? t("story.rows.voiceOutdated") : t("story.rows.voiceManage")}
            className={`flex h-6 w-6 shrink-0 items-center justify-center rounded hover:bg-fill hover:text-fg ${
                outdated ? "text-warning" : "text-fg-subtle"
            }`}
            onClick={event => {
                event.stopPropagation();
                openEditorTab(createVoiceEditorTab(primary.code, primary.displayName));
            }}
        >
            <Mic className="h-3.5 w-3.5" />
        </button>
    );
}
