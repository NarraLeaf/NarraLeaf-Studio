/**
 * Game localization service: owns the per-locale translation library
 * (`editor/localization/<locale>.json`), the project localization
 * configuration (`.nlproj` → `app.localization`), and translation-unit
 * extraction from story documents. The Studio UI i18n framework is unrelated.
 * Comments in English per project convention.
 */

import { loadDocument, saveDocument, type DocumentStorage } from "@shared/documents/documentIo";
import { localizationDocumentSpec, localizationKeysSpec } from "@shared/documents/specs";
import { RendererError } from "@shared/utils/error";
import {
    LocalizationConfiguration,
    LocalizationDocument,
    LocalizationKeyDefinition,
    LocalizationKeysDocument,
    LocalizationLocaleEntry,
    LocalizationUnit,
    LocalizationUnitStatus,
    createEmptyLocalizationDocument,
    createEmptyLocalizationKeysDocument,
    findLocaleFallbackConflict,
    isValidLocaleCode,
    isValidLocalizationKeyName,
    type LocaleFallbackConflict,
} from "@shared/types/localization";
import { hashSourceText } from "@shared/utils/localizationText";
import { normalizeExchangeStatus, type TranslationExchangeRow } from "@shared/utils/localizationExchange";
import type { StoryDocument } from "@shared/types/story";
import { Service } from "../Service";
import { ILocalizationService, Services, WorkspaceContext } from "../services";
import { DEFAULT_AUTOSAVE_DELAY_MS, DEFAULT_AUTOSAVE_MAX_WAIT_MS, DebouncedSaver } from "../autosave/DebouncedSaver";
import { registerAutoSaver, reportUnreadableDocument } from "../autosave/SaveStatusService";
import { createProjectDocumentStorage } from "../core/DocumentStorage";
import { FileSystemService } from "../core/FileSystem";
import { ProjectService } from "../core/ProjectService";
import { EventEmitter } from "../ui/EventEmitter";
import {
    LocalizationProgress,
    StoryTranslationRow,
    TranslatableUnitRef,
    computeLocalizationProgress,
    extractStoryTranslationRows,
} from "./localizationModel";

type LocalizationServiceEvents = {
    configChanged: LocalizationConfiguration;
    documentChanged: { locale: string; document: LocalizationDocument };
    keysChanged: LocalizationKeysDocument;
};

export type LocalizationUnitPatch = {
    target?: string;
    note?: string;
    status?: LocalizationUnitStatus;
};

/**
 * The service's own last-resort wording for a refused fallback, in English like every other error
 * thrown here. The dialog that owns this edit keeps the author away from all three cases in the
 * first place, so this is what reaches a caller that did not.
 */
function describeFallbackConflict(conflict: LocaleFallbackConflict, code: string, fallback: string): string {
    switch (conflict) {
        case "self":
            return `A language cannot fall back to itself: ${code}`;
        case "unknown":
            return `Unknown language: ${fallback}`;
        case "cycle":
            return `${fallback} already falls back to ${code}, so this would never be used`;
    }
}

export type TranslationImportSummary = {
    /** Units written (created or changed). */
    applied: number;
    /** Rows whose unit already had identical target/status/note. */
    unchanged: number;
    /** Rows skipped because their unit id matches nothing in the project. */
    unknown: number;
    /** Rows skipped because the imported target was empty (existing data kept). */
    skippedEmpty: number;
};

export class LocalizationService extends Service<LocalizationService> implements ILocalizationService {
    private readonly documents = new Map<string, LocalizationDocument>();
    private readonly dirtyLocales = new Set<string>();
    private keysDocument: LocalizationKeysDocument | null = null;
    private keysDirty = false;
    private readonly events = new EventEmitter<LocalizationServiceEvents>();
    private readonly autoSaver = new DebouncedSaver({
        delayMs: DEFAULT_AUTOSAVE_DELAY_MS,
        maxWaitMs: DEFAULT_AUTOSAVE_MAX_WAIT_MS,
        save: () => this.writeDirtyDocuments(),
        onError: err => console.warn("[LocalizationService] auto-save failed", err),
    });

