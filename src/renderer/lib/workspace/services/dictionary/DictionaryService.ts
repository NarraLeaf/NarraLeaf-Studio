import { loadDocument, saveDocument, type DocumentStorage } from "@shared/documents/documentIo";
import { dictionarySpec } from "@shared/documents/specs";
import type { DocumentCorruptError } from "@shared/documents/types";
import { RendererError } from "@shared/utils/error";
import {
    createEmptyProjectDictionaryDocument,
    type DictionaryEntryPatch,
    dictionaryAcceptedWords,
    normalizeDictionaryEntries,
    normalizeDictionaryOptions,
    normalizeDictionaryVariants,
    normalizeDictionaryWord,
    PROJECT_DICTIONARY_SCHEMA_VERSION,
    type ProjectDictionaryDocument,
    type ProjectDictionaryEntry,
    type ProjectDictionaryOptions,
} from "@shared/types/dictionary";
import type { LiveDictionaryOp } from "@shared/live/ops";
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

/**
 * Somewhere a dictionary edit can go instead of into the document.
 *
 * **The seam a live session hangs the dictionary off, and the reason the dictionary panel needs no
 * live-session code.** The shape is `StoryOpSink`'s and the bargain is the same: with a sink
 * installed an edit becomes an operation and the document is not touched; the list moves when the
 * operation comes back as somebody's effect and {@link DictionaryService.applyLiveOp} applies it.
 * Nothing is applied optimistically, so nothing ever has to be taken back.
 *
 * ⚠ **Asked from the mutators rather than from {@link DictionaryService.applyMutation}, which is
 * where every edit really does converge.** That method takes a function over the whole list and can
 * only say "the entries changed" - which is whole-document last-writer-wins, the one verb the
 * session vocabulary refuses. The mutators know what they meant, so that is where they say it. It is
 * `AssetsService.recordChanged`'s answer to the same shape of service.
 */
export type DictionaryOpSink = {
    /**
     * Take one operation, or decline it.
     *
     * True means the sink has it and the document must not be touched. False means this edit is not
     * the sink's business and the caller carries on as usual.
     */
    handle(op: LiveDictionaryOp): boolean;
};

type DictionaryServiceEvents = {
    /** The terms, the readings, the variants or the options moved. Carries the whole list. */
    entriesChanged: ProjectDictionaryEntry[];
    dirtyChanged: boolean;
    statusChanged: SpellcheckStatus | null;
};

