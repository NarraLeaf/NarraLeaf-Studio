/**
 * Game voice-over service: owns the per-locale voice library
 * (`editor/voice/<locale>.json`) and the project voice configuration
 * (`.nlproj` → `app.voice`). Studio does not record audio - a voice unit links
 * a story line to an audio asset already imported into the asset library.
 *
 * Voiceable-line extraction and coverage reuse the localization row extractor so
 * text, translation, and voice stay keyed by the same story `textId` unit ids.
 * Comments in English per project convention.
 */

import { loadDocument, saveDocument, type DocumentStorage } from "@shared/documents/documentIo";
import { voiceDocumentSpec } from "@shared/documents/specs";
import { RendererError } from "@shared/utils/error";
import {
    VoiceConfiguration,
    VoiceDocument,
    VoiceLocaleEntry,
    VoiceUnit,
    VoiceUnitStatus,
    createEmptyVoiceDocument,
    isValidLocaleCode,
    voiceLineText,
} from "@shared/types/voice";
import type { LiveVoiceOp } from "@shared/live/ops";
import { hashSourceText } from "@shared/utils/localizationText";
import type { VoiceCsvRow } from "@shared/utils/voiceCsv";
import type { StoryDocument } from "@shared/types/story";
import { Service } from "../Service";
import { IVoiceService, Services, WorkspaceContext } from "../services";
import { DEFAULT_AUTOSAVE_DELAY_MS, DEFAULT_AUTOSAVE_MAX_WAIT_MS, DebouncedSaver } from "../autosave/DebouncedSaver";
import { registerAutoSaver, reportUnreadableDocument } from "../autosave/SaveStatusService";
import { createProjectDocumentStorage } from "../core/DocumentStorage";
import { FileSystemService } from "../core/FileSystem";
import { ProjectService } from "../core/ProjectService";
import { LocalizationService } from "../localization/LocalizationService";
import { EventEmitter } from "../ui/EventEmitter";
import type { TranslatableUnitRef, StoryTranslationRow } from "../localization/localizationModel";
import { VoiceProgress, computeVoiceProgress, extractVoiceableRows } from "./voiceModel";

type VoiceServiceEvents = {
    configChanged: VoiceConfiguration;
    documentChanged: { locale: string; document: VoiceDocument };
};

/**
 * Somewhere a voice edit can go instead of into the library.
 *
 * `LocalizationOpSink`'s mirror, one document along, and the same bargain: with a sink installed an
 * edit becomes an operation and the document is not touched; the row moves when the operation comes
 * back as somebody's effect and {@link VoiceService.applyLiveOp} applies it.
 *
 * ⚠ A take carries no claim, unlike a translation - see `CLAIMED_OPS` for the test both answers come
 * from. That changes nothing here: a sink is about where an edit goes, not about who is allowed to
 * make it.
 */
export type VoiceOpSink = {
    /**
     * Take one operation, or decline it.
     *
     * True means the sink has it and the library must not be touched. False means this edit is not
     * the sink's business and the caller carries on as usual.
     */
    handle(op: LiveVoiceOp): boolean;
};

/** What a recording-script import did, per row. `unknown` = a line with no take to annotate. */
export type VoiceImportSummary = {
    applied: number;
    unchanged: number;
    unknown: number;
};

export type VoiceUnitPatch = {
    /** Asset-library id of the imported clip. Passing this (re-)links the line and re-stamps its hash. */
    assetId?: string;
    status?: VoiceUnitStatus;
    duration?: number;
    note?: string;
};

export class VoiceService extends Service<VoiceService> implements IVoiceService {
    private readonly documents = new Map<string, VoiceDocument>();
    private readonly dirtyLocales = new Set<string>();
    /** Where voice edits go instead of into the library, when something else owns them. */
    private opSink: VoiceOpSink | null = null;
    private readonly events = new EventEmitter<VoiceServiceEvents>();
    private readonly autoSaver = new DebouncedSaver({
        delayMs: DEFAULT_AUTOSAVE_DELAY_MS,
        maxWaitMs: DEFAULT_AUTOSAVE_MAX_WAIT_MS,
        save: () => this.writeDirtyDocuments(),
        onError: err => console.warn("[VoiceService] auto-save failed", err),
    });