    protected async init(ctx: WorkspaceContext, depend: (services: Service[]) => Promise<void>): Promise<void> {
        const filesystemService = ctx.services.get<FileSystemService>(Services.FileSystem);
        const projectService = ctx.services.get<ProjectService>(Services.Project);
        await depend([filesystemService, projectService]);
        await registerAutoSaver(ctx, depend, "localization", "workspace.shell.save.stores.localization", this.autoSaver);
        // Preload the named-key registry: synchronous consumers (widget inspector
        // key pickers, blueprint dynamic options) read it via getKeysIfLoaded().
        void this.loadKeys().catch(() => undefined);
    }

    public async dispose(): Promise<void> {
        await this.flushPendingChanges();
        this.documents.clear();
        this.dirtyLocales.clear();
        this.keysDocument = null;
        this.keysDirty = false;
    }

    // --- Configuration (persisted in .nlproj via ProjectService) ---

    public getConfiguration(): LocalizationConfiguration {
        return this.getProjectService().getLocalizationConfiguration();
    }

    public onConfigChanged(handler: (config: LocalizationConfiguration) => void): () => void {
        return this.events.on("configChanged", handler);
    }

    public async updateConfiguration(
        updater: (current: LocalizationConfiguration) => LocalizationConfiguration,
    ): Promise<LocalizationConfiguration> {
        const next = await this.getProjectService().updateLocalizationConfiguration(updater);
        this.events.emit("configChanged", next);
        return next;
    }

    public async addLocale(entry: LocalizationLocaleEntry): Promise<LocalizationConfiguration> {
        if (!isValidLocaleCode(entry.code)) {
            throw new RendererError(`Invalid locale code: ${entry.code}`);
        }
        return this.updateConfiguration(config => {
            if (config.locales.some(locale => locale.code === entry.code)) {
                throw new RendererError(`Language already exists: ${entry.code}`);
            }
            const displayName = entry.displayName.trim() || entry.code;
            const locales = [...config.locales, { ...entry, displayName }];
            // The first language of a project becomes the source language.
            const sourceLocale = config.sourceLocale || entry.code;
            return { ...config, locales, sourceLocale };
        });
    }

    /**
     * Remove a language from the configuration. The translation file on disk is
     * intentionally kept (non-destructive) - re-adding the language restores its
     * translations. The source language cannot be removed while others exist.
     */
    public async removeLocale(code: string): Promise<LocalizationConfiguration> {
        const config = await this.updateConfiguration(config => {
            if (code === config.sourceLocale && config.locales.length > 1) {
                throw new RendererError("The source language cannot be removed while other languages exist");
            }
            const locales = config.locales
                .filter(locale => locale.code !== code)
                .map(locale => {
                    if (locale.fallback === code) {
                        const { fallback: _dropped, ...rest } = locale;
                        return rest;
                    }
                    return locale;
                });
            return {
                sourceLocale: config.sourceLocale === code ? "" : config.sourceLocale,
                locales,
            };
        });
        this.documents.delete(code);
        this.dirtyLocales.delete(code);
        return config;
    }

    public async setSourceLocale(code: string): Promise<LocalizationConfiguration> {
        return this.updateConfiguration(config => {
            if (!config.locales.some(locale => locale.code === code)) {
                throw new RendererError(`Unknown language: ${code}`);
            }
            return { ...config, sourceLocale: code };
        });
    }

    /**
     * Edit one language's author-facing fields: its display name and its fallback language.
     *
     * The fallback is checked before it is stored (see findLocaleFallbackConflict). Read-side
     * resolution is cycle-safe already, so a loop never crashes - it silently makes the fallback
     * do nothing, which is the failure worth refusing at the point the author asks for it.
     */
    public async updateLocaleEntry(
        code: string,
        patch: Partial<Pick<LocalizationLocaleEntry, "displayName" | "fallback">>,
    ): Promise<LocalizationConfiguration> {
        return this.updateConfiguration(config => {
            const entry = config.locales.find(locale => locale.code === code);
            if (!entry) {
                throw new RendererError(`Unknown language: ${code}`);
            }
            // Only a fallback the patch actually changes is checked. An author who hand-edited a loop
            // into the project file must still be able to rename the language and pick their way out
            // of it, rather than be held there by the very field they came to fix.
            if (patch.fallback !== undefined && patch.fallback !== (entry.fallback ?? "")) {
                const conflict = findLocaleFallbackConflict(config, code, patch.fallback);
                if (conflict) {
                    throw new RendererError(describeFallbackConflict(conflict, code, patch.fallback));
                }
            }
            return {
                ...config,
                locales: config.locales.map(locale => {
                    if (locale.code !== code) {
                        return locale;
                    }
                    const next: LocalizationLocaleEntry = { ...locale };
                    if (patch.displayName !== undefined) {
                        next.displayName = patch.displayName.trim() || locale.code;
                    }
                    if (patch.fallback !== undefined) {
                        if (patch.fallback && patch.fallback !== code) {
                            next.fallback = patch.fallback;
                        } else {
                            delete next.fallback;
                        }
                    }
                    return next;
                }),
            };
        });
    }

