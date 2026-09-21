import { afterEach, describe, expect, it, vi } from "vitest";
import { FsRejectErrorCode, type FsRequestResult } from "@shared/types/os";
import { join } from "@shared/utils/path";
import { i18nStore } from "@/lib/i18n";
import { Services, type WorkspaceContext } from "../services";
import { isReportedToAuthor } from "../autosave/reportedFailure";
import { VoiceService } from "../voice/VoiceService";
import { LocalizationService } from "./LocalizationService";

/**
 * What the localization and voice panels show when a language's document could not be read.
 *
 * Both panels print `error.message` as it is, so the message a service throws is the sentence the
 * author reads. It used to be the read's own - `Failed to read editor/localization/ja.json: EACCES...`
 * or `Failed to read translations for ja: not valid JSON: Unexpected token` - English and a
 * project-relative path in every interface language.
 */

const ROOT = join("D:/projects", "my-game");
const DOCUMENT_PATH = join(ROOT, "editor", "localization", "ja.json");
const VOICE_PATH = join(ROOT, "editor", "voice", "ja.json");

type ReadAnswer = { text: string } | { error: FsRejectErrorCode };

function createContext(answer: ReadAnswer, noticeRaised: boolean) {
    const reportUnreadableDocument = vi.fn(() => noticeRaised);
    const read = async (path: string): Promise<FsRequestResult<string>> => {
        if (path !== DOCUMENT_PATH && path !== VOICE_PATH) {
            return { ok: false, error: { code: FsRejectErrorCode.NOT_FOUND, message: "missing" } };
        }
        return "text" in answer
            ? { ok: true, data: answer.text }
            : { ok: false, error: { code: answer.error, message: `EACCES: permission denied, open '${path}'` } };
    };
    const stubs: Record<string, unknown> = {
        [Services.FileSystem]: {
            read,
            writeFileNoFollowOrCreate: async () => ({ ok: true, data: undefined }),
            createDir: async () => ({ ok: true, data: undefined }),
            copyFile: async () => ({ ok: true, data: undefined }),
        },
        [Services.Project]: {
            getLocalizationConfiguration: () => ({ sourceLocale: "en", locales: [{ code: "ja", displayName: "日本語" }] }),
            getVoiceConfiguration: () => ({
                voicedLocales: [{ code: "ja", displayName: "日本語" }],
                namingPattern: "{unitId}",
                cast: {},
                voiceChoices: false,
            }),
        },
        [Services.SaveStatus]: { register: () => undefined, reportUnreadableDocument },
        [Services.Localization]: { getDocumentIfLoaded: () => undefined, loadDocument: async () => undefined },
    };
    const context = {
        project: { getConfig: () => ({ projectPath: ROOT }) },
        services: {
            get: (id: string) => {
                const stub = stubs[id];
                if (stub === undefined) {
                    throw new Error(`Service ${id} not found`);
                }
                return stub;
            },
        },
    } as unknown as WorkspaceContext;
    return { context, reportUnreadableDocument };
}

async function failedTranslations(answer: ReadAnswer, noticeRaised = false): Promise<Error> {
    const { context } = createContext(answer, noticeRaised);
    const service = new LocalizationService();
    await service.initialize(context, async () => undefined);
    return service.loadDocument("ja").then(
        () => { throw new Error("expected the read to fail"); },
        (error: Error) => error,
    );
}

async function failedVoice(answer: ReadAnswer, noticeRaised = false): Promise<Error> {
    const { context } = createContext(answer, noticeRaised);
    const service = new VoiceService();
    await service.initialize(context, async () => undefined);
    return service.loadDocument("ja").then(
        () => { throw new Error("expected the read to fail"); },
        (error: Error) => error,
    );
}

/** Everything a sentence may not carry: a path, a file name Studio chose, the parser's or Node's English. */
const LEAKS = /editor\/|\.json|EACCES|JSON|Unexpected|token|Failed to|app:\/\/|[A-Z]:[\\/]/;

/** Latin words other than the product's own name, the language's name and the `ja` code. */
function strayLatin(text: string): string[] {
    return (text.match(/[A-Za-z]{2,}/g) ?? []).filter(word => !["NarraLeaf", "Studio"].includes(word));
}

describe("a language's document that could not be read", () => {
    afterEach(() => {
        i18nStore.setLocale("en");
    });

    it("is said by the language's name and why, in the interface's language", async () => {
        for (const locale of ["zh", "ja"] as const) {
            i18nStore.setLocale(locale);
            for (const answer of [{ error: FsRejectErrorCode.PERMISSION_DENIED }, { text: "{ not json" }] as ReadAnswer[]) {
                for (const error of [await failedTranslations(answer), await failedVoice(answer)]) {
                    expect(error.message).toContain("日本語");
                    expect(error.message).not.toMatch(LEAKS);
                    expect(strayLatin(error.message)).toEqual([]);
                }
            }
        }
    });

    it("names the reason an author can act on", async () => {
        i18nStore.setLocale("en");
        expect((await failedTranslations({ error: FsRejectErrorCode.PERMISSION_DENIED })).message)
            .toBe("The translations for 日本語 could not be read. Studio is not allowed to read its file.");
        expect((await failedVoice({ text: "{ not json" })).message)
            .toBe("The voice assignments for 日本語 could not be read. Its file is damaged or is not in a format Studio can open.");
        expect((await failedTranslations({ text: JSON.stringify({ schemaVersion: 999, locale: "ja", units: {} }) })).message)
            .toBe("The translations for 日本語 could not be read. Its file was saved by a newer version of NarraLeaf Studio.");
    });

    it("stays quiet in the panel when the save-status surface has just said so", async () => {
        // One read, one notice: the corrupt file's sticky notice went up on this call, so the panel
        // that asked shows nothing more (`UIService.showError` reads the mark).
        expect(isReportedToAuthor(await failedTranslations({ text: "{ not json" }, true))).toBe(true);
        expect(isReportedToAuthor(await failedVoice({ text: "{ not json" }, true))).toBe(true);
        // Already up from an earlier read, or a failure that surface does not report: the panel is
        // the one to say it.
        expect(isReportedToAuthor(await failedTranslations({ text: "{ not json" }, false))).toBe(false);
        expect(isReportedToAuthor(await failedTranslations({ error: FsRejectErrorCode.PERMISSION_DENIED }, true))).toBe(false);
    });
});
