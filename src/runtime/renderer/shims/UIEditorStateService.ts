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

    public getEnteredState(): null {
        return null;
    }

    public setEnteredState(): void {
        /* Preview runtime never enters a state: it shows what the game resolves. */
    }

    public on(): Unsubscribe {
        return () => undefined;
    }
}

const instance = new RuntimeUIEditorStateService();

export { RuntimeUIEditorStateService as UIEditorStateService };
