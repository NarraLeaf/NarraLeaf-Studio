import { CharacterAppearance } from "./CharacterAppearance";
import { CharacterEditorProfile, ICharacterAppearance } from "./types";

export interface CharacterProfileConfig extends CharacterEditorProfile {
    appearance: ICharacterAppearance;
}

export class CharacterProfile {
    public readonly appearance: CharacterAppearance;
    private readonly profile: CharacterEditorProfile;

    constructor(config: CharacterProfileConfig) {
        this.profile = config;
        this.appearance = new CharacterAppearance(config.appearance);
    }

    public getProfile(): CharacterEditorProfile {
        return this.profile;
    }
}
