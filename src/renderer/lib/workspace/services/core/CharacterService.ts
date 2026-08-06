import { loadDocument, saveDocument, type DocumentStorage } from "@shared/documents/documentIo";
import { charactersSpec } from "@shared/documents/specs";
import type { DocumentCorruptError } from "@shared/documents/types";
import type { CharacterStoreDocument } from "@shared/characters/characterStoreModel";
import type { TranslationKey } from "@shared/i18n";
import { Service } from "../Service";
import { HistoryService } from "../history/HistoryService";
import { projectHistoryScope } from "../history/historyScopes";
import { ICharacterService, Services, WorkspaceContext } from "../services";
import { Character } from "../character/Character";
import { CharacterProfile } from "../character/CharacterProfile";
import { CharacterAppearanceKind, CharacterGroup, StoredCharacter } from "../character/types";
import { CHARACTER_STORE_VERSION, isNewerCharacterStore, migrateCharacterStore } from "../character/migrateAppearance";
import { UuidService } from "./UuidService";
import { AssetsService } from "./AssetsService";
import { createProjectDocumentStorage } from "./DocumentStorage";
import { FileSystemService } from "./FileSystem";
import { ServiceAssetsService } from "./ServiceAssetsService";
import { UIService } from "./UIService";
import { AssetLockReason } from "../assets/AssetLockManager";
import { reportWorkspaceAnomaly } from "@/lib/workspace/recovery/anomalyLog";

/**
 * The project's cast, at `editor/services/character.json`.
 *
 * Reads and writes go through the `characters` document spec (`@shared/documents/specs`) rather than
 * through `ServiceAssetsService`'s generic store reader, which is what makes the file a versioned
 * DOCUMENT rather than a blob version control can only report the size of. Three things came with
 * that, and all three are the point rather than side effects:
 *
 *  - **Canonical bytes.** The store used to be written with `JSON.stringify` - no indent, no
 *    trailing newline, keys in whatever order the objects were built in - so any edit that rebuilt a
 *    character landed as a whole-file diff. It is now sorted, indented and newline-terminated, which
 *    is what a semantic diff of the cast is built on. The first save after this build rewrites the
 *    whole file once; every save after that touches the lines that changed.
 *  - **An unreadable store is survived, never overwritten.** `loadDocument` sets a copy aside and
 *    reports; this service latches {@link unreadable} and refuses to save, because writing the empty
 *    in-memory cast over a file we could not read turns "unreadable" into "gone".
 *  - **`undefined` is no longer writable.** The canonical encoder throws on an `undefined` property
 *    where `JSON.stringify` silently dropped it, so every optional field on the way out has to be
 *    absent rather than cleared - see the spreads in `CharacterProfile.toJSON`.
 */
export class CharacterService extends Service<CharacterService> implements ICharacterService {
    private readonly characters: Record<string, Character> = {};
    private readonly characterOrder: string[] = [];
    private readonly groups: Record<string, CharacterGroup> = {};
    private saveTimer: ReturnType<typeof setTimeout> | null = null;
    private dirty = false;
    /**
     * Set when the store on disk was written by a newer Studio. Latches every write off: whatever
     * this build failed to understand while reading is still on disk, and stays there.
     */
    private storeFromNewerStudio = false;
    /**
     * Set when the store is on disk but could not be read at all, and cleared only by a load that
     * succeeds. Latches every write off for the same reason {@link storeFromNewerStudio} does: the
     * cast in memory is empty, and an empty cast written over an unreadable file is the one outcome
     * worse than not saving.
     */
    private unreadable: DocumentCorruptError | null = null;
    private listeners: Set<() => void> = new Set();

