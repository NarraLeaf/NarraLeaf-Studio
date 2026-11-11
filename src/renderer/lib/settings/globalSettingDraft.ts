export type SettingDraftSnapshot<T> = { value: T; failed: boolean; saving: boolean };

/** One editable preference: ordered writes, confirmed storage and an independently held draft. */
export class GlobalSettingDraft<T> {
    private snapshot: SettingDraftSnapshot<T>;
    private confirmed: string;
    private revision = 0;
    private pending: string | null = null;
    private active = true;
    private listeners = new Set<() => void>();

    constructor(
        initial: T,
        private readonly normalize: (value: T) => T,
        private readonly write: (value: T) => Promise<void>,
    ) {
        this.snapshot = { value: initial, failed: false, saving: false };
        this.confirmed = this.signature(initial);
    }

    public getSnapshot = (): SettingDraftSnapshot<T> => this.snapshot;
    public subscribe = (listener: () => void): (() => void) => {
        this.listeners.add(listener);
        return () => { this.listeners.delete(listener); };
    };

    public receive(value: T): void {
        const signature = this.signature(value);
        if (signature === this.pending) return;
        const dirty = this.signature(this.snapshot.value) !== this.confirmed;
        const changed = signature !== this.confirmed;
        this.confirmed = signature;
        if (changed && !dirty && !this.snapshot.saving) {
            this.publish({ value, failed: false, saving: false });
        }
    }

    public edit = (value: T): void => {
        this.revision += 1;
        this.publish({ ...this.snapshot, value, failed: false });
        void this.flush();
    };

    public retry = (): void => { void this.flush(); };
    public activate(): void { this.active = true; }
    public dispose(): void { this.active = false; }

    private signature(value: T): string { return JSON.stringify(this.normalize(value)); }
    private publish(snapshot: SettingDraftSnapshot<T>): void {
        this.snapshot = snapshot;
        for (const listener of this.listeners) listener();
    }

    private async flush(): Promise<void> {
        if (!this.active || this.snapshot.saving) return;
        while (this.active) {
            const value = this.normalize(this.snapshot.value);
            const signature = this.signature(value);
            if (signature === this.confirmed) {
                this.publish({ ...this.snapshot, failed: false, saving: false });
                return;
            }
            const revision = this.revision;
            this.pending = signature;
            this.publish({ ...this.snapshot, failed: false, saving: true });
            try {
                await this.write(value);
                this.confirmed = signature;
            } catch {
                if (revision === this.revision) {
                    this.publish({ ...this.snapshot, failed: true, saving: false });
                    return;
                }
            } finally {
                this.pending = null;
            }
            this.publish({ ...this.snapshot, saving: false });
        }
    }
}
