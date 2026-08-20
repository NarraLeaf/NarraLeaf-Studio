import { createHash } from "crypto";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { gzipSync } from "zlib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SPELLCHECK_OFF } from "@shared/types/spellcheck";
import { DictionaryCache } from "./dictionaryCache";
import { fetchDictionaryIndex, normalizeDictionaryEntry } from "./dictionaryRegistryClient";
import { SpellcheckManager } from "./spellcheckManager";

const INDEX_URL = "https://registry.example.com/index.json";
const DOWNLOAD_URL = "https://cdn.example.com/en-GB.txt.gz";

const WORDS = ["the", "quick", "brown", "fox", "met", "receive", "colour", "Elysia"].join("\n") + "\n";
const PACKED = gzipSync(Buffer.from(WORDS, "utf-8"));
const DIGEST = createHash("sha256").update(PACKED).digest("hex");

function entry(overrides: Record<string, unknown> = {}) {
    return {
        code: "en-GB",
        name: "English (United Kingdom)",
        bytes: PACKED.byteLength,
        license: "MIT",
        sha256: DIGEST,
        download: DOWNLOAD_URL,
        ...overrides,
    };
}

function indexJson(entries: unknown[]): string {
    return JSON.stringify({ formatVersion: 1, repository: "https://example.com", dictionaries: entries });
}

describe("dictionary index validation", () => {
    it("keeps a well-formed entry", () => {
        expect(normalizeDictionaryEntry(entry())).toMatchObject({
            code: "en-GB",
            license: "MIT",
            sha256: DIGEST,
            download: DOWNLOAD_URL,
        });
    });

    it("refuses a download that is not https", () => {
        // The whole point of the check: a hostile index must not be able to make Studio "download"
        // something off the author's own disk, or carry the bytes itself in a data: URL.
        expect(normalizeDictionaryEntry(entry({ download: "file:///C:/Windows/win.ini" }))).toBeNull();
        expect(normalizeDictionaryEntry(entry({ download: "http://cdn.example.com/en-GB.txt.gz" }))).toBeNull();
        expect(normalizeDictionaryEntry(entry({ download: "data:text/plain,the" }))).toBeNull();
    });

    it("refuses an entry whose checksum is not a sha256", () => {
        expect(normalizeDictionaryEntry(entry({ sha256: "nope" }))).toBeNull();
        expect(normalizeDictionaryEntry(entry({ sha256: DIGEST.slice(0, 63) }))).toBeNull();
        expect(normalizeDictionaryEntry(entry({ sha256: undefined }))).toBeNull();
    });

    it("refuses an entry with no licence, and one whose code could be a path", () => {
        expect(normalizeDictionaryEntry(entry({ license: "" }))).toBeNull();
        expect(normalizeDictionaryEntry(entry({ code: "../../evil" }))).toBeNull();
        expect(normalizeDictionaryEntry(entry({ code: "en/GB" }))).toBeNull();
    });

    it("drops one bad record without blanking the registry", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => new Response(
            indexJson([entry({ code: "en-GB" }), entry({ code: "de", download: "http://x/de.gz" })]),
            { status: 200 },
        )));
        const index = await fetchDictionaryIndex(INDEX_URL);
        expect(index.dictionaries.map(record => record.code)).toEqual(["en-GB"]);
        vi.unstubAllGlobals();
    });

    it("refuses an index of a format version it does not know", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => new Response(
            JSON.stringify({ formatVersion: 99, dictionaries: [entry()] }),
            { status: 200 },
        )));
        await expect(fetchDictionaryIndex(INDEX_URL)).rejects.toThrow(/format version/);
        vi.unstubAllGlobals();
    });
});

