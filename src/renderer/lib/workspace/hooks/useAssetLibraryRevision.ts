import { useEffect, useMemo, useState } from "react";
import { useOptionalWorkspace } from "@/apps/workspace/context";
import { AssetSetService } from "../services/assets/AssetSetService";
import type { AssetsService } from "../services/core/AssetsService";
import { Services } from "../services/services";

/**
 * A counter that changes whenever an asset id could start naming something else.
 *
 * Asset records are mutated **in place** - a rename writes `existingAsset.name` on the record the
 * library already holds - so every surface that prints an asset name is reading live data and none of
 * them are told when it moves. Whatever they last drew stays on screen until something unrelated
 * re-renders them, which is why the rename appeared to land on hover: the hover was the re-render.
 *
 * Put this in the dependency list of the memo that resolves a name (or read it once in a component
 * that resolves names inline) and the surface redraws with the rest of the project.
 *
 * "Library" here means everything an asset id can name - the files AND the project's asset sets -
 * because that is the unit `resolveAssetDisplayName` answers for. A surface that told the two apart
 * would show a renamed set under its old name in exactly the fields that accept both.
 *
 * Deliberately a bare counter rather than the changed record: the callers each look up a different
 * id in a different pool, and handing them one asset would only tempt a caller into ignoring the
 * others. Returns 0 - a constant, which is the correct key - wherever there is no workspace to ask.
 */
export function useAssetLibraryRevision(): number {
    const workspace = useOptionalWorkspace();
    const context = workspace?.context ?? null;
    const isInitialized = workspace?.isInitialized ?? false;

    const services = useMemo(() => {
        if (!context || !isInitialized) {
            return null;
        }
        // Both are looked up defensively: this hook is called from the shared `@/lib/ui-editor` tree,
        // which also renders in windows that carry a partial service set.
        let assets: AssetsService | null = null;
        let sets: AssetSetService | null = null;
        try {
            assets = context.services.get<AssetsService>(Services.Assets);
        } catch {
            assets = null;
        }
        try {
            sets = context.services.get<AssetSetService>(Services.AssetSets);
        } catch {
            sets = null;
        }
        return assets || sets ? { assets, sets } : null;
    }, [context, isInitialized]);

    const [revision, setRevision] = useState(0);

    useEffect(() => {
        if (!services) {
            return;
        }
        const bump = () => setRevision(current => current + 1);
        const unsubs: (() => void)[] = [];
        if (services.assets) {
            const events = services.assets.getEvents();
            unsubs.push(events.on("updated", bump), events.on("deleted", bump));
        }
        if (services.sets) {
            unsubs.push(services.sets.onSetsChanged(bump));
        }
        // No bump on subscribe. The only gap this hook can have is between a render and its own
        // effect, and the thing that opens it - the service set arriving - re-renders the caller on
        // its own, at which point the name is read live anyway. Bumping here instead would cost one
        // extra render per consumer per mount, and there are hundreds of them on a blueprint canvas.
        return () => unsubs.forEach(unsub => unsub());
    }, [services]);

    return revision;
}