    protected async init(ctx: WorkspaceContext, depend: (services: Service[]) => Promise<void>): Promise<void> {
        const filesystemService = ctx.services.get<FileSystemService>(Services.FileSystem);
        const projectService = ctx.services.get<ProjectService>(Services.Project);
        const localizationService = ctx.services.get<LocalizationService>(Services.Localization);
        // Localization is a dependency because a dub is a recording of the *translated* line - see
        // `voiceLineText`. One-directional: localization knows nothing about voice.
        await depend([filesystemService, projectService, localizationService]);
        await registerAutoSaver(ctx, depend, "voice", "workspace.shell.save.stores.voice", this.autoSaver);
    }

    public async dispose(): Promise<void> {
        await this.flushPendingChanges();
        this.documents.clear();
        this.dirtyLocales.clear();
    }

    // --- Configuration (`.nlproj` → app.voice) ---

    public getConfiguration(): VoiceConfiguration {
        return this.getProjectService().getVoiceConfiguration();
    }

    public onConfigChanged(handler: (config: VoiceConfiguration) => void): () => void {
        return this.events.on("configChanged", handler);
    }

    public async updateConfiguration(
        updater: (current: VoiceConfiguration) => VoiceConfiguration,
    ): Promise<VoiceConfiguration> {
        const next = await this.getProjectService().updateVoiceConfiguration(updater);
        this.events.emit("configChanged", next);
        return next;
    }

    public async addLocale(entry: VoiceLocaleEntry): Promise<VoiceConfiguration> {
        if (!isValidLocaleCode(entry.code)) {
            throw new RendererError(`Invalid locale code: ${entry.code}`);
        }
        return this.updateConfiguration(config => {
            if (config.voicedLocales.some(locale => locale.code === entry.code)) {
                throw new RendererError(`Voice language already exists: ${entry.code}`);
            }
            const displayName = entry.displayName.trim() || entry.code;
            return { ...config, voicedLocales: [...config.voicedLocales, { ...entry, displayName }] };
        });
    }

    /**
     * Remove a voice language from the configuration. The voice file on disk is
     * intentionally kept (non-destructive) - re-adding the language restores its
     * clip assignments.
     */
    public async removeLocale(code: string): Promise<VoiceConfiguration> {
        const config = await this.updateConfiguration(config => ({
            ...config,
            voicedLocales: config.voicedLocales.filter(locale => locale.code !== code),
        }));
        this.documents.delete(code);
        this.dirtyLocales.delete(code);
        return config;
    }

    // --- Casting (per-character voice actor, per language) ---

    public getCastName(characterId: string, locale: string): string {
        return this.getConfiguration().cast[characterId]?.[locale] ?? "";
    }

    public async setCastName(characterId: string, locale: string, name: string): Promise<VoiceConfiguration> {
        const trimmed = name.trim();
        return this.updateConfiguration(config => {
            const cast = { ...config.cast };
            const perLocale = { ...(cast[characterId] ?? {}) };
            if (trimmed) {
                perLocale[locale] = trimmed;
            } else {
                delete perLocale[locale];
            }
            if (Object.keys(perLocale).length > 0) {
                cast[characterId] = perLocale;
            } else {
                delete cast[characterId];
            }
            return { ...config, cast };
        });
    }

    // --- The text a take is a recording of ---

