import { CharacterAppearance } from "./CharacterAppearance";
import { CharacterEditorProfile, ICharacterAppearance } from "./types";

export interface CharacterProfileConfig extends CharacterEditorProfile {
    appearance: ICharacterAppearance;
}

export class CharacterProfile {
    public static create(id:string, name: string): CharacterProfile {
        const defaultProfile: CharacterProfileConfig = {
            id,
            name,
            description: "",
            tags: [],
            defaultForm: null,
            attributes: {},
            thumbnail: null,
            nicknames: [],
            groupId: undefined,
            appearance: {
                forms: [],
            },
        };
        return new CharacterProfile(defaultProfile);
    }

    public static fromJSON(config: CharacterProfileConfig): CharacterProfile {
        const clonedConfig: CharacterProfileConfig = {
            ...config,
            tags: [...config.tags],
            defaultForm: config.defaultForm ?? null,
            attributes: { ...config.attributes },
            nicknames: [...config.nicknames],
            groupId: config.groupId,
            appearance: new CharacterAppearance(config.appearance).toJSON(),
        };
        return new CharacterProfile(clonedConfig);
    }

    public readonly appearance: CharacterAppearance;
    private readonly profile: CharacterEditorProfile;
    private onChange: (() => void) | null = null;

    constructor(config: CharacterProfileConfig) {
        this.profile = config;
        this.appearance = new CharacterAppearance(config.appearance, () => this.notifyChange());
    }

    public setOnChange(handler: (() => void) | null): void {
        this.onChange = handler;
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

    public getDefaultForm(): string | null {
        return this.profile.defaultForm ?? null;
    }

    public setDefaultForm(name: string | null): void {
        this.profile.defaultForm = name ?? null;
        this.notifyChange();
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
            defaultForm: this.profile.defaultForm ?? null,
            attributes: { ...this.profile.attributes },
            thumbnail: this.profile.thumbnail,
            nicknames: [...this.profile.nicknames],
            groupId: this.profile.groupId,
            appearance: this.appearance.toJSON(),
        };
    }

    private notifyChange(): void {
        if (this.onChange) {
            this.onChange();
        }
    }
}
