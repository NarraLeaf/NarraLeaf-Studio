import { CharacterProfile, CharacterProfileConfig } from "./CharacterProfile";
import { AssetChangeCallback } from "./CharacterAppearance";

export interface CharacterConfig {
    profile: CharacterProfileConfig;
}

export class Character {
    public readonly profile: CharacterProfile;
    private onChange: (() => void) | null = null;
    private onAssetChange: AssetChangeCallback | null = null;
    private listeners: Set<() => void> = new Set();

    constructor(private config: CharacterConfig) {
        this.profile = CharacterProfile.fromJSON(config.profile);
        this.profile.setOnChange(() => this.handleProfileChange());
    }

    public static fromJSON(config: CharacterConfig): Character {
        return new Character(config);
    }

    public toJSON(): CharacterConfig {
        return {
            profile: this.profile.toJSON(),
        };
    }

    public setOnChange(handler: (() => void) | null): void {
        this.onChange = handler;
    }

    public setOnAssetChange(handler: AssetChangeCallback | null): void {
        this.onAssetChange = handler;
        this.profile.setOnAssetChange(handler);
    }

    /**
     * Subscribe to change events without overriding existing handler.
     * Returns an unsubscribe function.
     */
    public subscribe(handler: () => void): () => void {
        this.listeners.add(handler);
        return () => this.listeners.delete(handler);
    }

    private handleProfileChange(): void {
        if (this.onChange) {
            this.onChange();
        }
        this.listeners.forEach(listener => listener());
    }
}
