/**
 * Game localization service: owns the per-locale translation library
 * (`editor/localization/<locale>.json`), the project localization
 * configuration (`.nlproj` → `app.localization`), and translation-unit
 * extraction from story documents. The Studio UI i18n framework is unrelated.
 * Comments in English per project convention.
 */

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
    isValidLocaleCode,
    isValidLocalizationKeyName,
    normalizeLocalizationDocument,
    normalizeLocalizationKeysDocument,
} from "@shared/types/localization";
import { hashSourceText } from "@shared/utils/localizationText";
import type { TranslationCsvRow } from "@shared/utils/localizationCsv";
import type { StoryDocument } from "@shared/types/story";
import { ProjectNameConvention } from "../../project/nameConvention";
import { Service } from "../Service";
import { ILocalizationService, Services, WorkspaceContext } from "../services";
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
    private autoSaveTimer: ReturnType<typeof setTimeout> | null = null;
    private readonly autoSaveDelay = 800;

    protected async init(ctx: WorkspaceContext, depend: (services: Service[]) => Promise<void>): Promise<void> {
        const filesystemService = ctx.services.get<FileSystemService>(Services.FileSystem);
        const projectService = ctx.services.get<ProjectService>(Services.Project);
        await depend([filesystemService, projectService]);
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
     * intentionally kept (non-destructive) — re-adding the language restores its
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

    public async updateLocaleEntry(
        code: string,
        patch: Partial<Pick<LocalizationLocaleEntry, "displayName" | "fallback">>,
    ): Promise<LocalizationConfiguration> {
        return this.updateConfiguration(config => ({
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
        }));
    }

    // --- Translation documents (one per locale) ---

    public async loadDocument(locale: string): Promise<LocalizationDocument> {
        this.assertKnownLocale(locale);
        const cached = this.documents.get(locale);
        if (cached) {
            return cached;
        }
        const fs = this.getFileSystem();
        const path = this.getDocumentPath(locale);
        const exists = await fs.isFileExists(path);
        if (!exists.ok) {
            throw new RendererError(exists.error.message || `Failed to access translations: ${locale}`);
        }
        let document: LocalizationDocument;
        if (!exists.data) {
            // First time this language is opened — start empty, created on first save.
            document = createEmptyLocalizationDocument(locale);
        } else {
            // A present-but-unreadable file throws instead of degrading to empty:
            // silently editing an "empty" document would overwrite the broken file.
            const result = await fs.readJSON<unknown>(path);
            if (!result.ok) {
                throw new RendererError(result.error.message || `Failed to read translations: ${locale}`);
            }
            document = normalizeLocalizationDocument(result.data, locale);
        }
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
     * line (see extractStoryTranslationRows) — the unit re-anchors its
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
        if (this.autoSaveTimer) {
            clearTimeout(this.autoSaveTimer);
            this.autoSaveTimer = null;
        }
        const locales = [...this.dirtyLocales];
        this.dirtyLocales.clear();
        for (const locale of locales) {
            const document = this.documents.get(locale);
            if (document) {
                await this.writeDocument(document);
            }
        }
        if (this.keysDirty && this.keysDocument) {
            this.keysDirty = false;
            await this.writeKeysDocument(this.keysDocument);
        }
    }

    // --- Named keys (developer-authored strings; `key:<name>` units in locale docs) ---

    public async loadKeys(): Promise<LocalizationKeysDocument> {
        if (this.keysDocument) {
            return this.keysDocument;
        }
        const fs = this.getFileSystem();
        const path = this.getContext().project.resolve(ProjectNameConvention.EditorLocalizationKeys);
        const exists = await fs.isFileExists(path);
        if (!exists.ok) {
            throw new RendererError(exists.error.message || "Failed to access localization keys");
        }
        let document: LocalizationKeysDocument;
        if (!exists.data) {
            document = createEmptyLocalizationKeysDocument();
        } else {
            const result = await fs.readJSON<unknown>(path);
            if (!result.ok) {
                throw new RendererError(result.error.message || "Failed to read localization keys");
            }
            document = normalizeLocalizationKeysDocument(result.data);
        }
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

    // --- CSV import (export assembly lives with the caller, which owns row context) ---

    /**
     * Apply parsed CSV rows to a locale document. `currentSourceByUnit` maps every
     * known unit id to its current source text. Rows are anchored to the CSV's own
     * `source` column when present (so a line whose source changed after export
     * derives "stale" naturally); otherwise to the current source text.
     */
    public applyImportedRows(
        locale: string,
        rows: readonly TranslationCsvRow[],
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
            const status: LocalizationUnitStatus =
                row.status === "machine" || row.status === "reviewed" || row.status === "translated"
                    ? row.status
                    : "translated";
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
        await this.ensureLocalizationDir();
        const result = await this.getFileSystem().write(
            this.getContext().project.resolve(ProjectNameConvention.EditorLocalizationKeys),
            JSON.stringify(document, null, 2),
            "utf-8",
        );
        if (!result.ok) {
            throw new RendererError(result.error.message);
        }
    }

    private scheduleAutoSave(): void {
        if (this.autoSaveTimer) {
            clearTimeout(this.autoSaveTimer);
        }
        this.autoSaveTimer = setTimeout(() => {
            this.autoSaveTimer = null;
            void this.flushPendingChanges().catch(err => {
                console.warn("[LocalizationService] auto-save failed", err);
            });
        }, this.autoSaveDelay);
    }

    private async ensureLocalizationDir(): Promise<void> {
        const fs = this.getFileSystem();
        const dir = this.getContext().project.resolve(ProjectNameConvention.EditorLocalization);
        const exists = await fs.isDirExists(dir);
        if (!exists.ok) {
            throw new RendererError(exists.error.message || "Failed to access localization directory");
        }
        if (!exists.data) {
            const created = await fs.createDir(dir);
            if (!created.ok) {
                throw new RendererError(created.error.message || "Failed to create localization directory");
            }
        }
    }

    private async writeDocument(document: LocalizationDocument): Promise<void> {
        await this.ensureLocalizationDir();
        const result = await this.getFileSystem().write(
            this.getDocumentPath(document.locale),
            JSON.stringify(document, null, 2),
            "utf-8",
        );
        if (!result.ok) {
            throw new RendererError(result.error.message);
        }
    }

    private getDocumentPath(locale: string): string {
        if (!isValidLocaleCode(locale)) {
            throw new RendererError(`Invalid locale code: ${locale}`);
        }
        return this.getContext().project.resolve(ProjectNameConvention.EditorLocalizationDocument(locale));
    }

    private getProjectService(): ProjectService {
        return this.getContext().services.get<ProjectService>(Services.Project);
    }

    private getFileSystem(): FileSystemService {
        return this.getContext().services.get<FileSystemService>(Services.FileSystem);
    }
}
