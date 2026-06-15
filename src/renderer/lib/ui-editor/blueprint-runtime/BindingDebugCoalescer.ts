/**
 * Suppress duplicate binding/state debug emissions when React re-renders without value changes.
 */

export class BindingDebugCoalescer {
    private readonly lastBinding = new Map<string, string>();
    private readonly lastStateRead = new Map<string, string>();

    public shouldEmitBindingEval(bindingId: string, resolved: unknown): boolean {
        const sig = stableSerialize(resolved);
        if (this.lastBinding.get(bindingId) === sig) {
            return false;
        }
        this.lastBinding.set(bindingId, sig);
        return true;
    }

    public shouldEmitStateRead(key: string, raw: unknown): boolean {
        const sig = stableSerialize(raw);
        if (this.lastStateRead.get(key) === sig) {
            return false;
        }
        this.lastStateRead.set(key, sig);
        return true;
    }
}

function stableSerialize(value: unknown): string {
    if (value === undefined) {
        return "__u";
    }
    if (value === null) {
        return "__n";
    }
    if (typeof value === "object") {
        try {
            return JSON.stringify(value);
        } catch {
            return String(value);
        }
    }
    return `${typeof value}:${String(value)}`;
}