    // --- Translation documents (one per locale) ---

    public async loadDocument(locale: string): Promise<LocalizationDocument> {
        this.assertKnownLocale(locale);
        const cached = this.documents.get(locale);
        if (cached) {
            return cached;
        }
        const result = await loadDocument(localizationDocumentSpec, this.storage(), this.getDocumentPath(locale));

        // A present-but-unreadable file throws instead of degrading to empty, and - the part that
        // matters - is not cached: an "empty" document in the cache is one edit away from being
        // auto-saved over a file full of translations nobody could read.
        if (result.status === "corrupt") {
            reportUnreadableDocument(this.getContext(), result);
            throw new RendererError(`Failed to read translations for ${locale}: ${result.error.reason}`);
        }

        // First time this language is opened - start empty, created on first save.
        const document = result.status === "missing" ? createEmptyLocalizationDocument(locale) : result.document;
        this.documents.set(locale, document);
        return document;
    }

    public getDocumentIfLoaded(locale: string): LocalizationDocument | undefined {
        return this.documents.get(locale);
    }

    public onDocumentChanged(handler: (event: { locale: string; document: LocalizationDocument }) => void): () => void {
        return this.events.on("documentChanged", handler);
    }

    /**
     * Apply a translator edit to one unit. `sourceText` is the current source
     * line (see extractStoryTranslationRows) - the unit re-anchors its
     * `sourceHash` to it, which is what clears a derived "stale" state after
     * the translator has reviewed the changed line. Clearing the target (and
     * having no note) removes the unit entirely.
     */
    public updateUnit(locale: string, unitId: string, sourceText: string, patch: LocalizationUnitPatch): LocalizationDocument {
        const document = this.requireLoadedDocument(locale);
        const existing = document.units[unitId];
        const target = patch.target !== undefined ? patch.target : existing?.target ?? "";
        const note = patch.note !== undefined ? (patch.note.trim() ? patch.note : undefined) : existing?.note;
        const units = { ...document.units };
        if (!target && !note) {
            if (!existing) {
                return document;
            }
            delete units[unitId];
        } else {
            const status: LocalizationUnitStatus = patch.status
                ?? (patch.target !== undefined
                    ? (target ? "translated" : "untranslated")
                    : existing?.status ?? "untranslated");
            const unit: LocalizationUnit = {
                target,
                sourceHash: hashSourceText(sourceText),
                status,
                ...(note ? { note } : {}),
            };
            units[unitId] = unit;
        }
        const next: LocalizationDocument = { ...document, units };
        this.documents.set(locale, next);
        this.dirtyLocales.add(locale);
        this.scheduleAutoSave();
        this.events.emit("documentChanged", { locale, document: next });
        return next;
    }

    public async flushPendingChanges(): Promise<void> {
        await this.autoSaver.flush();
    }

