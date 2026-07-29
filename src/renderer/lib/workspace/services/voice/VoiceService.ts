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
} from "@shared/types/voice";
import { hashSourceText } from "@shared/utils/localizationText";
import type { StoryDocument } from "@shared/types/story";
import { Service } from "../Service";
import { IVoiceService, Services, WorkspaceContext } from "../services";
import { DEFAULT_AUTOSAVE_DELAY_MS, DEFAULT_AUTOSAVE_MAX_WAIT_MS, DebouncedSaver } from "../autosave/DebouncedSaver";
import { registerAutoSaver, reportUnreadableDocument } from "../autosave/SaveStatusService";
import { createProjectDocumentStorage } from "../core/DocumentStorage";
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
    private readonly autoSaver = new DebouncedSaver({
        delayMs: DEFAULT_AUTOSAVE_DELAY_MS,
        maxWaitMs: DEFAULT_AUTOSAVE_MAX_WAIT_MS,
        save: () => this.writeDirtyDocuments(),
        onError: err => console.warn("[VoiceService] auto-save failed", err),
    });

    protected async init(ctx: WorkspaceContext, depend: (services: Service[]) => Promise<void>): Promise<void> {
        const filesystemService = ctx.services.get<FileSystemService>(Services.FileSystem);
        const projectService = ctx.services.get<ProjectService>(Services.Project);
        await depend([filesystemService, projectService]);
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
}