    /**
     * Make sure {@link getLineText} can answer for this voice language: pull in its translation table
     * when the project also translates into it. A voice language the project never translated into
     * needs nothing loaded - the source text is what the actor reads.
     */
    public async loadLineTexts(locale: string): Promise<void> {
        const localization = this.getLocalizationService();
        if (!localization.getConfiguration().locales.some(entry => entry.code === locale)) {
            return;
        }
        await localization.loadDocument(locale).catch(() => undefined);
    }

    /**
     * The line as the actor for this voice language reads it. Every voice surface goes through here so
     * the table, the recording script, and the staleness hash agree on one text per language.
     * Synchronous, so callers must have run {@link loadLineTexts} first (it falls back to the source
     * text, never throws, so a missed preload degrades instead of breaking).
     */
    public getLineText(locale: string, unitId: string, sourceText: string): string {
        return voiceLineText(this.getLocalizationService().getDocumentIfLoaded(locale), unitId, sourceText);
    }

    // --- Voice documents (one per locale) ---

    public async loadDocument(locale: string): Promise<VoiceDocument> {
        this.assertKnownLocale(locale);
        const cached = this.documents.get(locale);
        if (cached) {
            return cached;
        }
        const result = await loadDocument(voiceDocumentSpec, this.storage(), this.getDocumentPath(locale));

        // A present-but-unreadable file throws instead of degrading to empty, and - the part that
        // matters - is not cached: an "empty" document in the cache is one edit away from being
        // auto-saved over the file nobody could read. The caller sees the failure; the file is
        // untouched and a copy of it has been quarantined.
        if (result.status === "corrupt") {
            reportUnreadableDocument(this.getContext(), result);
            throw new RendererError(`Failed to read voice library ${locale}: ${result.error.reason}`);
        }

        // First time this language is opened - start empty, created on first save.
        const document = result.status === "missing" ? createEmptyVoiceDocument(locale) : result.document;
        this.documents.set(locale, document);
        return document;
    }

    public getDocumentIfLoaded(locale: string): VoiceDocument | undefined {
        return this.documents.get(locale);
    }

    public onDocumentChanged(handler: (event: { locale: string; document: VoiceDocument }) => void): () => void {
        return this.events.on("documentChanged", handler);
    }

    /**
     * Link, re-link, approve, or unlink a line's voice for a locale. Passing
     * `assetId` (re-)links the line and re-stamps the source hash - a new take
     * resets the unit to "linked" (needs re-approval) unless the patch says
     * otherwise. Passing an empty `assetId` unlinks the line. Status/note/
     * duration-only patches never touch the source hash, so approving cannot
     * silently un-stale a line whose text changed after the take was imported.
     */
    public updateUnit(locale: string, unitId: string, sourceText: string, patch: VoiceUnitPatch): VoiceDocument {
        const document = this.requireLoadedDocument(locale);
        const existing = document.units[unitId];
        const unit = this.unitFromPatch(existing, sourceText, patch);
        if (unit === null && !existing) {
            return document;
        }
        // The sink is handed the take as it WOULD have been written, never the patch - see
        // {@link VoiceOpSink} and its translation counterpart for why.
        if (this.opSink?.handle({ op: "set-take", locale, unitId, unit })) {
            return document;
        }
        return this.writeUnits(locale, document, [{ unitId, unit }]);
    }

    /**
     * The take a patch produces, or null when the line ends up with no take at all.
     *
     * Pulled out of {@link updateUnit} for the reason its translation counterpart was: the operation
     * a session sends carries the result, so the result has to exist before anybody decides whether
     * the document is going to be touched. Clearing the clip removes the entry, which is the
     * document's own rule - a take with no audio is not a take.
     */
    private unitFromPatch(
        existing: VoiceUnit | undefined,
        sourceText: string,
        patch: VoiceUnitPatch,
    ): VoiceUnit | null {
        const relinking = patch.assetId !== undefined;
        const assetId = relinking ? patch.assetId! : existing?.assetId ?? "";
        if (!assetId) {
            return null;
        }
        const note = patch.note !== undefined ? (patch.note.trim() ? patch.note : undefined) : existing?.note;
        const duration = patch.duration !== undefined ? patch.duration : existing?.duration;
        const status: VoiceUnitStatus = patch.status
            ?? (relinking ? "linked" : existing?.status ?? "linked");
        return {
            assetId,
            sourceHash: relinking ? hashSourceText(sourceText) : existing?.sourceHash ?? hashSourceText(sourceText),
            status,
            ...(duration !== undefined ? { duration } : {}),
            ...(note ? { note } : {}),
        };
    }

