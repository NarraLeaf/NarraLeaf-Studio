import { CharacterAppearance, AssetChangeCallback, emptyAppearance } from "./CharacterAppearance";
import { CharacterAppearanceKind, CharacterEditorProfile, ICharacterAppearance, PortraitCrop } from "./types";

export interface CharacterProfileConfig extends CharacterEditorProfile {
    appearance: ICharacterAppearance;
}

export class CharacterProfile {
    /**
     * The sprite kind is fixed at creation because the two kinds share no data — see
     * {@link CharacterAppearance.setKind} for what changing it later costs.
     */
    public static create(id: string, name: string, kind: CharacterAppearanceKind = "preset"): CharacterProfile {
        const defaultProfile: CharacterProfileConfig = {
            id,
            name,
            description: "",
            tags: [],
            attributes: {},
            thumbnail: null,
            nicknames: [],
            // No `groupId: undefined`. The store is written by the canonical encoder now, which
            // throws on an `undefined` property instead of dropping it the way `JSON.stringify` did
            // - so a character created the assigning way is one that cannot be saved. An absent
            // optional field is spelled by leaving it out, everywhere in this file.
            appearance: emptyAppearance(kind),
        };
        return new CharacterProfile(defaultProfile);
    }

    public static fromJSON(config: CharacterProfileConfig): CharacterProfile {
        const clonedConfig: CharacterProfileConfig = {
            ...config,
            tags: [...config.tags],
            attributes: { ...config.attributes },
            nicknames: [...config.nicknames],
            // `...config` already carries `groupId` when it has one; re-stating it here used to add
            // the key back as `undefined` for every character that has none.
            appearance: new CharacterAppearance(config.appearance).toJSON(),
        };
        return new CharacterProfile(clonedConfig);
    }

    public readonly appearance: CharacterAppearance;
    private readonly profile: CharacterEditorProfile;
    private onChange: (() => void) | null = null;
    private onAssetChange: AssetChangeCallback | null = null;

    constructor(config: CharacterProfileConfig) {
        this.profile = config;
        this.appearance = new CharacterAppearance(config.appearance, () => this.notifyChange());
    }

    public setOnChange(handler: (() => void) | null): void {
        this.onChange = handler;
    }

    public setOnAssetChange(handler: AssetChangeCallback | null): void {
        this.onAssetChange = handler;
        this.appearance.setOnAssetChange(handler);
    }

    public getName(): string {
        return this.profile.name;
    }

    public setName(name: string): void {
        this.profile.name = name;
        this.notifyChange();
    }

    public getId(): string {
        return this.profile.id;
    }

    public getProfile(): Readonly<CharacterEditorProfile> {
        return this.profile;
    }

    public getDescription(): string {
        return this.profile.description;
    }

    public setDescription(description: string): void {
        this.profile.description = description;
        this.notifyChange();
    }

    public getTags(): string[] {
        return this.profile.tags;
    }

    public addTag(tag: string): void {
        this.profile.tags.push(tag);
        this.notifyChange();
    }

    public removeTag(tag: string): void {
        this.profile.tags = this.profile.tags.filter(t => t !== tag);
        this.notifyChange();
    }

    public setAttributes(attributes: Record<string, string>): void {
        this.profile.attributes = attributes;
        this.notifyChange();
    }

    public getGroupId(): string | undefined {
        return this.profile.groupId;
    }

    public setGroupId(groupId: string | undefined): void {
        this.profile.groupId = groupId;
        this.notifyChange();
    }

    public getAttributes(): Record<string, string> {
        return this.profile.attributes;
    }

    public setAttribute(name: string, value: string): void {
        this.profile.attributes[name] = value;
        this.notifyChange();
    }

    public removeAttribute(name: string): void {
        delete this.profile.attributes[name];
        this.notifyChange();
    }

    public getThumbnail(): string | null {
        return this.profile.thumbnail;
    }

    public setThumbnail(thumbnail: string | null): void {
        this.profile.thumbnail = thumbnail;
        this.notifyChange();
    }

    public getColor(): string | undefined {
        return this.profile.color;
    }

    public setColor(color: string | undefined): void {
        this.profile.color = color;
        this.notifyChange();
    }

    public getPortrait(): PortraitCrop | undefined {
        return this.profile.portrait;
    }