describe("SpellcheckManager", () => {
    let userDataDir: string;
    let setting: string | undefined;
    let indexBody: string;
    let payload: Buffer;

    /** A stand-in for the window a request came from - the manager only uses it as a key. */
    const windowA = {};
    const windowB = {};

    function manager(): SpellcheckManager {
        return new SpellcheckManager({
            userDataDir: () => userDataDir,
            readSetting: () => setting,
            readRegistryUrl: () => INDEX_URL,
        });
    }

    beforeEach(async () => {
        userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "nls-spellcheck-"));
        setting = undefined;
        indexBody = indexJson([entry()]);
        payload = PACKED;
        vi.stubGlobal("fetch", vi.fn(async (url: string) => (
            url === DOWNLOAD_URL
                ? new Response(new Uint8Array(payload), { status: 200 })
                : new Response(indexBody, { status: 200 })
        )));
    });

    afterEach(async () => {
        vi.unstubAllGlobals();
        await fs.rm(userDataDir, { recursive: true, force: true });
    });

    function cacheDir(): string {
        return path.join(userDataDir, "cache", "spellcheck-dictionaries");
    }

    it("downloads into the cache, then checks and suggests from it", async () => {
        const spellcheck = manager();

        expect(await spellcheck.listInstalled()).toEqual({ languages: [] });
        expect(await spellcheck.download("en-GB")).toEqual({ ok: true });

        // The whole round trip: what went to disk is what comes back off it.
        expect(await fs.readdir(cacheDir())).toEqual(expect.arrayContaining(["en-GB.json", "en-GB.txt.gz"]));
        const installed = await spellcheck.listInstalled();
        expect(installed.languages).toEqual([
            { code: "en-GB", name: "English (United Kingdom)", bytes: PACKED.byteLength },
        ]);

        const { ranges } = await spellcheck.check(windowA, "the quick brwn fox", "en-GB");
        expect(ranges).toEqual([{ start: 10, end: 14, word: "brwn" }]);
        expect((await spellcheck.suggest("brwn", "en-GB")).suggestions).toContain("brown");
    });

    it("keeps nothing when the bytes do not match the published checksum", async () => {
        payload = gzipSync(Buffer.from("something else entirely\n", "utf-8"));
        const spellcheck = manager();

        await expect(spellcheck.download("en-GB")).rejects.toThrow(/checksum/);
        // Nothing lands: a file that failed its digest must not be readable as an installed
        // dictionary on the next run.
        expect(await fs.readdir(cacheDir()).catch(() => [])).toEqual([]);
        expect((await spellcheck.listInstalled()).languages).toEqual([]);
    });

    it("refuses to download a code the registry does not offer", async () => {
        await expect(manager().download("xx")).rejects.toThrow(/no entry/);
    });

    it("removes a dictionary, and stops checking against it", async () => {
        const spellcheck = manager();
        await spellcheck.download("en-GB");
        expect((await spellcheck.check(windowA, "brwn", "en-GB")).ranges).toHaveLength(1);

        expect(await spellcheck.remove("en-GB")).toEqual({ ok: true });
        expect((await spellcheck.listInstalled()).languages).toEqual([]);
        // No dictionary means nothing is marked, rather than everything.
        expect((await spellcheck.check(windowA, "brwn", "en-GB")).ranges).toEqual([]);
        expect(await spellcheck.remove("en-GB")).toEqual({ ok: false });
    });

    it("does not mark a word the project dictionary holds", async () => {
        const spellcheck = manager();
        await spellcheck.download("en-GB");

        const text = "Aleth met Brannoc";
        expect((await spellcheck.check(windowA, text, "en-GB")).ranges.map(range => range.word))
            .toEqual(["Aleth", "Brannoc"]);

        await spellcheck.configure(windowA, { sourceLocale: "en-GB", words: ["Aleth", "Brannoc"] });
        expect((await spellcheck.check(windowA, text, "en-GB")).ranges).toEqual([]);

        // Case-insensitively, because a name at the start of a sentence is the same name.
        expect((await spellcheck.check(windowA, "aleth", "en-GB")).ranges).toEqual([]);
    });

    it("holds one project's words against one window only", async () => {
        const spellcheck = manager();
        await spellcheck.download("en-GB");
        await spellcheck.configure(windowA, { sourceLocale: "en-GB", words: ["Brannoc"] });

        // Two projects open at once. The previous implementation pushed both into one shared
        // Electron session, so this second window would have silently accepted the first's cast.
        expect((await spellcheck.check(windowB, "Brannoc", "en-GB")).ranges).toHaveLength(1);
        expect((await spellcheck.check(windowA, "Brannoc", "en-GB")).ranges).toEqual([]);

        spellcheck.clear(windowA);
        expect((await spellcheck.check(windowA, "Brannoc", "en-GB")).ranges).toHaveLength(1);
    });

    it("reports the language it settled on, and none when the author turned it off", async () => {
        const spellcheck = manager();
        await spellcheck.download("en-GB");

        const following = await spellcheck.configure(windowA, { sourceLocale: "en", words: [] });
        // `en` is not installed exactly; the regional English is, and is what a bare tag resolves to.
        expect(following).toMatchObject({ language: "en-GB", available: ["en-GB"], setting: "project" });

        setting = SPELLCHECK_OFF;
        expect((await spellcheck.getStatus()).language).toBeNull();
    });

    it("sees a dictionary that arrived after the last configure", async () => {
        const spellcheck = manager();
        expect((await spellcheck.configure(windowA, { sourceLocale: "en-GB", words: [] })).language).toBeNull();

        await spellcheck.download("en-GB");
        // The Settings window is exactly where a download happens, so a status answered from a
        // stored snapshot would still say "no dictionary" straight after installing one.
        expect((await spellcheck.getStatus()).language).toBe("en-GB");
    });
});