    protected async init(ctx: WorkspaceContext, depend: (services: Service[]) => Promise<void>): Promise<void> {
        const filesystemService = ctx.services.get<FileSystemService>(Services.FileSystem);
        const assetsService = ctx.services.get<AssetsService>(Services.Assets);
        const serviceAssetsService = ctx.services.get<ServiceAssetsService>(Services.ServiceAssets);
        const uuidService = ctx.services.get<UuidService>(Services.Uuid);
        const uiService = ctx.services.get<UIService>(Services.UI);
        await depend([filesystemService, assetsService, serviceAssetsService, uuidService, uiService]);
        await this.loadCharacters();
    }

    public getCharacter(id: string): Character | undefined {
        return this.characters[id];
    }

    public listCharacter(): Character[] {
        return this.characterOrder.map(id => this.characters[id]).filter(Boolean);
    }

    public createCharacter(name: string, kind: CharacterAppearanceKind = "preset"): Character {
        const id = this.getUuidService().generate();
        const profile = CharacterProfile.create(id, name, kind);
        const character = Character.fromJSON({ profile: profile.toJSON() });
        this.registerCharacter(character);
        this.markDirty();
        this.emitChange();
        return character;
    }

    public renameCharacter(id: string, name: string): boolean {
        const character = this.characters[id];
        if (!character) {
            return false;
        }
        character.profile.setName(name);
        this.markDirty();
        this.emitChange();
        return true;
    }

    /**
     * Remove a character, and leave a way back.
     *
     * Asynchronous because of the one part that cannot be reconstructed: the baked avatar is a file,
     * and it has to be read *before* it is deleted. Everything else about a character is in the store
     * and is a plain object.
     *
     * The bytes ride in the undo entry rather than going to a trash folder. That is the right trade
     * *here* and would not be for an asset: a baked avatar is a 256px PNG, and the depth bound on the
     * stack already caps how many can be held. An asset can be a 200 MB video, which is why the
     * asset case (still open) needs somewhere on disk to put it.
     *
     * What deliberately does NOT come back into scope: the story lines that referenced this
     * character. They keep the id and dangle, exactly as they do today - deleting a referenced thing
     * warns rather than rewrites, so undo only has to put the thing back for the references to
     * resolve again. See `docs/plans/2026-08-05-001-plan-unified-undo.md`.
     */
    public async deleteCharacter(id: string): Promise<boolean> {
        const character = this.characters[id];
        if (!character) {
            return false;
        }

        const stored = character.toJSON();
        const index = this.characterOrder.indexOf(id);
        const thumbnailId = character.profile.getThumbnail() ?? undefined;
        const thumbnailBytes = thumbnailId ? await this.readServiceFile(thumbnailId) : null;

        this.removeCharacter(id, character, thumbnailId);

        this.getHistoryService().pushCommand(projectHistoryScope(), {
            label: {
                key: "characters.history.deleteCharacter" as TranslationKey,
                params: { name: stored.profile.name },
            },
            undo: async () => {
                if (thumbnailId && thumbnailBytes) {
                    await this.getServiceAssetsService().restoreFile(thumbnailId, thumbnailBytes);
                }
                const restored = Character.fromJSON(stored);
                this.registerCharacter(restored, index >= 0 ? index : undefined);
                this.lockCharacterAssets(restored);
                this.markDirty();
                this.emitChange();
            },
            redo: () => {
                const current = this.characters[id];
                if (current) {
                    this.removeCharacter(id, current, thumbnailId);
                }
            },
        });

        return true;
    }

    /** The deletion itself, so undo's `redo` and the original call cannot drift apart. */
    private removeCharacter(id: string, character: Character, thumbnailId: string | undefined): void {
        this.unlockCharacterAssets(character);
        if (thumbnailId) {
            void this.getServiceAssetsService().deleteFile(thumbnailId);
        }

        delete this.characters[id];
        const index = this.characterOrder.indexOf(id);
        if (index !== -1) {
            this.characterOrder.splice(index, 1);
        }

        this.markDirty();
        this.emitChange();
    }

