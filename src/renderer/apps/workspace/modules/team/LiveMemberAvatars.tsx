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
 * **Overlapped rather than spaced**, because the two places it is drawn are both short of room: a
 * title bar beside four 32px buttons, and the 48px frozen strip. Past {@link LIMIT} the rest become
 * a count, which is the one thing a truncated row of faces cannot say.
 *
 * **Vertical in the strip.** During a session the stack lives on the strip rather than in the title
 * bar - the strip is already the session's own column and it is drawn for the whole of one, while
 * the top bar is the scarcest row in the window on a small screen.
 *
 * The host wears a ring rather than a place in the order: the order is the room's own, and
 * re-sorting it would move faces around as people arrive and leave.
 */

/** How many faces are drawn before the rest become a number. */
const LIMIT = 3;

export function LiveMemberAvatars({ members, host, size = "sm", vertical, className }: {
    members: readonly TeamLiveMember[];
    /** The account that opened the room, or null where the room does not say. */
    host?: string | null;
    /** `sm` for the title bar and the strip, `md` for a panel row. */
    size?: "sm" | "md";
    /** Stacked downwards, for the frozen strip's 48px column. */
    vertical?: boolean;
    className?: string;
}) {
    const shown = members.slice(0, LIMIT);
    const rest = members.length - shown.length;
    const box = size === "sm" ? "h-5 w-5" : "h-6 w-6";
    // The overlap, in whichever direction the stack runs. `first:` clears it on the leading face so
    // the group starts flush with whatever is beside it.
    const overlap = vertical ? "-mt-1.5 first:mt-0" : "-ml-1.5 first:ml-0";

    return (
        <div
            className={cn("flex items-center", vertical ? "flex-col" : "", className)}
            data-live-avatars={String(members.length)}
        >
            {shown.map((member) => (
                <span
                    key={member.instance}
                    data-live-avatar={member.account}
                    className={cn(
                        // Negative margin on every face but the first: the stack reads as a group
                        // rather than as a list, and it costs a third of the width or the height.
                        "flex shrink-0 items-center justify-center rounded-full",
                        overlap,
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
                        "flex shrink-0 items-center justify-center rounded-full",
                        "bg-fill-strong text-2xs font-medium text-fg-muted ring-1 ring-surface-sunken",
                        overlap,
                        box,
                    )}
                >
                    {`+${rest}`}
                </span>
            )}
        </div>
    );
}
