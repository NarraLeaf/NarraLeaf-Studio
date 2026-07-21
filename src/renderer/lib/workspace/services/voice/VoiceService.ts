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

import { RendererError } from "@shared/utils/error";
import {
    VoiceConfiguration,
    VoiceDocument,
    VoiceLocaleEntry,
    VoiceUnit,
    VoiceUnitStatus,
    createEmptyVoiceDocument,
    isValidLocaleCode,
    normalizeVoiceDocument,
} from "@shared/types/voice";
import { hashSourceText } from "@shared/utils/localizationText";
import type { StoryDocument } from "@shared/types/story";
import { ProjectNameConvention } from "../../project/nameConvention";
import { Service } from "../Service";
import { IVoiceService, Services, WorkspaceContext } from "../services";
import { FileSystemService } from "../core/FileSystem";
import { ProjectService } from "../core/ProjectService";
import { EventEmitter } from "../ui/EventEmitter";
import type { TranslatableUnitRef, StoryTranslationRow } from "../localization/localizationModel";
import { VoiceProgress, computeVoiceProgress, extractVoiceableRows } from "./voiceModel";

type VoiceServiceEvents = {
    configChanged: VoiceConfiguration;
    documentChanged: { locale: string; document: VoiceDocument };
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
    private readonly events = new EventEmitter<VoiceServiceEvents>();
    private autoSaveTimer: ReturnType<typeof setTimeout> | null = null;
    private readonly autoSaveDelay = 800;

    protected async init(ctx: WorkspaceContext, depend: (services: Service[]) => Promise<void>): Promise<void> {
        const filesystemService = ctx.services.get<FileSystemService>(Services.FileSystem);
        const projectService = ctx.services.get<ProjectService>(Services.Project);
        await depend([filesystemService, projectService]);
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

    // --- Voice documents (one per locale) ---

    public async loadDocument(locale: string): Promise<VoiceDocument> {
        this.assertKnownLocale(locale);
        const cached = this.documents.get(locale);
        if (cached) {
            return cached;
        }
        const fs = this.getFileSystem();
        const path = this.getDocumentPath(locale);
        const exists = await fs.isFileExists(path);
        if (!exists.ok) {
            throw new RendererError(exists.error.message || `Failed to access voice library: ${locale}`);
        }
        let document: VoiceDocument;
        if (!exists.data) {
            // First time this language is opened - start empty, created on first save.
            document = createEmptyVoiceDocument(locale);
        } else {
            // A present-but-unreadable file throws instead of degrading to empty:
            // silently editing an "empty" document would overwrite the broken file.
            const result = await fs.readJSON<unknown>(path);
            if (!result.ok) {
                throw new RendererError(result.error.message || `Failed to read voice library: ${locale}`);
            }
            document = normalizeVoiceDocument(result.data, locale);
        }
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
        const relinking = patch.assetId !== undefined;
        const assetId = relinking ? patch.assetId! : existing?.assetId ?? "";
        const units = { ...document.units };
        if (!assetId) {
            if (!existing) {
                return document;
            }
            delete units[unitId];
        } else {
            const note = patch.note !== undefined ? (patch.note.trim() ? patch.note : undefined) : existing?.note;
            const duration = patch.duration !== undefined ? patch.duration : existing?.duration;
            const status: VoiceUnitStatus = patch.status
                ?? (relinking ? "linked" : existing?.status ?? "linked");
            const unit: VoiceUnit = {
                assetId,
                sourceHash: relinking ? hashSourceText(sourceText) : existing?.sourceHash ?? hashSourceText(sourceText),
                status,
                ...(duration !== undefined ? { duration } : {}),
                ...(note ? { note } : {}),
            };
            units[unitId] = unit;
        }
        const next: VoiceDocument = { ...document, units };
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
    }

    // --- Row extraction + coverage (reuse localization's narrative-order rows) ---

    public extractRows(document: StoryDocument): StoryTranslationRow[] {
        return extractVoiceableRows(document);
    }

    public computeProgress(rows: readonly TranslatableUnitRef[], locale: string): VoiceProgress {
        return computeVoiceProgress(rows, this.documents.get(locale));
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
        if (this.autoSaveTimer) {
            clearTimeout(this.autoSaveTimer);
        }
        this.autoSaveTimer = setTimeout(() => {
            this.autoSaveTimer = null;
            void this.flushPendingChanges().catch(err => {
                console.warn("[VoiceService] auto-save failed", err);
            });
        }, this.autoSaveDelay);
    }

    private async ensureVoiceDir(): Promise<void> {
        const fs = this.getFileSystem();
        const dir = this.getContext().project.resolve(ProjectNameConvention.EditorVoice);
        const exists = await fs.isDirExists(dir);
        if (!exists.ok) {
            throw new RendererError(exists.error.message || "Failed to access voice directory");
        }
        if (!exists.data) {
            const created = await fs.createDir(dir);
            if (!created.ok) {
                throw new RendererError(created.error.message || "Failed to create voice directory");
            }
        }
    }

    private async writeDocument(document: VoiceDocument): Promise<void> {
        await this.ensureVoiceDir();
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
        return this.getContext().project.resolve(ProjectNameConvention.EditorVoiceDocument(locale));
    }

    private getProjectService(): ProjectService {
        return this.getContext().services.get<ProjectService>(Services.Project);
    }

    private getFileSystem(): FileSystemService {
        return this.getContext().services.get<FileSystemService>(Services.FileSystem);
    }
}