    /** The avatar's bytes, or null when there is nothing to read - a missing file is not fatal here. */
    private async readServiceFile(fileId: string): Promise<Uint8Array | null> {
        try {
            const result = await this.getServiceAssetsService().readRaw(fileId);
            return result.ok ? result.data : null;
        } catch {
            return null;
        }
    }

    public listGroups(): CharacterGroup[] {
        return Object.values(this.groups).sort((a, b) => a.createdAt - b.createdAt);
    }

    public getGroup(id: string): CharacterGroup | undefined {
        return this.groups[id];
    }

    public createGroup(name: string): CharacterGroup {
        const now = Date.now();
        const group: CharacterGroup = {
            id: this.getUuidService().generate(),
            name,
            createdAt: now,
            updatedAt: now,
        };
        this.registerGroup(group);
        this.markDirty();
        this.emitChange();
        void this.flush();
        return group;
    }

    public renameGroup(id: string, name: string): boolean {
        const group = this.groups[id];
        if (!group) {
            return false;
        }
        group.name = name;
        group.updatedAt = Date.now();
        this.markDirty();
        this.emitChange();
        void this.flush();
        return true;
    }

    /**
     * Remove a group, and leave a way back.
     *
     * The group record is not the whole of what is lost: every character in it is moved out, and
     * which characters those were is not recoverable from the group afterwards. So the entry carries
     * the membership as well - undoing has to put the cast back where it was, not just re-create an
     * empty group with the same name.
     */
    public async deleteGroup(id: string): Promise<boolean> {
        const group = this.groups[id];
        if (!group) {
            return false;
        }
        const memberIds = this.listCharactersByGroup(id).map(character => character.profile.getId());
        const stored: CharacterGroup = { ...group };

        this.removeGroup(id, memberIds);

        this.getHistoryService().pushCommand(projectHistoryScope(), {
            label: {
                key: "characters.history.deleteGroup" as TranslationKey,
                params: { name: stored.name },
            },
            undo: () => {
                this.registerGroup({ ...stored });
                for (const memberId of memberIds) {
                    this.characters[memberId]?.profile.setGroupId(id);
                }
                this.markDirty();
                this.emitChange();
                void this.flush();
            },
            redo: () => {
                this.removeGroup(id, memberIds);
            },
        });
        return true;
    }

    private removeGroup(id: string, memberIds: readonly string[]): void {
        for (const memberId of memberIds) {
            const character = this.characters[memberId];
            if (character?.profile.getGroupId() === id) {
                character.profile.setGroupId(undefined);
            }
        }
        delete this.groups[id];
        this.markDirty();
        this.emitChange();
        void this.flush();
    }

    public assignCharacterToGroup(characterId: string, groupId?: string): boolean {
        const character = this.characters[characterId];
        if (!character) {
            return false;
        }
        if (groupId && !this.groups[groupId]) {
            return false;
        }
        character.profile.setGroupId(groupId);
        this.markDirty();
        this.emitChange();
        return true;
    }

    public listCharactersByGroup(groupId?: string): Character[] {
        return this.listCharacter().filter(character => character.profile.getGroupId() === groupId);
    }

    public isDirty(): boolean {
        return this.dirty;
    }

    public async flushPendingChanges(): Promise<void> {
        if (this.saveTimer) {
            clearTimeout(this.saveTimer);
            this.saveTimer = null;
        }
        await this.flush();
    }

