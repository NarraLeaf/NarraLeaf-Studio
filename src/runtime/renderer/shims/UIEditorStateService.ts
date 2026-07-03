type Unsubscribe = () => void;

class RuntimeUIEditorStateService {
    public static getInstance(): RuntimeUIEditorStateService {
        return instance;
    }

    public getInteractionOverride(): null {
        return null;
    }

    public setInteractionOverride(): void {
        /* Preview runtime has no editor interaction override. */
    }

    public getSelection(): null {
        return null;
    }

    public getAppearanceInspectorVariant(): null {
        return null;
    }

    public on(): Unsubscribe {
        return () => undefined;
    }
}

const instance = new RuntimeUIEditorStateService();

export { RuntimeUIEditorStateService as UIEditorStateService };
