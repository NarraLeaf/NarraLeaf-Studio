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
    tooltip,
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
    tooltip?: string;
    children: React.ReactNode;
}) {
    return (
        <section className="flex items-start justify-between gap-3 rounded-md border border-edge bg-fill-subtle p-3" data-tip={tooltip}>
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

/**
 * {@link SettingShell}, but with the control on its own line underneath the label.
 *
 * The side-by-side shell is right for a switch or a two-digit number, and wrong for anything that
 * wants the width - a text field, a select whose options are track names. In a 318px panel those
 * end up at their min-content width beside the label and read as broken. Same frame, same title and
 * description, so a stacked row and a beside row still read as one surface.
 *
 * `[&>*]:min-w-0` is load-bearing rather than defensive: a grid item's `min-width` defaults to
 * min-content, and an `<input>` contributes its intrinsic `size` attribute width (~258px) to that -
 * which `min-w-0` on the input itself does NOT remove from its parent's contribution. Without the
 * clamp that number propagates up through every ungated grid to the panel, which is how this
 * surface once came to be 512px wide inside a 318px panel.
 */
export function SettingStack({
    title,
    description,
    hint,
    tooltip,
    children,
}: {
    title: string;
    description: string;
    hint?: string;
    tooltip?: string;
    children: React.ReactNode;
}) {
    return (
        <section className="grid gap-2 rounded-md border border-edge bg-fill-subtle p-3 [&>*]:min-w-0" data-tip={tooltip}>
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
        <SettingShell title={title} description={description} hint={hint} tooltip={frozen["data-tip"]}>
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
