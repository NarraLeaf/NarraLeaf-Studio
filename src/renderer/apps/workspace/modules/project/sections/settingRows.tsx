/**
 * The row frame every project setting shares. Shared by the Settings and Game
 * sub-pages so a setting reads the same wherever it lives, and so a new group
 * costs a list of rows rather than a new layout.
 */

import { HintPopover, Switch } from "@/lib/components/elements";
import { useFreezeGuard } from "@/apps/workspace/components/ui/freezeGuard";

export function SettingShell({
    title,
    description,
    hint,
    titleAttr,
    children,
}: {
    title: string;
    description: string;
    /** Optional caveat shown behind a small info icon next to the title. */
    hint?: string;
    /**
     * Hover text for the whole row. The freeze reason goes here rather than on the control, because a
     * `disabled` switch or select never reports a hover of its own on every platform.
     */
    titleAttr?: string;
    children: React.ReactNode;
}) {
    return (
        <section className="flex items-start justify-between gap-3 rounded-md border border-edge bg-fill-subtle p-3" title={titleAttr}>
            <div className="min-w-0">
                <div className="flex items-center gap-1.5 text-sm font-medium text-fg">
                    <span>{title}</span>
                    {hint && <HintPopover text={hint} />}
                </div>
                <div className="mt-1 text-2xs leading-relaxed text-fg-subtle">{description}</div>
            </div>
            {children}
        </section>
    );
}

export function SettingRow({
    title,
    description,
    hint,
    checked,
    loading,
    disabled,
    onChange,
}: {
    title: string;
    description: string;
    hint?: string;
    checked: boolean;
    loading: boolean;
    disabled?: boolean;
    onChange: (value: boolean) => void;
}) {
    // Every project setting writes `project.json`, so the whole surface goes read-only together. Read
    // here rather than in each section so a new setting row is frozen the day it is added.
    const freeze = useFreezeGuard();
    const frozen = freeze.writes(disabled);
    return (
        <SettingShell title={title} description={description} hint={hint} titleAttr={frozen.title}>
            <Switch
                size="sm"
                checked={checked}
                loading={loading}
                disabled={frozen.disabled}
                onCheckedChange={onChange}
                aria-label={title}
            />
        </SettingShell>
    );
}