    /**
     * Write takes into one locale's library, whichever path asked for it.
     *
     * The one place the map is replaced, so an ordinary edit, an import and an arriving effect all
     * mark the same things dirty and raise the same event. A null entry removes.
     */
    private writeUnits(
        locale: string,
        document: VoiceDocument,
        entries: readonly { unitId: string; unit: VoiceUnit | null }[],
    ): VoiceDocument {
        const units = { ...document.units };
        for (const entry of entries) {
            if (entry.unit === null) {
                delete units[entry.unitId];
            } else {
                units[entry.unitId] = entry.unit;
            }
        }
        const next: VoiceDocument = { ...document, units };
        this.documents.set(locale, next);
        this.dirtyLocales.add(locale);
        this.scheduleAutoSave();
        this.events.emit("documentChanged", { locale, document: next });
        return next;
    }

    /**
     * File takes under unit ids this project has just minted - what a line carries with it when a
     * copy or a paste renames it (see `storyVoiceTransfer`).
     *
     * The mirror of `LocalizationService.adoptUnits`, and it keeps the same two rules. A unit
     * already under that id is never overwritten: this only ever fills in lines that have no take,
     * and a write that could displace one would make a paste capable of replacing a recording the
     * author chose. And nothing is re-stamped - the hash and the sign-off arrive as the transfer
     * built them, because the take is the same audio file against the same text.
     */
    public adoptUnits(locale: string, units: Readonly<Record<string, VoiceUnit>>): VoiceDocument {
        const document = this.requireLoadedDocument(locale);
        const next = { ...document.units };
        let adopted = 0;
        for (const [unitId, unit] of Object.entries(units)) {
            if (!unitId || !unit.assetId || next[unitId]) {
                continue;
            }
            next[unitId] = {
                assetId: unit.assetId,
                sourceHash: unit.sourceHash,
                status: unit.status,
                ...(unit.duration !== undefined ? { duration: unit.duration } : {}),
                ...(unit.note ? { note: unit.note } : {}),
            };
            adopted += 1;
        }
        if (adopted === 0) {
            return document;
        }
        const updated: VoiceDocument = { ...document, units: next };
        this.documents.set(locale, updated);
        this.dirtyLocales.add(locale);
        this.scheduleAutoSave();
        this.events.emit("documentChanged", { locale, document: updated });
        return updated;
    }

