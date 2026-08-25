import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "@/lib/i18n";
import { useOptionalWorkspace } from "@/apps/workspace/context";
import { Services } from "@/lib/workspace/services/services";
import { VersionControlService } from "@/lib/workspace/services/core/VersionControlService";
import { LocalizationService } from "@/lib/workspace/services/localization/LocalizationService";
import { AssetBytesSourceContext, type AssetBytesSource } from "@/lib/ui-editor/assets/assetBytesSource";
import { comparisonSideKey, type ComparisonSide } from "./comparisonSide";
import { CanvasNote } from "./canvasShell";
import { drawRefusalsAsPlaceholders } from "./versionedAssetPlaceholder";
import {
    createVersionedAssetBytesSource,
    type VersionedAssetRefusal,
} from "./versionedAssetBytes";

/**
 * One column's pictures, bound to that column's version.
 *
 * The counterpart to `useSideDocument`: that hook reads the document a column draws, this one reads
 * every file inside it. Both sides of a comparison mount one of these, and they must be separate
 * sources with separate ids - two columns resolving through one source would draw one version's
 * pictures under both versions' layouts, which is the exact substitution this feature exists to
 * remove.
 *
 * **Held in state rather than in a memo.** The source owns a cache and is disposed when the pane
 * moves off it; a value built during render is built twice under React's development double-render
 * and the second copy would be the one nothing disposes. Building it in the effect that also
 * disposes it keeps those two facts in one place, at the cost of one extra render per side.
 */

/** How many assets one column could not draw, by why. */
export interface AssetRefusalCounts {
    /** Not in the project at that version at all. A fact about the version. */
    readonly absent: number;
    /** There was a record, and the file behind it could not be read. A fault. */
    readonly failed: number;
}

const NO_REFUSALS: AssetRefusalCounts = { absent: 0, failed: 0 };

export interface VersionedAssets {
    /** Mounted over the column. Null for a side that holds nothing, which resolves live nowhere. */
    readonly source: AssetBytesSource | null;
    readonly refusals: AssetRefusalCounts;
}

const NO_ASSETS: VersionedAssets = { source: null, refusals: NO_REFUSALS };

export function useVersionedAssets(side: ComparisonSide | null): VersionedAssets {
    const context = useOptionalWorkspace()?.context ?? null;
    const service = useMemo(
        () => (context ? context.services.get<VersionControlService>(Services.VersionControl) : null),
        [context],
    );

    /**
     * The language the editor previews in.
     *
     * Read live and on purpose - it is a property of the person looking rather than of the version
     * being looked at. Read defensively for the reason every other reader of this service gives:
     * a comparison pane renders in windows that carry only part of the service set.
     */
    const previewLocale = useMemo(() => {
        if (!context) {
            return null;
        }
        try {
            return context.services
                .get<LocalizationService>(Services.Localization)
                .getConfiguration().sourceLocale || null;
        } catch {
            return null;
        }
    }, [context]);

    const [held, setHeld] = useState<VersionedAssets>(NO_ASSETS);

    const key = comparisonSideKey(side);
    const revision = side?.at === "revision" ? side.revision : null;

    useEffect(() => {
        if (!service || !side) {
            setHeld(NO_ASSETS);
            return;
        }

        const inner = createVersionedAssetBytesSource({
            id: key,
            previewLocale,
            read: path => (revision === null
                ? service.readWorkingFile(path)
                : service.readBlob(revision, path)),
            onRefusal: (_assetId: string, kind: VersionedAssetRefusal) => {
                // Once per asset id: the source's cache answers a repeated ask from its own row and
                // never resolves it twice, so a background shared by twelve widgets counts once.
                setHeld(current => ({
                    ...current,
                    refusals: { ...current.refusals, [kind]: current.refusals[kind] + 1 },
                }));
            },
        });

        setHeld({ source: drawRefusalsAsPlaceholders(inner), refusals: NO_REFUSALS });

        return () => {
            inner.dispose();
            setHeld(NO_ASSETS);
        };
        // `side` itself is excluded on purpose: it is written as an object literal at the call
        // sites, and `key` plus `revision` carry everything about it that changes a read.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [service, key, revision, previewLocale]);

    return held;
}

/**
 * One column, with its own version's files behind every picture in it.
 *
 * Wrapping rather than passing the source down as a prop, because what reads it is
 * `useAssetObjectUrl` inside whatever widget the page happens to hold - a text input's background,
 * a list row's icon, a dialogue avatar - and none of those are things a presenter names.
 */
export function VersionedAssetsProvider({
    source,
    children,
}: {
    readonly source: AssetBytesSource | null;
    readonly children: ReactNode;
}) {
    return (
        <AssetBytesSourceContext.Provider value={source}>
            {children}
        </AssetBytesSourceContext.Provider>
    );
}

/**
 * The pictures on screen that are not this version's, in one line and never in silence.
 *
 * The mark drawn in the widget's place says that something is not being shown; it has no room for
 * words, because a page scaled into half a comparison pane draws most of its widgets at twenty
 * pixels. This is where the words are, and the two reasons stay apart because the author's next
 * move differs: an asset imported after that version is nothing to look into, and a file that would
 * not read is.
 *
 * Counted across both columns, which is why the same replaced background can be counted twice - it
 * is two refusals, one per version, and an author reading "1" would look for one mark and find two.
 */
export function RefusedAssetsNote({ sides }: { readonly sides: readonly AssetRefusalCounts[] }) {
    const { t, tn } = useTranslation();
    const absent = sides.reduce((total, side) => total + side.absent, 0);
    const failed = sides.reduce((total, side) => total + side.failed, 0);
    if (absent + failed === 0) {
        return null;
    }
    const parts: string[] = [];
    if (absent > 0) {
        parts.push(t("documentDiff.canvas.assetsAbsent", { count: absent }));
    }
    if (failed > 0) {
        parts.push(t("documentDiff.canvas.assetsFailed", { count: failed }));
    }
    return (
        <CanvasNote tone={failed > 0 ? "danger" : "muted"}>
            {tn("documentDiff.canvas.assetsNotShown", absent + failed)} {parts.join(" · ")}
        </CanvasNote>
    );
}