    /**
     * Throw away the cast held in memory and read the character store back off the disk.
     *
     * A participant of `WorkspaceReloadService`. This service does not use the shared
     * {@link DebouncedSaver}, so the reload orchestrator cannot drop its debt for it - the 300ms
     * timer and the dirty flag are cleared here, before the read, because a character created while
     * writes were refused must not ride the next save to disk.
     *
     * {@link loadCharacters} merges rather than replaces (it is only ever called on a fresh service),
     * so the reset is this method's job: without it a character deleted on disk would come back, and
     * its asset locks would be held twice.
     */
    public async reloadFromDisk(): Promise<void> {
        if (this.saveTimer) {
            clearTimeout(this.saveTimer);
            this.saveTimer = null;
        }
        this.dirty = false;

        // Read before dropping anything: a store that cannot be read leaves the cast as it was.
        const result = await loadDocument(charactersSpec, this.storage(), charactersSpec.pathFor());
        if (result.status === "corrupt" && !this.newerStudioStore(result.error)) {
            this.reportUnreadable(result.error);
            return;
        }

        for (const character of this.listCharacter()) {
            this.unlockCharacterAssets(character);
        }
        for (const id of [...this.characterOrder]) {
            delete this.characters[id];
        }
        this.characterOrder.length = 0;
        for (const id of Object.keys(this.groups)) {
            delete this.groups[id];
        }

        this.applyLoadResult(result);
        await this.reportFlattenedForms(result);
        this.emitChange();
    }

    private async loadCharacters(): Promise<void> {
        const result = await loadDocument(charactersSpec, this.storage(), charactersSpec.pathFor());
        this.applyLoadResult(result);
        await this.reportFlattenedForms(result);
    }

    /**
     * Tell the author which differentials the appearance migration had to flatten.
     *
     * The migration itself now runs inside `spec.parse`, which returns a document and cannot return
     * a report beside it - so the names are recovered by running it a second time over a fresh copy
     * of the bytes on disk. That costs one extra read, and only on a store whose bytes are not
     * already what saving would write: i.e. once, on the first open after an upgrade, which is
     * exactly when a pre-rework store is still on disk to be read.
     *
     * Worth the read rather than dropped: these differentials could not compose under the old model
     * either (its resolver took the first variant that happened to have an asset), so the flattened
     * result is not a faithful translation of anything and the author has to be told to check it.
     */
    private async reportFlattenedForms(result: {status: string; normalized?: boolean}): Promise<void> {
        if (result.status !== "loaded" || result.normalized) {
            return;
        }
        let characters: unknown[];
        try {
            const raw = await this.storage().read(charactersSpec.pathFor());
            const parsed = raw === null ? null : JSON.parse(raw) as {characters?: unknown};
            characters = Array.isArray(parsed?.characters) ? parsed.characters : [];
        } catch {
            // The document parsed a moment ago, so a failure here is a race with something else
            // writing, not a fault worth reporting on top of a load that succeeded.
            return;
        }
        const report = migrateCharacterStore(characters);
        if (report.multiGroupForms.length === 0) {
            return;
        }
        this.getContext().services.get<UIService>(Services.UI).showError(
            `These character differentials could not compose before the appearance rework and were flattened; `
            + `please check the result: ${report.multiGroupForms.join(", ")}`,
        );
    }

    /**
     * Register everything a load produced. Shared by the first load and by a working-tree reload.
     *
     * `missing` deliberately writes nothing. A project with no cast yet must not get a
     * `character.json` merely for being opened - that would be a commit in every fresh project's
     * first change list, describing nothing the author did.
     */
    private applyLoadResult(result: Awaited<ReturnType<typeof loadDocument<CharacterStoreDocument>>>): void {
        // Cleared before the branch rather than inside it: these services are singletons that re-init
        // on a project switch, and a latch left set by the previous project would make the next
        // one's first save refuse.
        this.unreadable = null;
        this.storeFromNewerStudio = false;

        if (result.status === "missing") {
            return;
        }
        if (result.status === "corrupt") {
            // A store from a newer Studio is a document this build cannot represent, so the spec
            // refuses it - but it is not damaged, and the author's cast is still worth showing. The
            // original bytes travel on the error (which is what `DocumentCorruptError.text` is for),
            // so reading them here costs no second trip to disk.
            const newer = this.newerStudioStore(result.error);
            if (!newer) {
                this.reportUnreadable(result.error);
                return;
            }
            this.storeFromNewerStudio = true;
            this.getContext().services.get<UIService>(Services.UI).showError(
                `This project's characters were saved by a newer version of NarraLeaf Studio `
                + `(store version ${newer.version}, this version reads ${CHARACTER_STORE_VERSION}). `
                + `They are shown read-only and no character change will be saved. Update Studio to edit them.`,
            );
            this.registerStore(newer.characters, newer.groups);
            return;
        }

        // The migration ran inside `spec.parse`, which is why there is no migrate call here any
        // more. `normalized` is what it left behind: false means the bytes on disk are not what
        // saving this document would write - an older schema, or the pre-canonical layout the store
        // was written in before it was a document - so the file is due a rewrite, which is exactly
        // what the dirty flag asks for.
        if (!result.normalized) {
            this.markDirty();
        }
        this.registerStore(result.document.characters, result.document.groups);
    }

