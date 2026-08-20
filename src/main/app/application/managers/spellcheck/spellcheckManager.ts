import {
    resolveSpellcheckLanguage,
    SPELLCHECK_LANGUAGE_DEFAULT,
    SPELLCHECK_MAX_SUGGESTIONS,
    type AvailableSpellcheckDictionary,
    type InstalledSpellcheckDictionary,
    type SpellcheckRange,
    type SpellcheckStatus,
} from "@shared/types/spellcheck";
import { DictionaryCache } from "./dictionaryCache";
import {
    downloadDictionary,
    fetchDictionaryIndex,
    resolveDictionaryRegistryUrl,
} from "./dictionaryRegistryClient";
import { containsSegmentedScript, extractWords, type SegmentationLexicon } from "./tokenizer";
import { WordList } from "./wordList";

/** How the manager reads the author's stored language choice. `App`'s global state, in production. */
export type SpellcheckSettingReader = () => string | undefined;

/**
 * How it reads the configured registry URL. Empty or absent means the official index.
 *
 * Nothing configures one today, and there is deliberately no settings row for it: an author behind
 * a national firewall is already served by the download rewrite table, which is the mechanism that
 * can move both the index and the per-entry download - a source setting could only move the index,
 * leaving every download pointed at the original host. The hook is here because the registry client
 * takes the value through `resolveDownloadSource` either way, and because tests need to name one.
 */
export type SpellcheckRegistryReader = () => string | undefined;

export type SpellcheckManagerOptions = {
    userDataDir: () => string;
    readSetting: SpellcheckSettingReader;
    readRegistryUrl?: SpellcheckRegistryReader;
};

/**
 * The words one project spells on purpose, and the language its script is written in.
 *
 * Held per window rather than per application, which is the whole reason it is a separate record.
 * Studio opens one window per project; the previous implementation pushed the words into Electron's
 * shared session, so with two projects open the later one's cast silently replaced the earlier
 * one's and a name from the other project was marked wrong. Nothing is shared here, so nothing can.
 */
type ProjectContext = {
    sourceLocale: string;
    /** Lower-cased, because that is the only form {@link SpellcheckManager.check} compares against. */
    words: Set<string>;
    /**
     * Length of the longest word in the set.
     *
     * Kept because the segmenter of a script without spaces has to reach at least this far to find
     * one: a four-character name the author taught the project is only cut on if the segmenter
     * looks four characters ahead, and a name it does not cut on stays marked however many times
     * the author adds it.
     */
    maxWordLength: number;
};

/** How many languages stay parsed in memory at once. */
const MAX_RESIDENT_LANGUAGES = 3;

/**
 * Studio's own spellchecker.
 *
 * It replaces Chromium's, which was doing the job well enough and fetching its `.bdic` packs from
 * Google's servers to do it - a remote read that never passed through the main process, in a
 * codebase whose rule is that every remote byte does. Studio now names the index it reads, checks
 * what comes back against a published digest, and keeps the result in a cache the author can see
 * and clear.
 *
 * Three things about the arrangement are worth knowing before changing anything here.
 *
 * **Checking runs in main because the renderer has nowhere to run it.** The window's document is
 * `file://` while its scripts are `app://`, so a Web Worker cannot be started at all - the same
 * constraint that makes the Monaco integration worker-free - and checking a scene on every
 * keystroke on the renderer's own thread is a stutter the author feels. So the renderer sends text
 * and gets back offsets.
 *
 * **The project's words arrive from the renderer and are keyed to the window that sent them.** The
 * dictionary document belongs to the workspace, which owns the project; `DictionaryService` sends
 * the list on load and after every edit, and {@link clear} takes it back when the project closes.
 *
 * **A language with no dictionary installed marks nothing.** That is the honest answer rather than
 * a failure, and it is what the settings row states.
 *
 * **Chinese and Japanese are checked by segmentation.** Their dictionaries are word lists in the
 * same format as every other, and the difference is where the word comes from: with no spaces to
 * find one by, the vocabulary itself decides where a word ends, so {@link check} hands the tokenizer
 * a lexicon and gets back both the words it cut and the runs it could not cut into any. What is
 * caught is a run of characters that segments into no known word - a mistyped character, and the
 * non-word left behind by it. What is not caught is a mistyped character that happens to spell
 * another legitimate word, 的 for 地 among many others, which needs the surrounding sentence rather
 * than a vocabulary.
 */
