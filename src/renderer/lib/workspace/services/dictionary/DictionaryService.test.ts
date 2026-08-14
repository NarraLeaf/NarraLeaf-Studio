import { beforeEach, describe, expect, it, vi } from "vitest";
import { FsRejectErrorCode, type FsRequestResult } from "@shared/types/os";
import { join } from "@shared/utils/path";
import { PROJECT_DICTIONARY_SCHEMA_VERSION } from "@shared/types/dictionary";
import { SPELLCHECK_FOLLOW_PROJECT, SPELLCHECK_LANGUAGE_KEY } from "@shared/types/spellcheck";
import { Services, type WorkspaceContext } from "../services";
import { DictionaryService } from "./DictionaryService";

/**
 * The renderer end of the project dictionary: the document, and the pushes that keep the session in
 * step with it.
 *
 * The pushes are half the feature and the half that can fail invisibly. Chromium's custom dictionary
 * lives in the Electron profile, so it outlives the project: a service that loaded words and never
 * handed them back would leave one project's cast accepted in the next, with no error, no log line,
 * and no symptom other than words that stop being flagged.
 */

/** Every call the service made to the main process, in order. */
type SessionCall =
    | { kind: "configure"; sourceLocale: string; words: string[] }
    | { kind: "clear" };

let sessionCalls: SessionCall[] = [];
/** The global-state listener the service installed, so a test can play the Settings window. */
let settingListener: ((change: { key: string; value: unknown }) => void) | null = null;
let settingListenerCancelled = false;

vi.mock("@/lib/app/bridge", () => ({
    getInterface: () => ({
        app: {
            spellcheck: {
                configure: async (sourceLocale: string, words: string[]) => {
                    sessionCalls.push({ kind: "configure", sourceLocale, words });
                    return {
                        success: true as const,
                        data: {
                            sourceLocale,
                            setting: SPELLCHECK_FOLLOW_PROJECT,
                            language: sourceLocale === "en-GB" ? "en-GB" : null,
                            available: ["en-GB", "en-US"],
                        },
                    };
                },
                clear: async () => {
                    sessionCalls.push({ kind: "clear" });
                    return { success: true as const, data: undefined };
                },
            },
            state: {
                onGlobalStateChanged: (handler: (change: { key: string; value: unknown }) => void) => {
                    settingListener = handler;
                    return {
                        cancel: () => {
                            settingListenerCancelled = true;
                            settingListener = null;
                        },
                    };
                },
            },
        },
    }),
    getPrivilegedInterface: () => ({}),
}));

const ROOT = join("D:/projects", "my-game");
const OTHER_ROOT = join("D:/projects", "other-game");
const documentPath = (root: string) => join(root, "editor", "dictionary.json");

type Harness = {
    service: DictionaryService;
    ctx: WorkspaceContext;
    files: Map<string, string>;
    unreadable: ReturnType<typeof vi.fn>;
};

type HarnessOptions = {
    /** Re-init the same singleton against a fresh project, the way a project switch does. */
    reuse?: DictionaryService;
    root?: string;
    sourceLocale?: string;
    files?: Map<string, string>;
};

async function createHarness(seed?: string, options?: HarnessOptions): Promise<Harness> {
    const root = options?.root ?? ROOT;
    const files = options?.files ?? new Map<string, string>();
    if (seed !== undefined) {
        files.set(documentPath(root), seed);
    }
    const unreadable = vi.fn();

    const ok = <T,>(data: T): FsRequestResult<T> => ({ ok: true, data });
    const stubs: Record<string, unknown> = {
        [Services.FileSystem]: {
            read: async (path: string) => {
                const value = files.get(path);
                return value === undefined
                    ? { ok: false, error: { code: FsRejectErrorCode.NOT_FOUND, message: "missing" } }
                    : ok(value);
            },
            write: async (path: string, data: string) => {
                files.set(path, data);
                return ok(undefined);
            },
            createDir: async () => ok(undefined),
            copyFile: async (src: string, dest: string) => {
                files.set(dest, files.get(src) ?? "");
                return ok(undefined);
            },
        },
        [Services.Project]: {},
        [Services.Localization]: {
            getConfiguration: () => ({ sourceLocale: options?.sourceLocale ?? "en-GB", locales: [] }),
            onConfigChanged: () => () => undefined,
        },
        [Services.SaveStatus]: { register: () => undefined, reportUnreadableDocument: unreadable },
    };

    const ctx = {
        project: { getConfig: () => ({ projectPath: root }) },
        services: {
            get: (id: string) => {
                const stub = stubs[id];
                if (!stub) {
                    throw new Error(`Service ${id} not found`);
                }
                return stub;
            },
        },
    } as unknown as WorkspaceContext;

    const service = options?.reuse ?? new DictionaryService();
    await service.initialize(ctx, async () => undefined);

    return { service, ctx, files, unreadable };
}

const configures = (): SessionCall[] => sessionCalls.filter(call => call.kind === "configure");