    /** Take a parsed store into memory: groups first, then the cast, locking the assets each one uses. */
    private registerStore(characters: readonly StoredCharacter[] | undefined, groups: Record<string, CharacterGroup> | undefined): void {
        if (groups) {
            Object.values(groups).forEach(group => this.registerGroup(group));
        }
        for (const config of characters ?? []) {
            const character = Character.fromJSON(config);
            this.registerCharacter(character);
            // Lock all assets used by this character
            this.lockCharacterAssets(character);
        }
    }

    /**
     * The store behind a rejected parse, if the only thing wrong with it is that it is from the
     * future.
     *
     * The spec has to refuse such a store - `migrateCharacterStore` reads a kind it does not
     * recognise as the pre-rework model and replaces the character with an empty preset, so it must
     * not run - but refusing is not the same as the file being damaged, and an author whose cast is
     * merely newer should still see it. Anything this cannot re-read is a genuinely corrupt file and
     * comes back null.
     */
    private newerStudioStore(error: DocumentCorruptError): CharacterStoreDocument | null {
        try {
            const parsed = JSON.parse(error.text) as CharacterStoreDocument | null;
            return parsed && isNewerCharacterStore(parsed.version) ? parsed : null;
        } catch {
            return null;
        }
    }

    private reportUnreadable(error: DocumentCorruptError): void {
        this.unreadable = error;
        // The dialog below says the cast could not be read and stops there, which is the right
        // amount for a modal. `reason` plus the original bytes' parse failure is the amount a
        // recovery session needs, so the same event goes to the log in full.
        reportWorkspaceAnomaly({
            source: "characters",
            operationKey: "workspace.recovery.operations.charactersRead",
            path: charactersSpec.pathFor(),
            error,
            severity: "degraded",
        });
        this.getContext().services.get<UIService>(Services.UI).showError(
            `This project's characters could not be read (${error.reason}). `
            + `A copy of the file has been set aside and nothing will be saved over it.`,
        );
    }

    /**
     * `index` puts a character back where it was, for undo. Appending instead would restore the cast
     * but silently reorder the panel, which is a second edit the author did not ask for.
     */
    private registerCharacter(character: Character, index?: number): void {
        const id = character.profile.getId();
        this.characters[id] = character;
        if (!this.characterOrder.includes(id)) {
            if (index === undefined || index > this.characterOrder.length) {
                this.characterOrder.push(id);
            } else {
                this.characterOrder.splice(index, 0, id);
            }
        }
        character.setOnChange(() => {
            this.markDirty();
            this.emitChange();
        });
        character.setOnAssetChange((oldAssetId, newAssetId) => {
            this.updateAssetLock(id, oldAssetId, newAssetId);
        });
    }

    private markDirty(): void {
        this.dirty = true;
        if (this.saveTimer) {
            return;
        }
        this.saveTimer = setTimeout(() => {
            this.saveTimer = null;
            void this.flush();
        }, 300);
    }