/**
 * The same manager, against a language that does not separate its words.
 *
 * Nothing about the delivery changes here - the same index, the same gzipped list, the same cache -
 * so what these tests are about is the one thing that does: the list is what finds the word, not
 * only what judges it.
 */
describe("SpellcheckManager in Chinese and Japanese", () => {
    const ZH_WORDS = ["今天", "天气", "很好", "喜欢", "学校", "天", "好", "很"].join("\n") + "\n";
    const JA_WORDS = ["今日", "天気", "学校", "食べる", "食べ", "私"].join("\n") + "\n";
    const ZH_PACKED = gzipSync(Buffer.from(ZH_WORDS, "utf-8"));
    const JA_PACKED = gzipSync(Buffer.from(JA_WORDS, "utf-8"));
    const ZH_DOWNLOAD = "https://cdn.example.com/zh.txt.gz";
    const JA_DOWNLOAD = "https://cdn.example.com/ja.txt.gz";

    let userDataDir: string;
    const window = {};

    function manager(): SpellcheckManager {
        return new SpellcheckManager({
            userDataDir: () => userDataDir,
            readSetting: () => undefined,
            readRegistryUrl: () => INDEX_URL,
        });
    }

    beforeEach(async () => {
        userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "nls-spellcheck-cjk-"));
        const body = indexJson([
            entry({
                code: "zh",
                name: "Chinese",
                bytes: ZH_PACKED.byteLength,
                sha256: createHash("sha256").update(ZH_PACKED).digest("hex"),
                download: ZH_DOWNLOAD,
            }),
            entry({
                code: "ja",
                name: "Japanese",
                bytes: JA_PACKED.byteLength,
                sha256: createHash("sha256").update(JA_PACKED).digest("hex"),
                download: JA_DOWNLOAD,
            }),
        ]);
        vi.stubGlobal("fetch", vi.fn(async (url: string) => {
            if (url === ZH_DOWNLOAD) {
                return new Response(new Uint8Array(ZH_PACKED), { status: 200 });
            }
            if (url === JA_DOWNLOAD) {
                return new Response(new Uint8Array(JA_PACKED), { status: 200 });
            }
            return new Response(body, { status: 200 });
        }));
    });

    afterEach(async () => {
        vi.unstubAllGlobals();
        await fs.rm(userDataDir, { recursive: true, force: true });
    });

    it("marks nothing in a sentence made of words", async () => {
        const spellcheck = manager();
        await spellcheck.download("zh");

        expect((await spellcheck.check(window, "今天天气很好", "zh")).ranges).toEqual([]);
    });

    it("marks the stretch a mistype leaves behind", async () => {
        const spellcheck = manager();
        await spellcheck.download("zh");

        // 汽 for 气. Neither character is unknown; the finding is that they stand together with
        // nothing joining them, which is not how the line would have been written.
        expect((await spellcheck.check(window, "今天天汽很好", "zh")).ranges).toEqual([
            { start: 2, end: 4, word: "天汽" },
        ]);
    });

    it("marks a name once, then stops when the project has been taught it", async () => {
        const spellcheck = manager();
        await spellcheck.download("zh");

        const text = "艾莉西亚喜欢学校";
        expect((await spellcheck.check(window, text, "zh")).ranges).toEqual([
            { start: 0, end: 4, word: "艾莉西亚" },
        ]);

        // The project's own words are part of the vocabulary the line is cut against, not a filter
        // applied afterwards: the name has to be cut out whole, or what remains is marked instead.
        await spellcheck.configure(window, { sourceLocale: "zh", words: ["艾莉西亚"] });
        expect((await spellcheck.check(window, text, "zh")).ranges).toEqual([]);
    });

    it("leaves a conjugated verb alone, and marks the kanji run that is not a word", async () => {
        const spellcheck = manager();
        await spellcheck.download("ja");

        expect((await spellcheck.check(window, "今日は学校で食べる", "ja")).ranges).toEqual([]);
        // The list holds the stem; the inflection that follows the kanji is not a spelling it can
        // rule on and is not marked.
        expect((await spellcheck.check(window, "今日は食べます", "ja")).ranges).toEqual([]);
        // 汽 for 気, between two particles.
        expect((await spellcheck.check(window, "今日は天汽です", "ja")).ranges).toEqual([
            { start: 3, end: 5, word: "天汽" },
        ]);
    });

    it("offers no replacements for a run in a script without spaces", async () => {
        const spellcheck = manager();
        await spellcheck.download("zh");

        // What the author wants back for a mistyped character is a homophone or a lookalike, and a
        // word list holds neither relation. An empty answer beats an arbitrary one.
        expect((await spellcheck.suggest("汽", "zh")).suggestions).toEqual([]);
        expect((await spellcheck.suggest("艾莉西亚", "zh")).suggestions).toEqual([]);
    });
});