export class SpellcheckManager {
    private readonly options: SpellcheckManagerOptions;
    /**
     * Built on first use, not in the constructor.
     *
     * `App` constructs this manager before Electron is ready, and `app.getPath("userData")` has no
     * answer until it is - the same reason the previous implementation resolved its session through
     * a function rather than capturing it.
     */
    private cacheInstance: DictionaryCache | null = null;
    /**
     * The project each window is working on.
     *
     * Weak, so a window that closes without its workspace calling {@link clear} - a crash, a
     * `destroy()` - takes its words with it rather than leaving a list nothing will ever collect.
     */
    private readonly projects = new WeakMap<object, ProjectContext>();
    /** Parsed word lists, by language code. Bounded: a list is tens of megabytes once expanded. */
    private readonly loaded = new Map<string, WordList>();
    /** In-flight loads, so a burst of `check` calls on one language parses the file once. */
    private readonly loading = new Map<string, Promise<WordList | null>>();
    private status: SpellcheckStatus = {
        sourceLocale: "",
        setting: SPELLCHECK_LANGUAGE_DEFAULT,
        language: null,
        available: [],
    };

    constructor(options: SpellcheckManagerOptions) {
        this.options = options;
    }

    private get cache(): DictionaryCache {
        if (!this.cacheInstance) {
            this.cacheInstance = new DictionaryCache(this.options.userDataDir());
        }
        return this.cacheInstance;
    }

    /**
     * Take one window's project: the language of its script, and the words it spells on purpose.
     *
     * Idempotent and cheap to call again - the workspace calls it on load, on every dictionary edit
     * and whenever the setting changes, and re-sending the same list only replaces a set.
     */
    public async configure(
        owner: object,
        input: { sourceLocale: string; words: readonly string[] },
    ): Promise<SpellcheckStatus> {
        const words = new Set(input.words.map(word => word.toLowerCase()));
        let maxWordLength = 0;
        for (const word of words) {
            if (word.length > maxWordLength) {
                maxWordLength = word.length;
            }
        }
        this.projects.set(owner, { sourceLocale: input.sourceLocale, words, maxWordLength });
        this.status = await this.buildStatus(input.sourceLocale);
        return this.status;
    }

    /** Forget one window's project. Called when a workspace closes or switches project. */
    public clear(owner: object): void {
        this.projects.delete(owner);
    }

    /**
     * What spellchecking is doing now.
     *
     * Read by the Settings window, which has no project and therefore no way to work this out for
     * itself. Before any project has configured anything it reports the empty state, whose
     * `sourceLocale` of `""` is what makes `projectLanguageHasNoDictionary` answer false - so the
     * settings row states nothing rather than guessing.
     */
    public async getStatus(): Promise<SpellcheckStatus> {
        // Rebuilt rather than returned as stored: a dictionary downloaded since the last configure
        // changes the answer, and the Settings window is exactly where that download happens.
        this.status = await this.buildStatus(this.status.sourceLocale);
        return this.status;
    }

    /**
     * Every misspelling in `text`, as offsets into it.
     *
     * Answers an empty list rather than failing when the language has no dictionary installed:
     * "nothing is marked" is what the author sees either way, and a text field is not a place to
     * report that a download has not happened.
     */
    public async check(owner: object, text: string, language: string): Promise<{ ranges: SpellcheckRange[] }> {
        const list = await this.wordListFor(language);
        if (!list || !text) {
            return { ranges: [] };
        }
        const project = this.projects.get(owner);
        const ranges: SpellcheckRange[] = [];
        for (const candidate of extractWords(text, this.lexiconFor(list, project))) {
            if (list.has(candidate.word)) {
                continue;
            }
            // The project's own vocabulary: character names, places, invented terms. Checked after
            // the dictionary because it is the smaller set and the rarer hit.
            if (project?.words.has(candidate.word.toLowerCase())) {
                continue;
            }
            ranges.push(candidate);
        }
        return { ranges };
    }

    /**
     * Replacements for one word, nearest first. Never more than {@link SPELLCHECK_MAX_SUGGESTIONS}.
     *
     * Nothing is offered for Chinese or Japanese. What an author wants back for a mistyped Han
     * character is the character that sounds like it or looks like it, and neither relation is in a
     * word list - an edit distance over Han answers with entries that merely share a character,
     * which reads as arbitrary rather than as a correction. An empty list is the honest answer and
     * the popover already shows one.
     */
    public async suggest(word: string, language: string): Promise<{ suggestions: string[] }> {
        const list = await this.wordListFor(language);
        if (!list || !word || containsSegmentedScript(word)) {
            return { suggestions: [] };
        }
        return { suggestions: list.suggest(word, SPELLCHECK_MAX_SUGGESTIONS) };
    }