    /**
     * Subscribe to service-level changes (character/profile/group updates).
     */
    public subscribe(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    private emitChange(): void {
        this.listeners.forEach(listener => listener());
    }

    private async flush(): Promise<void> {
        if (!this.dirty) return;
        // Writing here would serialize what this build understood and drop what it did not. Refusing
        // costs the author their unsaved edit; writing costs them the characters they made in the
        // newer Studio, so the trade is not close.
        if (this.storeFromNewerStudio) return;
        if (this.unreadable) {
            // Same trade, different cause: the file is there and we could not read it, so the cast in
            // memory is empty and writing it would replace their work with nothing.
            this.getContext().services.get<UIService>(Services.UI).showError(
                `Refusing to write ${this.unreadable.path}: it is on disk but could not be read `
                + `(${this.unreadable.reason}), so anything written now would replace it with an empty cast.`,
            );
            return;
        }
        const payload: CharacterStoreDocument = {
            version: CHARACTER_STORE_VERSION,
            characters: this.characterOrder
                .map(id => this.characters[id])
                .filter((c): c is Character => Boolean(c))
                .map(c => c.toJSON()),
            groups: { ...this.groups },
        };
        try {
            await saveDocument(charactersSpec, this.storage(), charactersSpec.pathFor(), payload);
        } catch (error) {
            // Two failures land here and they are not the same. A write failure is an I/O problem;
            // a `CanonicalJsonError` means something in the cast cannot be written as JSON at all -
            // an `undefined` property, which `JSON.stringify` used to drop without a word. The
            // message names the JSON path, which is what makes the second kind fixable.
            const uiService = this.getContext().services.get<UIService>(Services.UI);
            uiService.showError("Failed to persist characters: " + (error instanceof Error ? error.message : String(error)));
            return;
        }
        this.dirty = false;
    }

    private storage(): DocumentStorage {
        return createProjectDocumentStorage(this.getContext());
    }

    private getServiceAssetsService(): ServiceAssetsService {
        return this.getContext().services.get<ServiceAssetsService>(Services.ServiceAssets);
    }

    private getHistoryService(): HistoryService {
        return this.getContext().services.get<HistoryService>(Services.History);
    }

    private getUuidService(): UuidService {
        return this.getContext().services.get<UuidService>(Services.Uuid);
    }

    private registerGroup(group: CharacterGroup): void {
        this.groups[group.id] = group;
    }

    /**
     * Lock all assets used by a character
     */
    private lockCharacterAssets(character: Character): void {
        const assetsService = this.getContext().services.get<AssetsService>(Services.Assets);
        const characterId = character.profile.getId();

        // Poses for a preset character, every layer and layer option for a layered one.
        for (const assetId of character.profile.appearance.listAssetIds()) {
            assetsService.lockAsset(assetId, AssetLockReason.UsedByCharacter, { characterId });
        }
    }

    /**
     * Unlock all assets used by a character
     */
    private unlockCharacterAssets(character: Character): void {
        const assetsService = this.getContext().services.get<AssetsService>(Services.Assets);
        const characterId = character.profile.getId();

        for (const assetId of character.profile.appearance.listAssetIds()) {
            assetsService.unlockAsset(assetId, AssetLockReason.UsedByCharacter, { characterId });
        }
    }

    /**
     * Update asset locks when a character's variant asset changes
     * This should be called by the character appearance when assets change
     */
    public updateAssetLock(characterId: string, oldAssetId: string | null, newAssetId: string | null): void {
        const assetsService = this.getContext().services.get<AssetsService>(Services.Assets);
        
        // Unlock old asset
        if (oldAssetId) {
            assetsService.unlockAsset(oldAssetId, AssetLockReason.UsedByCharacter, { characterId });
        }
        
        // Lock new asset
        if (newAssetId) {
            assetsService.lockAsset(newAssetId, AssetLockReason.UsedByCharacter, { characterId });
        }
    }
}
