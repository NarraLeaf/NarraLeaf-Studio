import { FsRequestResult } from "@shared/types/os";
import { Service } from "../Service";
import { ICharacterService, Services, WorkspaceContext } from "../services";
import { Character } from "../character/Character";
import { CharacterProfile } from "../character/CharacterProfile";
import { CharacterAppearanceKind, CharacterGroup } from "../character/types";
import { CHARACTER_STORE_VERSION, migrateCharacterStore } from "../character/migrateAppearance";
import { UuidService } from "./UuidService";
import { AssetsService } from "./AssetsService";
import { FileSystemService } from "./FileSystem";
import { ServiceAssetsService } from "./ServiceAssetsService";
import { UIService } from "./UIService";
import { AssetLockReason } from "../assets/AssetLockManager";

type CharacterStore = {
    /** Absent on stores written before the appearance rework; see `migrateAppearance.ts`. */
    version?: number;
    characters: ReturnType<Character["toJSON"]>[];
    groups?: Record<string, CharacterGroup>;
};

export class CharacterService extends Service<CharacterService> implements ICharacterService {
    private static readonly Namespace = "character";
    private readonly characters: Record<string, Character> = {};
    private readonly characterOrder: string[] = [];
    private readonly groups: Record<string, CharacterGroup> = {};
    private saveTimer: ReturnType<typeof setTimeout> | null = null;
    private dirty = false;
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

    public deleteCharacter(id: string): boolean {
        const character = this.characters[id];
        if (!character) {
            return false;
        }

        // Unlock all assets used by this character
        this.unlockCharacterAssets(character);

        const thumbnailId = character.profile.getThumbnail();
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
        return true;
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

    public deleteGroup(id: string): boolean {
        if (!this.groups[id]) {
            return false;
        }
        for (const character of this.listCharacter()) {
            if (character.profile.getGroupId() === id) {
                character.profile.setGroupId(undefined);
            }
        }
        delete this.groups[id];
        this.markDirty();
        this.emitChange();
        void this.flush();
        return true;
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
        const store = await this.getServiceAssetsService().readStore<CharacterStore>(CharacterService.Namespace);

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

        this.applyCharacterStore(store);
        this.emitChange();
    }

    private async loadCharacters(): Promise<void> {
        const store = await this.getServiceAssetsService().readStore<CharacterStore>(CharacterService.Namespace);
        this.applyCharacterStore(store);
    }

    /** Register everything a read store contains. Shared by the first load and by a working-tree reload. */
    private applyCharacterStore(store: FsRequestResult<CharacterStore>): void {
        if (!store.ok) {
            return;
        }
        if (store.data?.groups) {
            Object.values(store.data.groups).forEach(group => this.registerGroup(group));
        }
        if (!store.data?.characters?.length) {
            return;
        }
        // Runs on every load and is idempotent: a character already on the two-kind model is left
        // alone. Nothing is written back until something else marks the store dirty, so opening a
        // project read-only does not rewrite it.
        const report = migrateCharacterStore(store.data.characters);
        if (report.migrated > 0) {
            this.markDirty();
        }
        if (report.multiGroupForms.length > 0) {
            // Not an error the author caused: these differentials could not compose under the old
            // model either (it took the first variant that had an asset). Say so once, with names,
            // rather than let the flattened result look like a faithful translation.
            this.getContext().services.get<UIService>(Services.UI).showError(
                `These character differentials could not compose before the appearance rework and were flattened; `
                + `please check the result: ${report.multiGroupForms.join(", ")}`,
            );
        }
        for (const config of store.data.characters) {
            const character = Character.fromJSON(config);
            this.registerCharacter(character);
            // Lock all assets used by this character
            this.lockCharacterAssets(character);
        }
    }

    private registerCharacter(character: Character): void {
        const id = character.profile.getId();
        this.characters[id] = character;
        if (!this.characterOrder.includes(id)) {
            this.characterOrder.push(id);
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
        const payload: CharacterStore = {
            version: CHARACTER_STORE_VERSION,
            characters: this.characterOrder
                .map(id => this.characters[id])
                .filter((c): c is Character => Boolean(c))
                .map(c => c.toJSON()),
            groups: { ...this.groups },
        };
        const result: FsRequestResult<{ path: string }> = await this.getServiceAssetsService().writeStore(CharacterService.Namespace, payload);
        if (!result.ok) {
            const uiService = this.getContext().services.get<UIService>(Services.UI);
            uiService.showError("Failed to persist characters: " + result.error);
            return;
        }
        this.dirty = false;
    }

    private getServiceAssetsService(): ServiceAssetsService {
        return this.getContext().services.get<ServiceAssetsService>(Services.ServiceAssets);
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