/**
 * The project dictionary. Owns `editor/dictionary.json`.
 *
 * Mirrors {@link BrandService} - one project JSON, seeded from absence, revision + debounced
 * autosave, change events, and the same refuse-to-overwrite latch - because it is the same class of
 * thing: a small project-level list many surfaces read and version control has to see row by row.
 *
 * What it does beyond its siblings is *publish to the session*. The spellchecker runs in the main
 * process and is keyed to this window, so every path that changes the list also pushes it, and
 * {@link dispose} takes it back out again. What is pushed is every spelling the checker must leave
 * alone - the terms and their variants - because a variant is a real word written the wrong way for
 * this project, and the dictionary marks it as such itself; having the spellchecker mark it too
 * would read as two problems with one word.
 *
 * The language comes from the same push. It is decided in the main process (which is the only place
 * that can see which dictionaries are installed) from two things this service supplies: the
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
    /** Where dictionary edits go instead of into the document, when something else owns them. */
    private opSink: DictionaryOpSink | null = null;
    private unsubscribeSourceLocale: (() => void) | null = null;
    private unsubscribeSetting: (() => void) | null = null;
    private unsubscribeFocus: (() => void) | null = null;
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

        // The third input is the one this window cannot be told about: which dictionaries are
        // installed on the machine. They are files in a main-process cache, downloaded from the
        // Settings window, and there is no broadcast for them - so a language that resolved to
        // nothing at project open would stay resolved to nothing for the life of the window, however
        // many dictionaries the author fetched in the meantime. Re-published when this window comes
        // back to the front, which is the gesture that follows a download; the push is a set
        // replacement and a directory listing, so paying it per focus is cheaper than being wrong.
        //
        // Guarded, because this service is also exercised outside a document: the whole point of the
        // rest of it is a JSON file and an IPC push, neither of which needs a window.
        const host = globalThis.window;
        if (host) {
            const onFocus = () => void this.publish();
            host.addEventListener("focus", onFocus);
            this.unsubscribeFocus = () => host.removeEventListener("focus", onFocus);
        }
    }

    public async load(): Promise<void> {
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
            // nothing at all. It is written the first time a term is added.
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
        this.events.emit("entriesChanged", this.listEntries());
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
        const updated = this.canonical(document);
        await saveDocument(dictionarySpec, this.storage(), dictionarySpec.pathFor(), updated);
        this.document = updated;
        this.setDirty(false);
        this.events.emit("entriesChanged", this.listEntries());
    }

    public getDocument(): ProjectDictionaryDocument {
        if (!this.document) {
            throw new RendererError("Project dictionary not initialized");
        }
        return this.document;
    }

    /** Every entry, sorted by term. The array is a copy; edit through the mutators. */
    public listEntries(): ProjectDictionaryEntry[] {
        return this.getDocument().entries.map(entry => ({ ...entry }));
    }

    /** Every term, sorted. */
    public listTerms(): string[] {
        return this.getDocument().entries.map(entry => entry.term);
    }

    public getEntry(term: string): ProjectDictionaryEntry | null {
        const normalized = normalizeDictionaryWord(term);
        if (!normalized) {
            return null;
        }
        const entry = this.getDocument().entries.find(candidate => candidate.term === normalized);
        return entry ? { ...entry } : null;
    }

    /** Whether the project writes this term. Exact, and the identity check every mutator uses. */
    public hasTerm(term: string): boolean {
        return this.getEntry(term) !== null;
    }

    /**
     * Whether the spellchecker should leave this word alone: it is a term, or a variant of one.
     *
     * Case-insensitive, because a checker asked about a word at the start of a sentence hands back
     * the capitalised form, and a term is not two terms for being written at a full stop.
     */
    public hasWord(word: string): boolean {
        const normalized = normalizeDictionaryWord(word)?.toLowerCase();
        if (!normalized) {
            return false;
        }
        return this.getDocument().entries.some(entry =>
            entry.term.toLowerCase() === normalized
            || (entry.variants ?? []).some(variant => variant.toLowerCase() === normalized));
    }

    public getOptions(): ProjectDictionaryOptions {
        return { ...this.getDocument().options };
    }

    /**
     * Teach the project a term. `false` means there was nothing to add - a blank, or a spelling the
     * project already holds.
     *
     * The one gesture that reaches here from outside the dictionary panel is "add to dictionary" on
     * a marked word, which knows the spelling and nothing else; the patch is for the panel, which
     * adds a term and its reading in one motion.
     */
    public addTerm(term: string, patch?: Omit<DictionaryEntryPatch, "term">): boolean {
        const normalized = normalizeDictionaryWord(term);
        if (!normalized || this.hasTerm(normalized)) {
            return false;
        }
        const entry = applyPatch({ term: normalized }, patch ?? {});
        // The sink is asked with the entry as it WOULD have been written, never with the patch: a
        // patch states an intention and every machine would resolve it against its own copy. See
        // {@link DictionaryOpSink}.
        if (this.opSink?.handle({ op: "set-dictionary-entry", term: normalized, entry })) {
            return true;
        }
        this.applyMutation(entries => [...entries, entry]);
        return true;
    }

    /**
     * Edit one entry. `false` means there is no such term, or the rename would collide with a term
     * the project already writes.
     *
     * A collision is refused rather than merged: the two entries have their own readings, variants
     * and notes, and picking which of each survives is a decision the author has not made.
     */
    public updateEntry(term: string, patch: DictionaryEntryPatch): boolean {
        const existing = this.getEntry(term);
        if (!existing) {
            return false;
        }
        const renamed = patch.term === undefined ? null : normalizeDictionaryWord(patch.term);
        if (patch.term !== undefined && !renamed) {
            return false;
        }
        if (renamed && renamed !== existing.term && this.hasTerm(renamed)) {
            return false;
        }
        const updated = applyPatch({ ...existing, term: renamed ?? existing.term }, patch);
        // `term` is where the entry is now and `updated.term` is where it ends up, which is what
        // makes a rename one operation rather than a removal followed by an addition.
        if (this.opSink?.handle({ op: "set-dictionary-entry", term: existing.term, entry: updated })) {
            return true;
        }
        this.applyMutation(entries => entries.map(entry => (entry.term === existing.term ? updated : entry)));
        return true;
    }

    /** Forget a term. `false` means the project never held it. */
    public removeTerm(term: string): boolean {
        const existing = this.getEntry(term);
        if (!existing) {
            return false;
        }
        // Nothing rather than a delete verb of its own: in this document an entry that is not there
        // and a word the project does not write are the same state. See {@link LiveDictionaryOp}.
        if (this.opSink?.handle({ op: "set-dictionary-entry", term: existing.term, entry: null })) {
            return true;
        }
        this.applyMutation(entries => entries.filter(entry => entry.term !== existing.term));
        return true;
    }

    /** Turn one of the two checks on or off for this project. */
    public setOptions(patch: Partial<ProjectDictionaryOptions>): void {
        const document = this.getDocument();
        const next = normalizeDictionaryOptions({ ...document.options, ...patch });
        if (next.suggestReadings === document.options.suggestReadings
            && next.checkVariants === document.options.checkVariants) {
            return;
        }
        if (this.opSink?.handle({ op: "set-dictionary-options", options: next })) {
            return;
        }
        this.document = { ...document, options: next };
        this.bump();
    }

    /* --------------------------------------------------------------- the live-session seam */

    /** Send dictionary edits somewhere else, or take them back. Null restores ordinary behaviour. */
    public setOperationSink(sink: DictionaryOpSink | null): void {
        this.opSink = sink;
    }

    /** The document as it stands, or null before this window has read one. What a digest reads. */
    public documentOrNull(): ProjectDictionaryDocument | null {
        return this.document;
    }

    /**
     * Apply one operation to the document, **without consulting the sink**.
     *
     * The other side of the seam: what a live session calls when an effect arrives and the list is
     * finally allowed to move.
     *
     * ⚠ **The entry is written at `entry.term`, not at `term`**, and the two differ exactly when the
     * operation is a rename. Both are done as one write so that no machine ever holds the entry
     * under both spellings, however the normalizer would have merged them.
     */
    public applyLiveOp(op: LiveDictionaryOp): void {
        switch (op.op) {
            case "set-dictionary-entry": {
                const entry = op.entry;
                this.applyMutation(entries => {
                    const rest = entries.filter(candidate =>
                        candidate.term !== op.term && candidate.term !== entry?.term);
                    return entry ? [...rest, entry] : rest;
                });
                return;
            }
            case "set-dictionary-options": {
                const document = this.getDocument();
                this.document = { ...document, options: normalizeDictionaryOptions(op.options) };
                this.bump();
                return;
            }
            default: {
                // A verb with no applier would otherwise be a silent no-op: the effect lands on every
                // other machine in the room and not on this one, and nothing says so until a digest
                // disagrees one message later.
                const unapplied: never = op;
                throw new RendererError(`No applier for live dictionary operation: ${JSON.stringify(unapplied)}`);
            }
        }
    }

    /** Replace the whole document (history restore). Sets, publishes and emits without touching history. */
    public replaceDocument(document: ProjectDictionaryDocument): void {
        this.document = this.canonical(document);
        this.bump();
    }

    /** What the spellchecker settled on last time this service pushed. `null` before the first push. */
    public getSpellcheckStatus(): SpellcheckStatus | null {
        return this.status;
    }

    /** The entries, whenever any of them - or the two options - move. */
    public onEntriesChanged(handler: (entries: ProjectDictionaryEntry[]) => void): () => void {
        return this.events.on("entriesChanged", handler);
    }

    /**
     * The language settled on, whenever it changes.
     *
     * The story field draws its own underlines now, so it has to know which language it is asking
     * about - and it is the one surface that cannot go and look: the answer changes when the author
     * edits a setting in another window, and a row that only read it on mount would keep checking in
     * whatever language the project was opened with.
     */
    public onStatusChanged(handler: (status: SpellcheckStatus | null) => void): () => void {
        return this.events.on("statusChanged", handler);
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
     * The terms are the project's, and the session that holds them is the machine's, so a project
     * closed without this would leave its cast accepted in whatever opens next - including a
     * different project in a different language, where the names are simply wrong.
     */
    public dispose(): void {
        this.unsubscribeSourceLocale?.();
        this.unsubscribeSourceLocale = null;
        this.unsubscribeSetting?.();
        this.unsubscribeSetting = null;
        this.unsubscribeFocus?.();
        this.unsubscribeFocus = null;
        this.status = null;
        void getInterface().app.spellcheck.clear();
    }

    /** The single mutation entry - mutate the list, re-normalize, then {@link bump}. */
    private applyMutation(mutator: (entries: ProjectDictionaryEntry[]) => ProjectDictionaryEntry[]): void {
        const document = this.getDocument();
        this.document = {
            ...document,
            entries: normalizeDictionaryEntries(mutator([...document.entries])),
        };
        this.bump();
    }

    /** Everything that follows a change, whatever made it: revision, dirty, autosave, push, event. */
    private bump(): void {
        this.revision += 1;
        this.setDirty(true);
        this.autoSaver.schedule();
        void this.publish();
        this.events.emit("entriesChanged", this.listEntries());
    }

    private canonical(document: ProjectDictionaryDocument): ProjectDictionaryDocument {
        return {
            schemaVersion: PROJECT_DICTIONARY_SCHEMA_VERSION,
            entries: normalizeDictionaryEntries(document.entries),
            options: normalizeDictionaryOptions(document.options),
        };
    }

    /**
     * Push the language and the accepted spellings into the session.
     *
     * Not awaited by the mutators: the author has already been given their term back in the
     * document, and making an edit wait on an IPC round trip would put a frame of lag on a right
     * click. A failed push costs one session that is a term behind, which the next push corrects.
     */
    private async publish(): Promise<void> {
        const localizationService = this.getContext().services.get<LocalizationService>(Services.Localization);
        const sourceLocale = localizationService.getConfiguration().sourceLocale;
        const words = dictionaryAcceptedWords(this.getDocument().entries);
        const result = await getInterface().app.spellcheck.configure(sourceLocale, words);
        const next = result.success ? result.data : null;
        // Only when it actually moved. This runs on every window focus, and an event per focus would
        // bump the binding's revision and re-check every open row for nothing.
        if (this.status?.language === next?.language && this.status?.sourceLocale === next?.sourceLocale) {
            this.status = next;
            return;
        }
        this.status = next;
        this.events.emit("statusChanged", this.status);
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

/** One entry with a patch written over it, normalized, with absent fields left absent. */
function applyPatch(entry: ProjectDictionaryEntry, patch: DictionaryEntryPatch): ProjectDictionaryEntry {
    const next: ProjectDictionaryEntry = { term: entry.term };

    const reading = patch.reading === undefined
        ? entry.reading
        : patch.reading === null ? undefined : normalizeDictionaryWord(patch.reading) ?? undefined;
    if (reading) {
        next.reading = reading;
    }

    const variants = normalizeDictionaryVariants(patch.variants ?? entry.variants ?? [], next.term);
    if (variants.length > 0) {
        next.variants = variants;
    }

    const note = patch.note === undefined ? entry.note : patch.note === null ? undefined : patch.note.trim();
    if (note) {
        next.note = note;
    }

    return next;
}
