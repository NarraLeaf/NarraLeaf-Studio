import {VOICE_DOCUMENT_SCHEMA_VERSION, VoiceDocument, normalizeVoiceDocument} from "../../types/voice";
import {compileDocumentPathPattern} from "../documentPath";
import {defineDocumentSpec} from "../registry";
import {parameterFromPath, rejectNewerSchema, requireDocumentObject, requireOptionalMap} from "./parseHelpers";

/**
 * `editor/voice/<locale>.json` - one voice library per voice language.
 *
 * Owned by `VoiceService`. The locale comes from the path rather than from the document's own
 * `locale` field, which is what `normalizeVoiceDocument` has always done: the file is addressed by
 * path, so a file whose field disagreed with its name would otherwise be written back to whichever
 * name its contents claimed.
 */
export const VOICE_DOCUMENT_PATH = "editor/voice/<locale>.json";

const VOICE_DOCUMENT_PATTERN = compileDocumentPathPattern(VOICE_DOCUMENT_PATH);

export const voiceDocumentSpec = defineDocumentSpec<VoiceDocument>({
    kind: "voice",
    version: VOICE_DOCUMENT_SCHEMA_VERSION,
    paths: [VOICE_DOCUMENT_PATH],
    parse: (raw, context) => {
        const locale = parameterFromPath(VOICE_DOCUMENT_PATTERN, "locale", context);
        const record = requireDocumentObject(raw, context, "a voice library");
        rejectNewerSchema(record, context, VOICE_DOCUMENT_SCHEMA_VERSION);
        requireOptionalMap(record, "units", context);
        return normalizeVoiceDocument(record, locale);
    },
    summarize: document => ({
        title: document.locale,
        counts: [{key: "voiceUnits", value: Object.keys(document.units).length}],
    }),
});
