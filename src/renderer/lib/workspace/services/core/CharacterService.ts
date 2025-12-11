import { FsRequestResult } from "@shared/types/os";
import { Service } from "../Service";
import { ICharacterService, Services, WorkspaceContext } from "../services";
import { Character } from "../character/Character";
import { CharacterProfile } from "../character/CharacterProfile";
import { CharacterGroup } from "../character/types";
import { UuidService } from "./UuidService";
import { AssetsService } from "./AssetsService";
import { FileSystemService } from "./FileSystem";
import { ServiceAssetsService } from "./ServiceAssetsService";
import { UIService } from "./UIService";

type CharacterStore = {
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

    public createCharacter(name: string): Character {
        const id = this.getUuidService().generate();
        const profile = CharacterProfile.create(id, name);
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

    private async loadCharacters(): Promise<void> {
        const store = await this.getServiceAssetsService().readStore<CharacterStore>(CharacterService.Namespace);
        if (!store.ok) {
            return;
        }
        if (store.data?.groups) {
            Object.values(store.data.groups).forEach(group => this.registerGroup(group));
        }
        if (!store.data?.characters?.length) {
            return;
        }
        for (const config of store.data.characters) {
            const character = Character.fromJSON(config);
            this.registerCharacter(character);
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
        this.dirty = false;
        const payload: CharacterStore = {
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
        }
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
}
