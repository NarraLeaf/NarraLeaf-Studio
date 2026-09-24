import { useCallback, useMemo, useRef, useState } from "react";
import type { ProjectConfig } from "@/lib/workspace/project/project";
import type { ProjectSectionProps } from "./types";

export type ConfigSlice<T extends object> = {
    /** What the rows show: the stored value, with every change still on its way to disk laid over it. */
    value: T;
    /**
     * Send a change. Never refused and never waited for - see {@link useConfigSlice} - and settled on
     * its own: on success the panel's config moves on, on failure the author is told and the fields it
     * named go back to what the manifest holds.
     */
    commit: (patch: Partial<T>) => Promise<void>;
};

/**
 * One part of the project config as a project-settings section edits it.
 *
 * ## Nothing here waits for a write
 *
 * Each section used to keep a `saving` flag for the write in flight, grey its controls with it and
 * refuse a second change until the first had landed. Both halves lost the author's gesture. A control
 * that turns `disabled` between mousedown and mouseup is never sent the click at all, so a second
 * switch pressed right after a first did nothing and said nothing; and a control that stayed live
 * handed its change to a commit that returned early, which left a number field showing a value that
 * was never stored. The window in which that happens is a few tens of milliseconds, and it drifts
 * with load, which is why it read as an intermittent fault rather than a design.
 *
 * So a change is shown at once and sent at once, however many are already on their way. What keeps
 * that safe is the service, not this hook: `ProjectService.updateProjectConfig` runs one manifest
 * write at a time, each against the manifest the one before it left, so every change lands and they
 * land in the order the author made them. The panel's config, and with it `stored`, follows each
 * write as it lands.
 *
 * ## What is shown while writes are in flight
 *
 * A field shows the last value the author gave it until the write carrying that value settles. A
 * counter per field says which write is the latest, so an earlier one landing (or failing) late
 * neither drops the newer value back to the older one nor clears it before its own write has
 * answered - the same rule the Settings window's rows follow.
 *
 * When the latest write for a field fails, the author is told through the notification every
 * section already used, and the field shows `stored` again. `stored` comes from the panel's config,
 * which only ever moves to a manifest that was written, so that is the value on disk.
 */
export function useConfigSlice<T extends object>({
    stored,
    write,
    onConfigChange,
    uiService,
    normalize,
}: {
    /** The slice as the panel's config holds it. Memoise it on that config. */
    stored: T;
    write: (patch: Partial<T>) => Promise<ProjectConfig>;
    onConfigChange: ProjectSectionProps["onConfigChange"];
    uiService: ProjectSectionProps["uiService"];
    /**
     * Applied to the merged value, for a slice whose fields depend on one another (a network policy
     * decides whether HTTP is allowed). Pass a stable function.
     */
    normalize?: (value: T) => T;
}): ConfigSlice<T> {
    const [pending, setPending] = useState<Partial<T>>({});
    const generations = useRef(new Map<keyof T, number>());
    // The callbacks a write settles through, as of the latest render: a write outlives the render
    // that started it, and the section may have been handed new ones since.
    const latest = useRef({ write, onConfigChange, uiService });
    latest.current = { write, onConfigChange, uiService };

    const commit = useCallback(async (patch: Partial<T>) => {
        const tokens = (Object.keys(patch) as (keyof T)[]).map(key => {
            const token = (generations.current.get(key) ?? 0) + 1;
            generations.current.set(key, token);
            return [key, token] as const;
        });
        setPending(current => ({ ...current, ...patch }));

        const settle = () => {
            const settled = tokens
                .filter(([key, token]) => generations.current.get(key) === token)
                .map(([key]) => key);
            if (settled.length === 0) {
                return;
            }
            setPending(current => {
                const next = { ...current };
                for (const key of settled) {
                    delete next[key];
                }
                return next;
            });
        };

        try {
            const updated = await latest.current.write(patch);
            // In the same turn as `settle`, so the stored value arrives in the render that drops the
            // pending one and the field never shows the value from before the write.
            latest.current.onConfigChange(updated);
            settle();
        } catch (error) {
            settle();
            latest.current.uiService?.showNotification(error instanceof Error ? error.message : String(error), "error");
        }
    }, []);

    const value = useMemo(() => {
        const merged = { ...stored, ...pending } as T;
        return normalize ? normalize(merged) : merged;
    }, [normalize, pending, stored]);

    return { value, commit };
}