    /**
     * Fold a recording script the booth filled in back into the voice library.
     *
     * The export half has existed since the module shipped and the parser was written alongside it,
     * but nothing ever called the parser - so every note and every approval a director wrote in the
     * spreadsheet had no way home. Only the two columns a human edits are read: `note`, and `status`
     * when it says approved or linked. Everything else in the file is derived state that this project
     * owns (a clip is linked by importing audio, not by typing a filename), so a row cannot invent a
     * take or re-point one.
     */
    public applyImportedRows(locale: string, rows: readonly VoiceCsvRow[]): VoiceImportSummary {
        const document = this.requireLoadedDocument(locale);
        const summary: VoiceImportSummary = { applied: 0, unchanged: 0, unknown: 0 };
        const units = { ...document.units };
        /**
         * Only the takes this import actually changes, in the order the script named them.
         *
         * ⚠ **An import is ONE gesture and travels as one operation**, for the reason the story's
         * batch verbs exist: a run of `set-take`s would draw a partly-imported library on every other
         * screen and cost a press of undo per row.
         */
        const changed: { unitId: string; unit: VoiceUnit }[] = [];
        for (const row of rows) {
            const existing = units[row.unitId];
            if (!existing) {
                // No take for this line, so there is nothing for a note or an approval to be about.
                summary.unknown += 1;
                continue;
            }
            const note = row.note.trim();
            const declared = row.status.trim().toLowerCase();
            const status: VoiceUnitStatus = declared === "approved"
                ? "approved"
                : declared === "linked" || declared === "voiced"
                    ? "linked"
                    : existing.status;
            const next: VoiceUnit = {
                ...existing,
                status,
                ...(note ? { note } : {}),
            };
            if (!note) {
                delete next.note;
            }
            if (next.status === existing.status && (next.note ?? "") === (existing.note ?? "")) {
                summary.unchanged += 1;
                continue;
            }
            units[row.unitId] = next;
            changed.push({ unitId: row.unitId, unit: next });
            summary.applied += 1;
        }
        if (summary.applied > 0) {
            if (!this.opSink?.handle({ op: "set-takes", locale, units: changed })) {
                this.writeUnits(locale, document, changed);
            }
        }
        // Reported whichever way it went: the summary is what the import DECIDED, and inside a
        // session the takes land when the effect comes back.
        return summary;
    }

    public async flushPendingChanges(): Promise<void> {
        await this.autoSaver.flush();
    }

    /**
     * Throw away the cached voice libraries and read back whatever was open. The mirror of
     * `LocalizationService.reloadFromDisk`, for the same reason: `loadDocument` answers from the
     * cache, so a locale opened before the working tree changed would keep - and later write back -
     * the clip assignments it already had.
     */
    public async reloadFromDisk(): Promise<void> {
        const previouslyLoaded = [...this.documents.keys()];
        this.documents.clear();
        this.dirtyLocales.clear();

        const failures: string[] = [];
        for (const locale of previouslyLoaded) {
            // A voice language dropped from the configuration while the tree changed is not an error.
            if (!this.getConfiguration().voicedLocales.some(entry => entry.code === locale)) {
                continue;
            }
            try {
                const document = await this.loadDocument(locale);
                this.events.emit("documentChanged", { locale, document });
            } catch (error) {
                failures.push(`${locale} (${error instanceof Error ? error.message : String(error)})`);
            }
        }

        if (failures.length > 0) {
            throw new RendererError(`Could not re-read ${failures.length} voice library/libraries: ${failures.join("; ")}`);
        }
    }

    /**
     * The write itself. Only ever reached through {@link autoSaver}, which serialises it.
     *
     * See `LocalizationService.writeDirtyDocuments`: the dirty flag is cleared after the write
     * lands, so a rejected write leaves something to retry.
     */
    private async writeDirtyDocuments(): Promise<void> {
        for (const locale of [...this.dirtyLocales]) {
            const document = this.documents.get(locale);
            if (document) {
                await this.writeDocument(document);
            }
            this.dirtyLocales.delete(locale);
        }
    }

    /* --------------------------------------------------------------- the live-session seam */

    /** Send voice edits somewhere else, or take them back. Null restores ordinary behaviour. */
    public setOperationSink(sink: VoiceOpSink | null): void {
        this.opSink = sink;
    }

    /** Every language the project records voice for, in configuration order. */
    public listLocales(): readonly string[] {
        return this.getConfiguration().voicedLocales.map(entry => entry.code);
    }

    /**
     * Read every language's library into memory, and say which ones could be read.
     *
     * `LocalizationService.loadAllDocuments`' mirror, and called for the same reason: an applier is
     * synchronous, so a library that is not in memory by the time a session starts is one no effect
     * can ever reach.
     */
    public async loadAllDocuments(): Promise<readonly string[]> {
        const loaded: string[] = [];
        for (const locale of this.listLocales()) {
            try {
                await this.loadDocument(locale);
                loaded.push(locale);
            } catch (error) {
                console.warn(`[VoiceService] could not read voice takes for ${locale}`, error);
            }
        }
        return loaded;
    }

