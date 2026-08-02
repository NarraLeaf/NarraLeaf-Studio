import type { TextDocumentCommands, TextDocumentEntry, TextDocumentStatus } from "./textDocumentStatus";

/**
 * Text Document Status Service
 *
 * The bridge between an open text tab and the workspace status bar: the tab publishes its file name,
 * encoding, line ending and caret here, and the status-bar cells read whichever record belongs to
 * the tab that currently has focus.
 *
 * **Why a service and not props.** The values live in `TextEditor` state and the cells live in
 * `StatusBar`, which is a sibling of the whole editor area - there is no tree between them. Keying
 * on `tabId` rather than holding "the current document" is what makes split views work: two text
 * tabs can be open side by side, each keeps publishing, and deciding which one is being reported on
 * is the cell's job (it asks the layout, which knows about focus across groups) rather than a race
 * between two mounted components.
 *
 * **Deliberately not on `UIStore`.** A caret moves on every keystroke, and `UIStore` broadcasts one
 * `stateChanged` to every subscriber in the workspace. This has its own listener set, so typing in a
 * plan file wakes the four status cells and nothing else.
 */
export class TextDocumentStatusService {
    private documents = new Map<string, TextDocumentEntry>();
    private listeners = new Set<() => void>();

    /**
     * Publish a tab's document. Returns the disposer the tab calls on unmount.
     *
     * The disposer checks identity before deleting: React may mount the next tab before the previous
     * one's cleanup runs, and a blind `delete` would then remove the record that had just replaced
     * it - leaving the status bar permanently blank for a document that is on screen.
     */
    public register(status: TextDocumentStatus, commands: TextDocumentCommands): () => void {
        const entry: TextDocumentEntry = { status, commands };
        this.documents.set(status.tabId, entry);
        this.emit();
        return () => {
            if (this.documents.get(status.tabId) === entry) {
                this.documents.delete(status.tabId);
                this.emit();
            }
        };
    }

    /**
     * Merge new values into a published document. Silently ignores a tab that is not registered -
     * a late update from a tab that has just unmounted is normal, not an error.
     */
    public update(tabId: string, patch: Partial<Omit<TextDocumentStatus, "tabId">>): void {
        const entry = this.documents.get(tabId);
        if (!entry) {
            return;
        }
        this.documents.set(tabId, { commands: entry.commands, status: { ...entry.status, ...patch } });
        this.emit();
    }

    /** Replace a tab's command implementations, which close over state the tab re-creates. */
    public setCommands(tabId: string, commands: TextDocumentCommands): void {
        const entry = this.documents.get(tabId);
        if (!entry) {
            return;
        }
        this.documents.set(tabId, { status: entry.status, commands });
        // No `emit`: the commands are read at click time, never rendered, so waking the cells here
        // would re-render them on every keystroke (the save closure changes with the buffer).
    }

    public get(tabId: string): TextDocumentEntry | undefined {
        return this.documents.get(tabId);
    }

    public has(tabId: string): boolean {
        return this.documents.has(tabId);
    }

    public onChanged(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    private emit(): void {
        for (const listener of [...this.listeners]) {
            listener();
        }
    }
}