    public async listInstalled(): Promise<{ languages: InstalledSpellcheckDictionary[] }> {
        return { languages: await this.cache.listInstalled() };
    }

    /**
     * What the registry offers.
     *
     * Goes to the network every time. There is no memo here on purpose: the only caller is an
     * author looking at a list of downloads, and a list that answers from a snapshot is a list
     * whose Refresh does nothing.
     */
    public async listAvailable(): Promise<{ entries: AvailableSpellcheckDictionary[] }> {
        const index = await fetchDictionaryIndex(this.registryUrl());
        return {
            entries: index.dictionaries.map(entry => ({
                code: entry.code,
                name: entry.name,
                bytes: entry.bytes,
                license: entry.license,
            })),
        };
    }

    /**
     * Fetch one dictionary into the cache.
     *
     * Author-initiated only. The address comes out of the index rather than from the caller, so a
     * renderer cannot name what is downloaded - it can only name which of the registry's entries.
     */
    public async download(code: string): Promise<{ ok: boolean }> {
        const index = await fetchDictionaryIndex(this.registryUrl());
        const entry = index.dictionaries.find(candidate => candidate.code === code);
        if (!entry) {
            throw new Error(`The dictionary registry has no entry for "${code}"`);
        }
        const compressed = await downloadDictionary(entry);
        await this.cache.write(entry, compressed);
        // A language already parsed is now the wrong bytes. Dropping it means the next check
        // reloads, which is a few milliseconds once rather than a stale list forever.
        this.loaded.delete(entry.code);
        this.loading.delete(entry.code);
        return { ok: true };
    }

    /** Delete one dictionary. `ok: false` means there was nothing installed under that code. */
    public async remove(code: string): Promise<{ ok: boolean }> {
        const removed = await this.cache.remove(code);
        this.loaded.delete(code);
        this.loading.delete(code);
        return { ok: removed };
    }

    /** Where the dictionaries live, for the cache inventory. */
    public cacheDirectory(): string {
        return this.cache.directory();
    }

    private registryUrl(): string {
        return resolveDictionaryRegistryUrl(this.options.readRegistryUrl?.());
    }

    /**
     * The vocabulary the segmenter cuts on: the language's words and the project's own.
     *
     * The two are joined here rather than filtered one after the other, which is the difference
     * between a taught name disappearing and a taught name being cut in half. In a script that
     * separates its words the project's list is a filter - the checker finds `Brannoc`, then
     * forgives it. In one that does not, the list is part of finding the word at all: with
     * `艾莉丝` in it the segmenter cuts the name out whole, and without it the name is reported as
     * whichever of its characters the language's own words failed to cover.
     */
    private lexiconFor(list: WordList, project: ProjectContext | undefined): SegmentationLexicon {
        if (!project) {
            return list;
        }
        const words = project.words;
        return {
            has: word => list.has(word) || words.has(word.toLowerCase()),
            maxWordLength: Math.max(list.maxWordLength, project.maxWordLength),
        };
    }

    private async buildStatus(sourceLocale: string): Promise<SpellcheckStatus> {
        const setting = this.options.readSetting() || SPELLCHECK_LANGUAGE_DEFAULT;
        const available = (await this.cache.listInstalled()).map(entry => entry.code);
        return {
            sourceLocale,
            setting,
            language: resolveSpellcheckLanguage(setting, sourceLocale, available),
            available,
        };
    }

    /**
     * The parsed list for one language, or `null` when it is not installed.
     *
     * Loads are shared through {@link loading} because the first keystroke in a freshly opened
     * scene produces several `check` calls at once, and each one would otherwise gunzip and parse
     * the same file.
     */
    private async wordListFor(language: string): Promise<WordList | null> {
        const code = language.trim();
        if (!code) {
            return null;
        }
        const resident = this.loaded.get(code);
        if (resident) {
            return resident;
        }
        const inFlight = this.loading.get(code);
        if (inFlight) {
            return inFlight;
        }

        const load = this.cache
            .readWords(code)
            .then(text => {
                if (text === null) {
                    return null;
                }
                const list = WordList.fromText(text);
                this.loaded.set(code, list);
                // Oldest first, because a Map iterates in insertion order and the language being
                // typed in was inserted last.
                while (this.loaded.size > MAX_RESIDENT_LANGUAGES) {
                    const oldest = this.loaded.keys().next();
                    if (oldest.done) {
                        break;
                    }
                    this.loaded.delete(oldest.value);
                }
                return list;
            })
            .catch(() => null)
            .finally(() => {
                this.loading.delete(code);
            });

        this.loading.set(code, load);
        return load;
    }
}