    /**
     * Throw away the cached locale documents and the key registry, and read back whatever was open.
     *
     * A participant of `WorkspaceReloadService`. `loadDocument` answers from the cache, so without
     * this a locale opened before the working tree changed would keep serving the translations it
     * had - and write them back over the ones now on disk.
     *
     * Dirty flags go too: an edit made while writes were refused is owed on a document that is being
     * replaced, and paying that debt afterwards is the loss this exists to prevent.
     */
    public async reloadFromDisk(): Promise<void> {
        const previouslyLoaded = [...this.documents.keys()];
        const hadKeys = this.keysDocument !== null;
        this.documents.clear();
        this.dirtyLocales.clear();
        this.keysDocument = null;
        this.keysDirty = false;

        // One locale at a time, and a failure does not stop the others: a document that cannot be
        // read stays out of the cache, which is the state `loadDocument` throws from and
        // `writeDirtyDocuments` skips - never an empty document one edit away from overwriting it.
        const failures: string[] = [];
        const reread = async (label: string, load: () => Promise<unknown>): Promise<void> => {
            try {
                await load();
            } catch (error) {
                failures.push(`${label} (${error instanceof Error ? error.message : String(error)})`);
            }
        };

        if (hadKeys) {
            await reread("keys", () => this.loadKeys());
        }
        for (const locale of previouslyLoaded) {
            // A locale removed from the configuration while the tree changed under us is not an
            // error - `assertKnownLocale` would throw, and there is nothing left to show.
            if (!this.getConfiguration().locales.some(entry => entry.code === locale)) {
                continue;
            }
            await reread(locale, async () => {
                const document = await this.loadDocument(locale);
                this.events.emit("documentChanged", { locale, document });
            });
        }

        if (failures.length > 0) {
            throw new RendererError(`Could not re-read ${failures.length} translation document(s): ${failures.join("; ")}`);
        }
    }

    /**
     * The write itself. Only ever reached through {@link autoSaver}, which serialises it.
     *
     * Each dirty flag is cleared *after* its write lands, not before: `writeDocument` throws on a
     * rejected write, and clearing up front meant a locale that failed to save was quietly marked
     * clean and never written again.
     */
    private async writeDirtyDocuments(): Promise<void> {
        for (const locale of [...this.dirtyLocales]) {
            const document = this.documents.get(locale);
            if (document) {
                await this.writeDocument(document);
            }
            this.dirtyLocales.delete(locale);
        }
        if (this.keysDirty && this.keysDocument) {
            await this.writeKeysDocument(this.keysDocument);
            this.keysDirty = false;
        }
    }

    // --- Named keys (developer-authored strings; `key:<name>` units in locale docs) ---

    public async loadKeys(): Promise<LocalizationKeysDocument> {
        if (this.keysDocument) {
            return this.keysDocument;
        }
        const result = await loadDocument(localizationKeysSpec, this.storage(), localizationKeysSpec.pathFor());

        if (result.status === "corrupt") {
            reportUnreadableDocument(this.getContext(), result);
            throw new RendererError(`Failed to read localization keys: ${result.error.reason}`);
        }

        const document = result.status === "missing" ? createEmptyLocalizationKeysDocument() : result.document;
        this.keysDocument = document;
        return document;
    }

    public getKeysIfLoaded(): LocalizationKeysDocument | undefined {
        return this.keysDocument ?? undefined;
    }

    public onKeysChanged(handler: (document: LocalizationKeysDocument) => void): () => void {
        return this.events.on("keysChanged", handler);
    }

    public setKey(name: string, definition: LocalizationKeyDefinition): LocalizationKeysDocument {
        if (!isValidLocalizationKeyName(name)) {
            throw new RendererError(`Invalid key name: ${name}`);
        }
        const document = this.requireLoadedKeys();
        const entry: LocalizationKeyDefinition = {
            sourceText: definition.sourceText,
            ...(definition.note?.trim() ? { note: definition.note } : {}),
        };
        const next: LocalizationKeysDocument = {
            ...document,
            keys: { ...document.keys, [name]: entry },
        };
        this.keysDocument = next;
        this.keysDirty = true;
        this.scheduleAutoSave();
        this.events.emit("keysChanged", next);
        return next;
    }

    /** Remove a named key. Its translations stay in the locale files (harmless orphans). */
    public removeKey(name: string): LocalizationKeysDocument {
        const document = this.requireLoadedKeys();
        if (!(name in document.keys)) {
            return document;
        }
        const keys = { ...document.keys };
        delete keys[name];
        const next: LocalizationKeysDocument = { ...document, keys };
        this.keysDocument = next;
        this.keysDirty = true;
        this.scheduleAutoSave();
        this.events.emit("keysChanged", next);
        return next;
    }

    // --- Exchange import (export assembly lives with the caller, which owns row context) ---

