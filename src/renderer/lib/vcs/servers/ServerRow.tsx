import React from "react";

import { CONTROL_HEIGHT_CLASS, type ControlSize } from "@/lib/components/elements";
import { cn } from "@/lib/utils/cn";
import type { VcsServerSession } from "@shared/types/vcs";
import { serverDisplayName, serverHost } from "./serverIdentity";

/**
 * One server, as a row.
 *
 * Three screens draw this list and each drew it differently: one showed the address as
 * the heading, one showed it as a chip, and none of them showed the name the server gave
 * when it was added. A person handed `team.example.lan` in a chat message then had to
 * recognise it as a port number in three places, spelled three ways.
 *
 * So the row is one component and the three contexts are props. What changes between them
 * is real - a row that can be chosen answers a click and says whether it is the current
 * one; a row in a wrapping strip has space for a name and nothing else - and what does
 * not change is the order things are read in: the name, then the address under it, then
 * whose account this is.
 *
 * **The address stays visible.** It is the identity every project, session and acceptance
 * script is keyed on, and a name is a label a deployment can change; a row that showed
 * only the name would be a row nobody can match against a project's remote. It is only
 * dropped where it would be printed twice - a server that gave no name reads as its
 * address, and that address is not repeated beneath itself.
 *
 * Attributes reach the root element, so a caller marks its own row: `data-servers-row`
 * in Settings, `data-server-choice` where the row is one of several.
 */
export interface ServerRowProps extends Omit<React.HTMLAttributes<HTMLElement>, "onSelect"> {
    session: VcsServerSession;
    /** Present when this row is one of several to choose between; it then answers a click. */
    onChoose?: () => void;
    /** Drawn as the current choice. Only meaningful alongside {@link onChoose}. */
    chosen?: boolean;
    /** The name alone, at chip width, for a wrapping strip with no room for an account. */
    compact?: boolean;
    /** Height, from the one control scale. */
    size?: ControlSize;
    /** Controls that belong to this server, at the end of the row. Not for a chooseable row. */
    trailing?: React.ReactNode;
}

export function ServerRow({
    session,
    onChoose,
    chosen = false,
    compact = false,
    size = "md",
    trailing,
    className,
    ...rest
}: ServerRowProps) {
    const name = serverDisplayName(session);
    const host = serverHost(session.remoteOrigin);

    const shell = cn(
        "flex items-center gap-3 rounded-md text-left text-fg-muted transition-colors duration-150 cursor-default",
        CONTROL_HEIGHT_CLASS[size],
        compact ? "px-2" : "w-full px-3",
        onChoose && !compact && (chosen
            ? "border border-primary bg-fill-subtle text-fg"
            : "border border-edge hover:bg-fill"),
        onChoose && compact && (chosen ? "bg-fill text-fg" : "hover:bg-fill hover:text-fg"),
        !onChoose && "hover:bg-fill-subtle",
        className,
    );

    const body = (
        <>
            <span className={cn("min-w-0", compact ? "" : "flex-1")}>
                <span
                    className={cn("block truncate", compact ? "text-xs" : "text-sm")}
                    data-tip={session.authUrl}
                >
                    {name}
                </span>
                {!compact && name !== host && (
                    <span className="block truncate text-2xs text-fg-subtle">{host}</span>
                )}
            </span>
            {!compact && (
                <span className="shrink-0 text-xs text-fg-subtle" data-tip={session.account.identity}>
                    {session.account.displayName}
                </span>
            )}
            {trailing}
        </>
    );

    if (onChoose) {
        return (
            <button type="button" aria-pressed={chosen} onClick={onChoose} className={shell} {...rest}>
                {body}
            </button>
        );
    }

    return (
        <div className={shell} {...rest}>
            {body}
        </div>
    );
}
