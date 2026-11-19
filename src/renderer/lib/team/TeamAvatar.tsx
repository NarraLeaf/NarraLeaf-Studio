import { useEffect, useState } from "react";

import { nameInitials, nameMonogramColor } from "@/lib/components/monogram";
import { cn } from "@/lib/utils/cn";
import { readAvatar } from "./teamCall";

/**
 * An account's face: its avatar where it set one and it could be read, its monogram otherwise.
 *
 * The monogram is the same coloured initials the account wears everywhere else in Studio, drawn
 * from `name`, so the fallback is never a stranger. Each caller passes the name it already keys
 * that monogram on - the title bar the username, the server roster the display name - so a
 * person without an avatar looks the same here as before one was ever drawn.
 *
 * Shared by the workspace's title bar and the launcher's server roster: a face read in one is a
 * face either can draw, and the two must not disagree about what an account looks like.
 */
export function TeamAvatar({ remoteOrigin, name, avatarUrl, className }: {
    remoteOrigin: string;
    /** What the monogram is drawn from while there is no image. */
    name: string;
    /** The server's path for the avatar, absent for an account that set none. */
    avatarUrl?: string;
    className?: string;
}) {
    const src = useTeamAvatarImage(remoteOrigin, avatarUrl);
    return (
        <span
            className={cn(
                "flex shrink-0 items-center justify-center overflow-hidden rounded-full text-2xs font-medium text-white",
                className,
            )}
            style={src === null ? { backgroundColor: nameMonogramColor(name) } : undefined}
        >
            {src === null
                ? nameInitials(name)
                : <img src={src} alt="" draggable={false} className="h-full w-full object-cover" />}
        </span>
    );
}

/**
 * Avatars, remembered for as long as the window is open.
 *
 * An avatar's path is its content hash, so a remembered image can never be out of date.
 */
const avatarImages = new Map<string, Promise<string | null>>();

/** An avatar as an `<img>` source, or null while it is being read, if there is none, or if it failed. */
export function useTeamAvatarImage(remoteOrigin: string, avatarUrl: string | undefined): string | null {
    const [src, setSrc] = useState<string | null>(null);
    useEffect(() => {
        setSrc(null);
        if (avatarUrl === undefined) return;
        const key = `${remoteOrigin}\n${avatarUrl}`;
        let reading = avatarImages.get(key);
        if (reading === undefined) {
            reading = readAvatar(remoteOrigin, avatarUrl).then((value) => {
                // A failed read is not remembered: the server may only have been away.
                if (value === null) avatarImages.delete(key);
                return value;
            });
            avatarImages.set(key, reading);
        }
        let alive = true;
        void reading.then((value) => {
            if (alive) setSrc(value);
        });
        return () => {
            alive = false;
        };
    }, [remoteOrigin, avatarUrl]);
    return src;
}
