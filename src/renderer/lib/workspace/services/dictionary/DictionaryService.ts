import { loadDocument, saveDocument, type DocumentStorage } from "@shared/documents/documentIo";
import { dictionarySpec } from "@shared/documents/specs";
import type { DocumentCorruptError } from "@shared/documents/types";
import { RendererError } from "@shared/utils/error";
import {
    createEmptyProjectDictionaryDocument,
    normalizeDictionaryWord,
    normalizeDictionaryWords,
    PROJECT_DICTIONARY_SCHEMA_VERSION,
    type ProjectDictionaryDocument,
} from "@shared/types/dictionary";
import { SPELLCHECK_LANGUAGE_KEY, type SpellcheckStatus } from "@shared/types/spellcheck";
import { getInterface } from "@/lib/app/bridge";
import { createProjectDocumentStorage } from "../core/DocumentStorage";
import { FileSystemService } from "../core/FileSystem";
import { ProjectService } from "../core/ProjectService";
import { Service } from "../Service";
import { Services, IDictionaryService, WorkspaceContext } from "../services";
import { DEFAULT_AUTOSAVE_DELAY_MS, DEFAULT_AUTOSAVE_MAX_WAIT_MS, DebouncedSaver } from "../autosave/DebouncedSaver";
import { registerAutoSaver, reportUnreadableDocument } from "../autosave/SaveStatusService";
import { LocalizationService } from "../localization/LocalizationService";
import { EventEmitter } from "../ui/EventEmitter";

type DictionaryServiceEvents = {
    wordsChanged: string[];
    dirtyChanged: boolean;
};

/**
 * The project dictionary. Owns `editor/dictionary.json`.
 *
 * Mirrors {@link BrandService} - one project JSON, seeded from absence, revision + debounced
 * autosave, change events, and the same refuse-to-overwrite latch - because it is the same class of
 * thing: a small project-level list many surfaces read and version control has to see row by row.
 *
 * What it does beyond its siblings is *publish to the session*. Chromium keeps its custom dictionary
 * in the Electron profile, which is one machine's, so the document is only half the feature: every
 * path that changes the list also pushes it to the main process, and {@link dispose} takes it back
 * out again. Without that second half a project's cast would accumulate in the profile and be
 * accepted in every other project opened on the same computer.
 *
 * The language comes from the same push. It is decided in the main process (which is the only place
 * that can see what Chromium has a dictionary for) from two things this service supplies: the
 * project's source locale, and the author's setting - which is why a change to either re-pushes.
 */
export class DictionaryService extends Service<DictionaryService> implements IDictionaryService {
    private document: ProjectDictionaryDocument | null = null;
    /**
     * Set when `editor/dictionary.json` is on disk but could not be parsed, and never cleared until
     * a load succeeds. Everything else carries on - a project with one broken document still has to
     * open - but {@link save} refuses while it is set: the in-memory list is empty, and writing that
     * over the file would turn "unreadable" into "every term the project had is gone".
     */
    private unreadable: DocumentCorruptError | null = null;
    private readonly events = new EventEmitter<DictionaryServiceEvents>();
    private dirty = false;
    private revision = 0;
    private status: SpellcheckStatus | null = null;
    private unsubscribeSourceLocale: (() => void) | null = null;
    private unsubscribeSetting: (() => void) | null = null;
    private readonly autoSaver = new DebouncedSaver({
        delayMs: DEFAULT_AUTOSAVE_DELAY_MS,
        maxWaitMs: DEFAULT_AUTOSAVE_MAX_WAIT_MS,
        save: () => this.save(this.getDocument()),
        onError: err => console.warn("[DictionaryService] auto-save failed", err),
    });

    protected async init(ctx: WorkspaceContext, depend: (services: Service[]) => Promise<void>): Promise<void> {
        const filesystemService = ctx.services.get<FileSystemService>(Services.FileSystem);
        const projectService = ctx.services.get<ProjectService>(Services.Project);
        const localizationService = ctx.services.get<LocalizationService>(Services.Localization);
        await depend([filesystemService, projectService, localizationService]);
        await registerAutoSaver(ctx, depend, "dictionary", "workspace.shell.save.stores.dictionary", this.autoSaver);

        await this.load();

        // The source language is what the checker's language is derived from, and an author can
        // change it in the localization panel at any point.
        this.unsubscribeSourceLocale = localizationService.onConfigChanged(() => void this.publish());
        // The setting is global and is edited in another window, which reaches this one only as a
        // broadcast. Without this the author would change the language in Settings and see no
        // difference until the project was reopened.
        const token = getInterface().app.state.onGlobalStateChanged(change => {
            if (change.key === SPELLCHECK_LANGUAGE_KEY) {
                void this.publish();
            }
        });
        this.unsubscribeSetting = () => token.cancel();
    }

    public async load(): Promise<string[]> {
        const result = await loadDocument(dictionarySpec, this.storage(), dictionarySpec.pathFor());
        // Both cleared before the branch, not inside it: this is a singleton that re-inits on a
        // project switch, and either one carried over would be the previous project speaking for
        // this one - a latch left set makes the next project's first save refuse, and a revision
        // left high is a number this project's subscribers start counting from.
        this.unreadable = null;
        this.revision = 0;

        if (result.status === "missing") {
            // NOT written on first open, unlike the palette and the variable registry. Those seed
            // content every project has; this one starts genuinely empty, and a file holding an
            // empty list would appear in the first commit of every project ever created to say
            // nothing at all. It is written the first time a word is added.
            this.document = createEmptyProjectDictionaryDocument();
        } else if (result.status === "corrupt") {
            // Reported and survived, not thrown: this runs inside `init`, and throwing here is how
            // one unreadable document stops the whole project from opening.
            this.unreadable = result.error;
            this.document = createEmptyProjectDictionaryDocument();
            reportUnreadableDocument(this.getContext(), result);
        } else {
            this.document = result.document;
        }

        this.setDirty(false);
        await this.publish();
        this.events.emit("wordsChanged", this.listWords());
        return this.listWords();
    }