    /**
     * Apply parsed exchange rows to a locale document, whichever format they
     * were read from - CSV, XLIFF, PO and JSON all arrive here as the same rows.
     *
     * `currentSourceByUnit` maps every known unit id to its current source text.
     * Rows are anchored to the file's own source text when it carries one (so a
     * line whose source changed after the export derives "stale" naturally);
     * otherwise to the current source text.
     */
    public applyImportedRows(
        locale: string,
        rows: readonly TranslationExchangeRow[],
        currentSourceByUnit: ReadonlyMap<string, string>,
    ): TranslationImportSummary {
        const document = this.requireLoadedDocument(locale);
        const summary: TranslationImportSummary = { applied: 0, unchanged: 0, unknown: 0, skippedEmpty: 0 };
        const units = { ...document.units };
        for (const row of rows) {
            const currentSource = currentSourceByUnit.get(row.unitId);
            if (currentSource === undefined) {
                summary.unknown += 1;
                continue;
            }
            if (!row.target) {
                summary.skippedEmpty += 1;
                continue;
            }
            // A row that says "stale" is one this project exported and nobody
            // re-anchored: it is stored as translated against the source text
            // the file carries, which derives stale again if that text has since
            // moved on. Anything the file could not say becomes translated,
            // because a target arrived.
            const declared = normalizeExchangeStatus(row.status);
            const status: LocalizationUnitStatus =
                declared === "machine" || declared === "reviewed" ? declared : "translated";
            const unit: LocalizationUnit = {
                target: row.target,
                sourceHash: hashSourceText(row.source || currentSource),
                status,
                ...(row.note ? { note: row.note } : {}),
            };
            const existing = units[row.unitId];
            if (existing
                && existing.target === unit.target
                && existing.status === unit.status
                && existing.sourceHash === unit.sourceHash
                && (existing.note ?? "") === (unit.note ?? "")) {
                summary.unchanged += 1;
                continue;
            }
            units[row.unitId] = unit;
            summary.applied += 1;
        }
        if (summary.applied > 0) {
            const next: LocalizationDocument = { ...document, units };
            this.documents.set(locale, next);
            this.dirtyLocales.add(locale);
            this.scheduleAutoSave();
            this.events.emit("documentChanged", { locale, document: next });
        }
        return summary;
    }

    // --- Extraction & progress ---

    public extractRows(document: StoryDocument): StoryTranslationRow[] {
        return extractStoryTranslationRows(document);
    }

    public computeProgress(rows: readonly TranslatableUnitRef[], locale: string): LocalizationProgress {
        return computeLocalizationProgress(rows, this.documents.get(locale));
    }

    // --- Internals ---

    private assertKnownLocale(locale: string): void {
        if (!isValidLocaleCode(locale)) {
            throw new RendererError(`Invalid locale code: ${locale}`);
        }
        if (!this.getConfiguration().locales.some(entry => entry.code === locale)) {
            throw new RendererError(`Unknown language: ${locale}`);
        }
    }

    private requireLoadedDocument(locale: string): LocalizationDocument {
        const document = this.documents.get(locale);
        if (!document) {
            throw new RendererError(`Translations not loaded: ${locale}`);
        }
        return document;
    }

    private requireLoadedKeys(): LocalizationKeysDocument {
        if (!this.keysDocument) {
            throw new RendererError("Localization keys not loaded");
        }
        return this.keysDocument;
    }

    private async writeKeysDocument(document: LocalizationKeysDocument): Promise<void> {
        await saveDocument(localizationKeysSpec, this.storage(), localizationKeysSpec.pathFor(), document);
    }

    private scheduleAutoSave(): void {
        this.autoSaver.schedule();
    }

    private async writeDocument(document: LocalizationDocument): Promise<void> {
        await saveDocument(localizationDocumentSpec, this.storage(), this.getDocumentPath(document.locale), document);
    }

    /**
     * Project-relative, and built by the spec rather than by `ProjectNameConvention`, so the path a
     * document is saved to is the same path the document registry resolves back to a spec.
     */
    private getDocumentPath(locale: string): string {
        if (!isValidLocaleCode(locale)) {
            throw new RendererError(`Invalid locale code: ${locale}`);
        }
        return localizationDocumentSpec.pathFor({ locale });
    }

    private storage(): DocumentStorage {
        return createProjectDocumentStorage(this.getContext());
    }

    private getProjectService(): ProjectService {
        return this.getContext().services.get<ProjectService>(Services.Project);
    }
}
