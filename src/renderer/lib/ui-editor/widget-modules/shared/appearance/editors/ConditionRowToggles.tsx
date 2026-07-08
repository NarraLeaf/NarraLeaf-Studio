import type { AppearanceSystemCondition } from "@shared/types/ui-editor/appearance";

const KEYS: (keyof AppearanceSystemCondition)[] = ["hovered", "active", "disabled", "focused"];

type Props = {
    conditions: AppearanceSystemCondition | null | undefined;
    disabled?: boolean;
    onChange: (next: AppearanceSystemCondition | null) => void;
};

/**
 * When all toggles off, conditions become null (matches any — use only for non-default rows).
 */
export function ConditionRowToggles({ conditions, disabled, onChange }: Props) {
    const c = conditions ?? {};

    const toggle = (key: keyof AppearanceSystemCondition) => {
        const cur = c[key];
        let next: AppearanceSystemCondition = { ...c };
        if (cur === true) {
            next[key] = false;
        } else if (cur === false) {
            delete next[key];
        } else {
            next[key] = true;
        }
        const entries = Object.entries(next).filter(([, v]) => v !== undefined);
        onChange(entries.length ? (next as AppearanceSystemCondition) : null);
    };

    return (
        <div className="flex flex-wrap gap-1.5 items-center text-2xs text-fg-muted">
            <span className="text-fg-subtle mr-1">When</span>
            {KEYS.map(key => {
                const state = c[key];
                const active = state === true || state === false;
                return (
                    <button
                        key={key}
                        type="button"
                        disabled={disabled}
                        title={`Require ${key} = true (cycle: unset → true → false)`}
                        onClick={() => toggle(key)}
                        className={[
                            "rounded px-1.5 py-0.5 border transition",
                            active
                                ? state === true
                                    ? "border-primary/60 bg-primary/15 text-primary"
                                    : "border-amber-500/40 bg-amber-500/10 text-amber-200"
                                : "border-edge bg-fill-subtle text-fg-subtle hover:bg-fill",
                        ].join(" ")}
                    >
                        {key}
                        {active ? (state === true ? "=T" : "=F") : ""}
                    </button>
                );
            })}
        </div>
    );
}