beforeEach(() => {
    sessionCalls = [];
    settingListener = null;
    settingListenerCancelled = false;
});

describe("the dictionary document", () => {
    it("starts empty and writes nothing until there is a word", async () => {
        const { service, files } = await createHarness();

        expect(service.listWords()).toEqual([]);
        // Unlike the palette and the variable registry, which seed content every project has. A file
        // holding an empty list would appear in the first commit of every project ever made and say
        // nothing at all.
        expect(files.has(documentPath(ROOT))).toBe(false);

        service.addWord("Anyo");
        await service.flushPendingChanges();

        expect(files.has(documentPath(ROOT))).toBe(true);
        expect(JSON.parse(files.get(documentPath(ROOT))!)).toStrictEqual({
            schemaVersion: PROJECT_DICTIONARY_SCHEMA_VERSION,
            words: ["Anyo"],
        });
    });

    it("reads back what a previous session wrote", async () => {
        const { service } = await createHarness(
            JSON.stringify({ schemaVersion: 1, words: ["Kamurocho", "Anyo"] }),
        );

        expect(service.listWords()).toEqual(["Anyo", "Kamurocho"]);
        expect(service.hasWord("Anyo")).toBe(true);
    });

    it("refuses to add a blank or a word it already holds, and says so", async () => {
        const { service } = await createHarness();

        expect(service.addWord("Anyo")).toBe(true);
        expect(service.addWord(" Anyo ")).toBe(false);
        expect(service.addWord("   ")).toBe(false);
        expect(service.listWords()).toEqual(["Anyo"]);
    });

    it("forgets a word, and reports a word it never held", async () => {
        const { service } = await createHarness(JSON.stringify({ schemaVersion: 1, words: ["Anyo"] }));

        expect(service.removeWord("Anyo")).toBe(true);
        expect(service.removeWord("Anyo")).toBe(false);
        expect(service.listWords()).toEqual([]);
    });

    it("refuses to write over a file it could not read", async () => {
        const { service, unreadable } = await createHarness("{ not json");

        expect(unreadable).toHaveBeenCalled();
        // The in-memory list is empty, and writing that back would turn "unreadable" into "every
        // term the project had is gone".
        await expect(service.save(service.getDocument())).rejects.toThrow(/Refusing to write/);
    });
});

describe("the session the words are pushed into", () => {
    it("pushes the project's language and words as the project opens", async () => {
        await createHarness(JSON.stringify({ schemaVersion: 1, words: ["Anyo"] }));

        expect(configures()).toEqual([{ kind: "configure", sourceLocale: "en-GB", words: ["Anyo"] }]);
    });

    it("pushes again on every edit, so a word is usable the moment it is added", async () => {
        const { service } = await createHarness();

        service.addWord("Kamurocho");
        await service.flushPendingChanges();

        expect(configures().at(-1)).toEqual({
            kind: "configure",
            sourceLocale: "en-GB",
            words: ["Kamurocho"],
        });
    });

    it("clears the session and loads the next project's words on a project switch", async () => {
        const { service } = await createHarness(JSON.stringify({ schemaVersion: 1, words: ["Anyo"] }));

        // Re-initialising the same singleton against a second project is exactly what a project
        // switch does; `Service.initializeFresh` disposes the previous context first.
        await createHarness(JSON.stringify({ schemaVersion: 1, words: ["Wilhelmina"] }), {
            reuse: service,
            root: OTHER_ROOT,
            sourceLocale: "en-US",
        });

        expect(sessionCalls).toEqual([
            { kind: "configure", sourceLocale: "en-GB", words: ["Anyo"] },
            { kind: "clear" },
            { kind: "configure", sourceLocale: "en-US", words: ["Wilhelmina"] },
        ]);
        expect(service.listWords()).toEqual(["Wilhelmina"]);
    });

    it("clears the session and drops its listeners when the project closes", async () => {
        const { service, ctx } = await createHarness(JSON.stringify({ schemaVersion: 1, words: ["Anyo"] }));

        await service.teardown(ctx);

        expect(sessionCalls.at(-1)).toEqual({ kind: "clear" });
        expect(settingListenerCancelled).toBe(true);
    });

    it("re-pushes when the author changes the language in Settings", async () => {
        await createHarness(JSON.stringify({ schemaVersion: 1, words: ["Anyo"] }));

        // The setting is global and edited in another window, so it arrives as a broadcast. Without
        // this the author would change the language and see no difference until reopening.
        settingListener?.({ key: "ui.themeMode", value: "dark" });
        expect(configures()).toHaveLength(1);

        settingListener?.({ key: SPELLCHECK_LANGUAGE_KEY, value: "en-US" });
        await Promise.resolve();

        expect(configures()).toHaveLength(2);
    });

    it("keeps what the session settled on, so the language is knowable without asking again", async () => {
        const { service } = await createHarness();

        expect(service.getSpellcheckStatus()?.language).toBe("en-GB");
    });
});
