import { useCallback, useEffect, useRef, useState } from "react";

import { getInterface } from "@/lib/app/bridge";
import type { VcsServerSession } from "@shared/types/vcs";

/**
 * The servers this installation is signed in to, read once and shared by everything that
 * shows them.
 *
 * Three screens list servers - Settings, the version rail's picker and the project
 * wizard - and each of them used to keep its own state, its own effect and its own idea
 * of what a failed read means. They agreed by accident, which is the kind of agreement
 * that ends the first time one of them is edited.
 *
 * The read itself is local: `listServers` opens no socket, so this costs a message and is
 * safe to ask on mount. A failure is an empty list rather than a state of its own - there
 * is nothing an author does about a bridge that did not answer, and a screen that says so
 * is a screen with a second empty state in it.
 */
export interface ServersState {
    servers: VcsServerSession[];
    /** True until the first read comes back, so an empty list is not drawn as none. */
    loading: boolean;
    /**
     * Read the list again, and hand back what it said.
     *
     * The list is returned as well as stored because a caller often has to decide
     * something from it in the same breath - which row to open on, whether there is only
     * one - and deciding that from state means deciding it a render late.
     */
    reload: () => Promise<VcsServerSession[]>;
}

export function useServers(): ServersState {
    const [servers, setServers] = useState<VcsServerSession[]>([]);
    const [loading, setLoading] = useState(true);
    // Which read is the current one. Two reads can be in flight - a panel that reloads
    // while its first answer is still coming - and the older one must not land last.
    const latest = useRef(0);

    const reload = useCallback(async (): Promise<VcsServerSession[]> => {
        const ticket = latest.current + 1;
        latest.current = ticket;
        const result = await getInterface().vcs.listServers().catch(() => null);
        const list = result?.success ? result.data.servers : [];
        if (ticket === latest.current) {
            setServers(list);
            setLoading(false);
        }
        return list;
    }, []);

    useEffect(() => {
        void reload();
    }, [reload]);

    return { servers, loading, reload };
}
