import type { ReactNode } from "react";

/**
 * One titled part of a project sub-page.
 *
 * The sub-pages hold several parts each now, so a part needs a name of its own. This is that name,
 * and it is a heading - `text-xs` on `fg` - rather than the `FieldLabel` eyebrow used by the groups
 * *inside* a part (the preference groups, the lint categories). Two weights, two levels, and no
 * third: a page that needs a third level is two pages.
 *
 * The hairline belongs above the heading and is dropped on the first group, where it would only
 * double the border the sub-page header already draws. `first:` rather than a prop, so a page that
 * reorders its parts cannot forget to move the flag - which also means every part must be a direct
 * child of the page's grid (a component rendering two parts returns a fragment, not a wrapper).
 *
 * `group/help` on the header row so a `HelpTrigger` passed as `trailing` reveals on hover, the same
 * way a panel header carries one.
 */
export function SettingsGroup({
    title,
    description,
    trailing,
    helpTopic,
    children,
}: {
    title: string;
    /** One line under the heading, for a part whose rows do not say it between them. */
    description?: string;
    /** The part's own actions, on the heading row. */
    trailing?: ReactNode;
    /** Tags the whole part for `F1`. */
    helpTopic?: string;
    children: ReactNode;
}) {
    return (
        <section
            className="grid gap-2.5 border-t border-edge pt-3 first:border-t-0 first:pt-0 [&>*]:min-w-0"
            data-help-topic={helpTopic}
        >
            <div className="group/help flex min-w-0 items-start justify-between gap-2">
                <div className="min-w-0">
                    <h3 className="truncate text-xs font-medium text-fg">{title}</h3>
                    {description ? (
                        <p className="mt-1 text-2xs leading-relaxed text-fg-subtle">{description}</p>
                    ) : null}
                </div>
                {trailing ? <div className="flex shrink-0 items-center gap-1">{trailing}</div> : null}
            </div>
            {children}
        </section>
    );
}
