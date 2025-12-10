import { CharacterProfile, CharacterProfileConfig } from "./CharacterProfile";

export interface CharacterConfig {
    profile: CharacterProfileConfig;
}

export class Character {
    public readonly profile: CharacterProfile;
    private onChange: (() => void) | null = null;

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

    private handleProfileChange(): void {
        if (this.onChange) {
            this.onChange();
        }
    }
}