describe("DictionaryCache", () => {
    let userDataDir: string;

    beforeEach(async () => {
        userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "nls-dict-cache-"));
    });

    afterEach(async () => {
        await fs.rm(userDataDir, { recursive: true, force: true });
    });

    it("round-trips the words it was given", async () => {
        const cache = new DictionaryCache(userDataDir);
        await cache.write(entry(), PACKED);

        expect(await cache.readWords("en-GB")).toBe(WORDS);
        expect(await cache.readManifest("en-GB")).toMatchObject({
            code: "en-GB",
            license: "MIT",
            sha256: DIGEST,
            source: DOWNLOAD_URL,
        });
    });

    it("answers nothing for a language it does not have", async () => {
        const cache = new DictionaryCache(userDataDir);
        expect(await cache.readWords("de")).toBeNull();
        expect(await cache.listInstalled()).toEqual([]);
    });

    it("will not let a code escape its own directory", async () => {
        const cache = new DictionaryCache(userDataDir);
        await expect(cache.write(entry({ code: "../escape" }), PACKED)).rejects.toThrow(/filename/);
        expect(await cache.readWords("../escape")).toBeNull();
    });

    it("does not offer a language whose word list never arrived", async () => {
        const cache = new DictionaryCache(userDataDir);
        await cache.write(entry(), PACKED);
        // What an interrupted download leaves behind. A manifest alone describes nothing that can
        // be checked against.
        await fs.rm(path.join(cache.directory(), "en-GB.txt.gz"));
        expect(await cache.listInstalled()).toEqual([]);
    });
});
