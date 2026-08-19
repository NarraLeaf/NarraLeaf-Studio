import { useEffect, useState } from "react";
import { getInterface } from "@/lib/app/bridge";
import { EMPTY_STUDIO_TASK_OVERVIEW, type StudioTaskOverview } from "@shared/types/studioTask";

/**
 * What Studio is working on, polled.
 *
 * Polled rather than pushed for the reason every long task here is: the work belongs to main and
 * outlives any single render, so a window that reloaded mid-bake has to be able to ask what is going
 * on rather than having missed the announcement.
 *
 * Two intervals, because the cost and the value are not the same in both states. While something is
 * running the readout is worth keeping current; while nothing is, this is a poll whose answer is
 * "nothing" forever, and doing that every half second for the life of the window buys nothing.
 */
const ACTIVE_POLL_MS = 400;
const IDLE_POLL_MS = 2000;

export function useStudioTasks(): StudioTaskOverview {
    const [overview, setOverview] = useState<StudioTaskOverview>(EMPTY_STUDIO_TASK_OVERVIEW);

    useEffect(() => {
        let cancelled = false;
        let timer: ReturnType<typeof setTimeout> | null = null;

        const poll = async () => {
            const result = await getInterface().studioTasks.getOverview().catch(() => null);
            if (cancelled) {
                return;
            }
            const next = result && result.success ? result.data.overview : EMPTY_STUDIO_TASK_OVERVIEW;
            setOverview(next);
            // The next interval follows what was just seen, so the readout speeds up the moment
            // something starts and settles back down on its own.
            timer = setTimeout(() => void poll(), next.active ? ACTIVE_POLL_MS : IDLE_POLL_MS);
        };

        void poll();
        return () => {
            cancelled = true;
            if (timer) {
                clearTimeout(timer);
            }
        };
    }, []);

    return overview;
}