    public setPortrait(portrait: PortraitCrop | undefined): void {
        this.profile.portrait = portrait;
        this.notifyChange();
    }

    /**
     * The dialog avatar shown when no differential resolves one. Unlike {@link getThumbnail}, this
     * is a *project* asset and the runtime consumes it.
     */
    public getDefaultAvatarAssetId(): string | null {
        return this.profile.defaultAvatarAssetId ?? null;
    }

    public setDefaultAvatarAssetId(assetId: string | null): void {
        const previous = this.profile.defaultAvatarAssetId ?? null;
        if (previous === assetId) {
            return;
        }
        this.profile.defaultAvatarAssetId = assetId;
        this.notifyAssetChange(previous, assetId);
        this.notifyChange();
    }

    /**
     * The bus this character's voice lines play on. `null` is "the seeded `voice` bus", which is
     * what every character was on before this existed - so an unset character and a character
     * pointed at `voice` are the same playback, and the model keeps them the same value.
     */
    public getVoiceTrackId(): string | null {
        return this.profile.voiceTrackId ?? null;
    }

    public setVoiceTrackId(trackId: string | null): void {
        const next = trackId?.trim() || null;
        if ((this.profile.voiceTrackId ?? null) === next) {
            return;
        }
        this.profile.voiceTrackId = next;
        this.notifyChange();
    }

    /**
     * The frame this character enters through when a story row names none.
     *
     * `null` is "no frame" — an ordinary sprite, which is what every character did before frames
     * existed. A row can still override in either direction; see the story payload's
     * `frameSurfaceId`, where the third state lives.
     */
    public getStageFrameSurfaceId(): string | null {
        return this.profile.stageFrameSurfaceId ?? null;
    }

    public setStageFrameSurfaceId(surfaceId: string | null): void {
        const next = surfaceId?.trim() || null;
        if ((this.profile.stageFrameSurfaceId ?? null) === next) {
            return;
        }
        this.profile.stageFrameSurfaceId = next;
        this.notifyChange();
    }

    public getNicknames(): string[] {
        return this.profile.nicknames;
    }

    public addNickname(nickname: string): void {
        this.profile.nicknames.push(nickname);
        this.notifyChange();
    }

    public removeNickname(nickname: string): void {
        this.profile.nicknames = this.profile.nicknames.filter(n => n !== nickname);
        this.notifyChange();
    }

    public hasNickname(nickname: string): boolean {
        return this.profile.nicknames.includes(nickname);
    }

    public toJSON(): CharacterProfileConfig {
        return {
            id: this.profile.id,
            name: this.profile.name,
            description: this.profile.description,
            tags: [...this.profile.tags],
            attributes: { ...this.profile.attributes },
            thumbnail: this.profile.thumbnail,
            nicknames: [...this.profile.nicknames],
            // Five optional fields, spread in only when they hold something. Assigning them
            // unconditionally wrote `"groupId": undefined` for every ungrouped character, which
            // `JSON.stringify` dropped without a word and the canonical encoder refuses by name -
            // i.e. it was invisible right up until the store became a document, and then it was a
            // cast that could not be saved.
            ...(this.profile.groupId === undefined ? {} : { groupId: this.profile.groupId }),
            ...(this.profile.color === undefined ? {} : { color: this.profile.color }),
            ...(this.profile.portrait === undefined ? {} : { portrait: this.profile.portrait }),
            ...(this.profile.defaultAvatarAssetId === undefined
                ? {}
                : { defaultAvatarAssetId: this.profile.defaultAvatarAssetId }),
            ...(this.profile.voiceTrackId === undefined ? {} : { voiceTrackId: this.profile.voiceTrackId }),
            ...(this.profile.stageFrameSurfaceId === undefined
                ? {}
                : { stageFrameSurfaceId: this.profile.stageFrameSurfaceId }),
            appearance: this.appearance.toJSON(),
        };
    }

    private notifyChange(): void {
        if (this.onChange) {
            this.onChange();
        }
    }

    private notifyAssetChange(oldAssetId: string | null, newAssetId: string | null): void {
        if (oldAssetId !== newAssetId) {
            this.onAssetChange?.(oldAssetId, newAssetId);
        }
    }
}
