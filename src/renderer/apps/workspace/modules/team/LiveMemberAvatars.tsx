import { cn } from "@/lib/utils/cn";
import { nameInitials, nameMonogramColor } from "@/lib/components/monogram";
import type { TeamLiveMember } from "@shared/types/team";

/**
 * Who is in a room, as a row of overlapping monograms.
 *
 * **The same monogram a member wears everywhere else.** `nameInitials` and `nameMonogramColor`
 * derive both halves from the account name alone, so the person who is a coloured "A" in the
 * server's people list is the same coloured "A" here, with nothing stored and nothing to keep in
 * step.
 *
 * **Overlapped rather than spaced**, because this sits in the title bar beside four 32px buttons
 * and a room of four would otherwise be wider than the whole control cluster. Past {@link LIMIT}
 * the rest become a count, which is the one thing a truncated row of faces cannot say.
 *
 * The host wears a ring rather than a place in the order: the order is the room's own, and
 * re-sorting it would move faces around as people arrive and leave.
 */

/** How many faces are drawn before the rest become a number. */
const LIMIT = 3;

export function LiveMemberAvatars({ members, host, size = "sm", className }: {
    members: readonly TeamLiveMember[];
    /** The account that opened the room, or null where the room does not say. */
    host?: string | null;
    /** `sm` for the title bar, `md` for a panel row. */
    size?: "sm" | "md";
    className?: string;
}) {
    const shown = members.slice(0, LIMIT);
    const rest = members.length - shown.length;
    const box = size === "sm" ? "h-5 w-5" : "h-6 w-6";

    return (
        <div className={cn("flex items-center", className)} data-live-avatars={String(members.length)}>
            {shown.map((member) => (
                <span
                    key={member.instance}
                    data-live-avatar={member.account}
                    className={cn(
                        // Negative margin on every face but the first: the stack reads as a group
                        // rather than as a list, and it costs the title bar a third of the width.
                        "-ml-1.5 flex shrink-0 items-center justify-center rounded-full first:ml-0",
                        "text-2xs font-medium text-white",
                        // A ring in the strip's own colour separates one face from the one beneath
                        // it; the host's is the accent, which is the only role difference here.
                        member.account === host ? "ring-1 ring-primary" : "ring-1 ring-surface-sunken",
                        box,
                    )}
                    style={{ backgroundColor: nameMonogramColor(member.account) }}
                >
                    {nameInitials(member.account)}
                </span>
            ))}
            {rest > 0 && (
                <span
                    data-live-avatar-rest={String(rest)}
                    className={cn(
                        "-ml-1.5 flex shrink-0 items-center justify-center rounded-full",
                        "bg-fill-strong text-2xs font-medium text-fg-muted ring-1 ring-surface-sunken",
                        box,
                    )}
                >
                    {`+${rest}`}
                </span>
            )}
        </div>
    );
}
