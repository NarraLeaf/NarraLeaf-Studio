import { useEffect, useMemo, useState } from "react";
import type { ProjectTransformPreset } from "@shared/types/transformPreset";
import { Services } from "@/lib/workspace/services/services";
import type { TransformPresetService } from "@/lib/workspace/services/transformPreset/TransformPresetService";
import { useWorkspace } from "@/apps/workspace/context";

const NONE: readonly ProjectTransformPreset[] = [];

/**
 * The transforms this project saved, and the service that owns them.
 *
 * Two callers with the same need: the transform card's menu writes the list, and the preset dropdown
 * above it reads it. Both are drawn per open row, so the list is subscribed rather than polled - a
 * preset saved from one row appears in the dropdown of every other row already on screen.
 *
 * `service` is null in a workspace that has none (the character editor's preview host, a recovery
 * workspace), and the surfaces read that as "the project cannot hold presets right now" rather than
 * as an empty list they could add to.
 */
export function useTransformPresets(): {
    presets: readonly ProjectTransformPreset[];
    service: TransformPresetService | null;
} {
    const { context, isInitialized } = useWorkspace();
    const service = useMemo<TransformPresetService | null>(() => {
        if (!context || !isInitialized) {
            return null;
        }
        return context.services.get<TransformPresetService>(Services.TransformPreset);
    }, [context, isInitialized]);

    const [presets, setPresets] = useState<readonly ProjectTransformPreset[]>(NONE);

    useEffect(() => {
        if (!service) {
            setPresets(NONE);
            return;
        }
        const sync = () => {
            try {
                setPresets(service.listPresets());
            } catch {
                // A recovery-mode workspace never loaded the document, which reads the same as a
                // project that has saved no presets.
                setPresets(NONE);
            }
        };
        sync();
        return service.onPresetsChanged(sync);
    }, [service]);

    return { presets, service };
}