    public async save(document: ProjectDictionaryDocument): Promise<void> {
        if (this.unreadable) {
            throw new RendererError(
                `Refusing to write ${this.unreadable.path}: it is on disk but could not be read `
                + `(${this.unreadable.reason}), so anything written now would replace it with an empty list.`,
            );
        }
        // This write supersedes whatever the timer was going to do.
        this.autoSaver.cancel();
        const updated: ProjectDictionaryDocument = {
            ...document,
            schemaVersion: PROJECT_DICTIONARY_SCHEMA_VERSION,
            words: normalizeDictionaryWords(document.words),
        };
        await saveDocument(dictionarySpec, this.storage(), dictionarySpec.pathFor(), updated);
        this.document = updated;
        this.setDirty(false);
        this.events.emit("wordsChanged", this.listWords());
    }

    public getDocument(): ProjectDictionaryDocument {
        if (!this.document) {
            throw new RendererError("Project dictionary not initialized");
        }
        return this.document;
    }

    /** Every word, sorted. The array is a copy; edit through the mutators. */
    public listWords(): string[] {
        return [...this.getDocument().words];
    }

    public hasWord(word: string): boolean {
        const normalized = normalizeDictionaryWord(word);
        return normalized !== null && this.getDocument().words.includes(normalized);
    }

    /**
     * Teach the project a word. `false` means there was nothing to add - a blank, or a word the
     * project already spells this way.
     */
    public addWord(word: string): boolean {
        const normalized = normalizeDictionaryWord(word);
        if (!normalized || this.hasWord(normalized)) {
            return false;
        }
        this.applyWordMutation(words => [...words, normalized]);
        return true;
    }

    /** Forget a word. `false` means the project never held it. */
    public removeWord(word: string): boolean {
        const normalized = normalizeDictionaryWord(word);
        if (!normalized || !this.hasWord(normalized)) {
            return false;
        }
        this.applyWordMutation(words => words.filter(entry => entry !== normalized));
        return true;
    }

    /** Replace the whole document (history restore). Sets, publishes and emits without touching history. */
    public replaceDocument(document: ProjectDictionaryDocument): void {
        this.document = {
            schemaVersion: PROJECT_DICTIONARY_SCHEMA_VERSION,
            words: normalizeDictionaryWords(document.words),
        };
        this.revision += 1;
        this.setDirty(true);
        this.autoSaver.schedule();
        void this.publish();
        this.events.emit("wordsChanged", this.listWords());
    }

    /** What the spellchecker settled on last time this service pushed. `null` before the first push. */
    public getSpellcheckStatus(): SpellcheckStatus | null {
        return this.status;
    }

    public onWordsChanged(handler: (words: string[]) => void): () => void {
        return this.events.on("wordsChanged", handler);
    }

    public onDirtyChanged(handler: (dirty: boolean) => void): () => void {
        return this.events.on("dirtyChanged", handler);
    }

    public isDirty(): boolean {
        return this.dirty;
    }

    public getRevision(): number {
        return this.revision;
    }

    /** Write out anything the auto-save timer still owes, and wait for it. */
    public async flushPendingChanges(): Promise<void> {
        await this.autoSaver.flush();
    }

    /**
     * Hand the session back an empty dictionary.
     *
     * The words are the project's, and the session that holds them is the machine's, so a project
     * closed without this would leave its cast accepted in whatever opens next - including a
     * different project in a different language, where the names are simply wrong.
     */
    public dispose(): void {
        this.unsubscribeSourceLocale?.();
        this.unsubscribeSourceLocale = null;
        this.unsubscribeSetting?.();
        this.unsubscribeSetting = null;
        this.status = null;
        void getInterface().app.spellcheck.clear();
    }

    /** The single mutation entry - mutate the list, re-normalize, bump, mark dirty, autosave, publish. */
    private applyWordMutation(mutator: (words: string[]) => string[]): void {
        const document = this.getDocument();
        document.words = normalizeDictionaryWords(mutator([...document.words]));
        this.revision += 1;
        this.setDirty(true);
        this.autoSaver.schedule();
        void this.publish();
        this.events.emit("wordsChanged", this.listWords());
    }

    /**
     * Push the language and the words into the session.
     *
     * Not awaited by the mutators: the author has already been given their word back in the
     * document, and making an edit wait on an IPC round trip would put a frame of lag on a right
     * click. A failed push costs one session that is a word behind, which the next push corrects.
     */
    private async publish(): Promise<void> {
        const localizationService = this.getContext().services.get<LocalizationService>(Services.Localization);
        const sourceLocale = localizationService.getConfiguration().sourceLocale;
        const result = await getInterface().app.spellcheck.configure(sourceLocale, this.listWords());
        this.status = result.success ? result.data : null;
    }

    private setDirty(value: boolean): void {
        if (this.dirty === value) {
            return;
        }
        this.dirty = value;
        this.events.emit("dirtyChanged", value);
    }

    private storage(): DocumentStorage {
        return createProjectDocumentStorage(this.getContext());
    }
}