    /** One language's takes as they stand, or null when this window does not hold them. */
    public unitsOf(locale: string): Readonly<Record<string, VoiceUnit>> | null {
        return this.documents.get(locale)?.units ?? null;
    }

    /**
     * Apply one operation to the library, **without consulting the sink**.
     *
     * ⚠ A language this window does not hold is a no-op rather than a throw, and the divergence
     * guard catches it on this very effect - see `LocalizationService.applyLiveOp`.
     */
    public applyLiveOp(op: LiveVoiceOp): void {
        const document = this.documents.get(op.locale);
        if (!document) {
            console.warn(`[VoiceService] no voice takes loaded for ${op.locale}; effect not applied`);
            return;
        }
        switch (op.op) {
            case "set-take":
                this.writeUnits(op.locale, document, [{ unitId: op.unitId, unit: op.unit }]);
                return;
            case "set-takes":
                this.writeUnits(op.locale, document, op.units);
                return;
            default: {
                // A verb with no applier would otherwise be a silent no-op: the effect lands
                // everywhere else in the room and not here, and nothing says so until a digest
                // disagrees one message later.
                const unapplied: never = op;
                throw new RendererError(`No applier for live voice operation: ${JSON.stringify(unapplied)}`);
            }
        }
    }

    // --- Row extraction + coverage (reuse localization's narrative-order rows) ---

    /**
     * The lines of one story an actor records, in narrative order.
     *
     * Reads the project switch itself so every caller - coverage, the voice table, the recording
     * script, batch import - asks the same question one way. A caller that resolved the roles for
     * itself would be a second answer to "what is voiced here", and the two would drift.
     */
    public extractRows(document: StoryDocument): StoryTranslationRow[] {
        return extractVoiceableRows(document, { includeChoices: this.getConfiguration().voiceChoices });
    }

    public computeProgress(rows: readonly TranslatableUnitRef[], locale: string): VoiceProgress {
        return computeVoiceProgress(
            rows,
            this.documents.get(locale),
            (unitId, sourceText) => this.getLineText(locale, unitId, sourceText),
        );
    }

    private assertKnownLocale(locale: string): void {
        if (!isValidLocaleCode(locale)) {
            throw new RendererError(`Invalid locale code: ${locale}`);
        }
        if (!this.getConfiguration().voicedLocales.some(entry => entry.code === locale)) {
            throw new RendererError(`Unknown voice language: ${locale}`);
        }
    }

    private requireLoadedDocument(locale: string): VoiceDocument {
        const document = this.documents.get(locale);
        if (!document) {
            throw new RendererError(`Voice library not loaded: ${locale}`);
        }
        return document;
    }

    private scheduleAutoSave(): void {
        this.autoSaver.schedule();
    }

    private async writeDocument(document: VoiceDocument): Promise<void> {
        await saveDocument(voiceDocumentSpec, this.storage(), this.getDocumentPath(document.locale), document);
    }

    /**
     * Project-relative, and built by the spec rather than by `ProjectNameConvention`, so the path a
     * document is saved to is the same path the document registry resolves back to a spec. Two
     * spellings of one location is how a file ends up written where nothing looks for it.
     */
    private getDocumentPath(locale: string): string {
        if (!isValidLocaleCode(locale)) {
            throw new RendererError(`Invalid locale code: ${locale}`);
        }
        return voiceDocumentSpec.pathFor({ locale });
    }

    private storage(): DocumentStorage {
        return createProjectDocumentStorage(this.getContext());
    }

    private getProjectService(): ProjectService {
        return this.getContext().services.get<ProjectService>(Services.Project);
    }

    private getLocalizationService(): LocalizationService {
        return this.getContext().services.get<LocalizationService>(Services.Localization);
    }
}
