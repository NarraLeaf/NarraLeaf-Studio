import { afterEach, describe, expect, it, vi } from "vitest";
import type { LocalizationConfiguration } from "@shared/types/localization";
import type { VoiceConfiguration } from "@shared/types/voice";
import { join } from "@shared/utils/path";
import { i18nStore } from "@/lib/i18n";
import { Services, type WorkspaceContext } from "../services";
import { VoiceService } from "../voice/VoiceService";
import { LocalizationService, isSourceLocked } from "./LocalizationService";

/**
 * What the localization and voice panels say when an edit to a language list is refused.
 *
 * Both panels print `error.message` as it is, so the message a service throws is the sentence the
 * author reads - and until these were worded it was the service's English in every interface
 * language: `Language already exists: ja`, `The source language cannot be removed while other
 * languages exist`, `Unknown language: fr`, `fr already falls back to ja, so this would never be used`.
 */

const ROOT = join("D:/projects", "my-game");

const LOCALIZATION: LocalizationConfiguration = {
    sourceLocale: "en",
    locales: [
        { code: "en", displayName: "English" },
        { code: "ja", displayName: "日本語", fallback: "zh-CN" },
        { code: "zh-CN", displayName: "简体中文" },
    ],
};

const VOICE: VoiceConfiguration = {
    voicedLocales: [{ code: "ja", displayName: "日本語" }],
    namingPattern: "{unitId}",
    cast: {},
    voiceChoices: false,
};

function createContext(): WorkspaceContext {
    let localization = LOCALIZATION;
    let voice = VOICE;
    const stubs: Record<string, unknown> = {
        [Services.FileSystem]: {},
        [Services.Project]: {
            getLocalizationConfiguration: () => localization,
            updateLocalizationConfiguration: async (updater: (current: LocalizationConfiguration) => LocalizationConfiguration) => {
                localization = updater(localization);
                return localization;
            },
            getVoiceConfiguration: () => voice,
            updateVoiceConfiguration: async (updater: (current: VoiceConfiguration) => VoiceConfiguration) => {
                voice = updater(voice);
                return voice;
            },
        },
        [Services.SaveStatus]: { register: () => undefined, reportUnreadableDocument: vi.fn() },
        [Services.Localization]: { getDocumentIfLoaded: () => undefined, loadDocument: async () => undefined },
    };
    return {
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
}

async function translations(): Promise<LocalizationService> {
    const service = new LocalizationService();
    await service.initialize(createContext(), async () => undefined);
    return service;
}

async function voice(): Promise<VoiceService> {
    const service = new VoiceService();
    await service.initialize(createContext(), async () => undefined);
    return service;
}

async function refusal(run: () => unknown): Promise<string> {
    try {
        await run();
    } catch (error) {
        return (error as Error).message;
    }
    throw new Error("expected the edit to be refused");
}

/** Every refusal, from a fresh service each time so one does not change the list the next one sees. */
async function everyRefusal(): Promise<string[]> {
    return [
        await refusal(async () => (await translations()).addLocale({ code: "ja", displayName: "Japanese" })),
        await refusal(async () => (await translations()).addLocale({ code: "not a code", displayName: "" })),
        await refusal(async () => (await translations()).removeLocale("en")),
        await refusal(async () => (await translations()).setSourceLocale("fr")),
        await refusal(async () => (await translations()).updateLocaleEntry("fr", { displayName: "Français" })),
        await refusal(async () => (await translations()).updateLocaleEntry("ja", { fallback: "zh-CN-x" })),
        await refusal(async () => (await translations()).updateLocaleEntry("zh-CN", { fallback: "ja" })),
        await refusal(async () => (await translations()).loadDocument("fr")),
        await refusal(async () => (await translations()).setKey("not a key!", { sourceText: "Start" })),
        // The registry never loaded (here: no file system to read it from).
        await refusal(async () => (await translations()).setKey("menu.start", { sourceText: "Start" })),
        await refusal(async () => (await voice()).addLocale({ code: "ja", displayName: "Japanese" })),
        await refusal(async () => (await voice()).loadDocument("fr")),
    ];
}

/** Everything a sentence may not carry: the service's English, a file path, an id. */
const LEAKS = /already exists|Unknown|cannot be removed|falls back|Invalid|Failed|editor\/|\.json|[A-Z]:[\\/]|[0-9a-f]{8}-/;

/** Latin words other than the languages' own names and codes, which the rows show as they are. */
function strayLatin(text: string): string[] {
    const allowed = ["English", "zh", "CN"];
    return (text.match(/[A-Za-z]{2,}/g) ?? []).filter(word => !allowed.includes(word));
}

describe("a refused edit to the language list", () => {
    afterEach(() => {
        i18nStore.setLocale("en");
    });

    it("is said in the interface's language, with nothing of the service's English in it", async () => {
        for (const locale of ["zh", "ja"] as const) {
            i18nStore.setLocale(locale);
            const messages = await everyRefusal();
            expect(messages).toHaveLength(12);
            for (const message of messages) {
                expect(message, message).not.toMatch(LEAKS);
                expect(strayLatin(message), message).toEqual([]);
            }
        }
    });

    it("names a language by the name its row shows", async () => {
        i18nStore.setLocale("zh");
        const [duplicate, , sourceLocked, , , , loop, , , keysUnread, voiceDuplicate] = await everyRefusal();
        // Asked for as "Japanese"; the list already calls it 日本語, and that is the one the author sees.
        expect(duplicate).toBe("日本語 已在语言列表中");
        expect(sourceLocked).toBe("English 是源语言；请先移除其他语言，或将其他语言设为源语言");
        // 简体中文 falling back to 日本語 would go round: 日本語 already falls back to 简体中文.
        expect(loop).toBe("日本語 会绕回 简体中文");
        expect(keysUnread).toBe("无法读取本地化，改动不会保存");
        expect(voiceDuplicate).toBe("日本語 已在配音语言列表中");
    });

    it("reads as English in the English interface", async () => {
        i18nStore.setLocale("en");
        const messages = await everyRefusal();
        expect(messages).toEqual([
            "日本語 is already in the language list.",
            "Language codes may only contain letters, digits, and hyphens.",
            "English is the source language. Remove the other languages first, or set another language as the source language.",
            "This language is no longer in the language list.",
            "This language is no longer in the language list.",
            "The fallback language is no longer in the language list.",
            "日本語 leads back to 简体中文.",
            "This language is no longer in the language list.",
            "Key names may contain letters, digits, and dots/underscores/hyphens between them.",
            "The localization could not be read. Changes are not saved.",
            "日本語 is already in the voice language list.",
            "This voice language is no longer in the list.",
        ]);
    });

    it("tells the panel ahead of time which removal will be refused", () => {
        expect(isSourceLocked(LOCALIZATION, "en")).toBe(true);
        expect(isSourceLocked(LOCALIZATION, "ja")).toBe(false);
        // The last language standing can go, source or not.
        expect(isSourceLocked({ sourceLocale: "en", locales: [{ code: "en", displayName: "English" }] }, "en")).toBe(false);
    });
});
