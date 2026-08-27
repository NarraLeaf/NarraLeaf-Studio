// @vitest-environment jsdom
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Services } from "@/lib/workspace/services/services";
import { isAssetRefusalPlaceholder } from "./versionedAssetPlaceholder";
import { useVersionedAssets } from "./useVersionedAssets";

/**
 * The wiring between a column and its version, which is where the substitution would come back.
 *
 * `versionedAssetBytes.test.ts` pins that a source reads whatever revision it was built over. What
 * is pinned here is the step before it: that the two columns get two SOURCES, each carrying its own
 * side, so the same asset id is asked of two different revisions. One source shared between the
 * columns would pass every test in that file and still draw one version's pictures under both
 * versions' layouts - the exact failure this feature exists to remove.
 */

/** The path `BACKGROUND`'s id alone determines. Both columns must ask for this one. */
const BACKGROUND = "11111111-1111-4111-8111-111111111111";
const BACKGROUND_PATH = "assets/content/11/11/1111111141118111111111111111";
const IMAGE_SHARD = "assets/assets.metadata.image.json";

function utf8(text: string): Uint8Array {
    return new TextEncoder().encode(text);
}

function filled(value: number): Uint8Array {
    return new Uint8Array(4).fill(value);
}

const SHARD = utf8(JSON.stringify({ [BACKGROUND]: { id: BACKGROUND, type: "image", tags: [] } }));

/** The repository, as what each revision holds. The working tree is a revision like any other. */
const repository: Record<string, Record<string, Uint8Array>> = {
    "rev-old": { [IMAGE_SHARD]: SHARD, [BACKGROUND_PATH]: filled(1) },
    "rev-new": { [IMAGE_SHARD]: SHARD, [BACKGROUND_PATH]: filled(2) },
    "working-tree": { [IMAGE_SHARD]: SHARD, [BACKGROUND_PATH]: filled(3) },
};

const readBlob = vi.fn(async (revision: string, path: string) => {
    const held = repository[revision]?.[path];
    if (!held) {
        throw new Error(`path not in ${revision}: ${path}`);
    }
    return held;
});

const readWorkingFile = vi.fn(async (path: string) => readBlob("working-tree", path));

// The canvas frame pulls in the whole change-detail tree, and none of it is what this file is
// about; the note it draws is a `div` for these purposes.
vi.mock("./canvasShell", () => ({
    CanvasNote: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/lib/i18n", () => ({
    useTranslation: () => ({ t: (key: string) => key, tn: (key: string) => key, has: () => false, locale: "en" }),
}));

/**
 * One workspace value for the whole file, handed back by identity - the hook holds `context` in a
 * memo's dependency list, and a fresh object per render would rebuild the source every render.
 */
vi.mock("@/apps/workspace/context", () => {
    const workspace = {
        isInitialized: true,
        context: {
            services: {
                get: (service: Services) => {
                    if (service === Services.VersionControl) {
                        return { readBlob, readWorkingFile };
                    }
                    if (service === Services.Localization) {
                        return { getConfiguration: () => ({ sourceLocale: "en" }) };
                    }
                    throw new Error(`Service ${service} not found`);
                },
            },
        },
    };
    return { useOptionalWorkspace: () => workspace };
});

beforeEach(() => {
    readBlob.mockClear();
    readWorkingFile.mockClear();
});

function bothColumns(before: string, after: string) {
    return renderHook(() => ({
        before: useVersionedAssets({ at: "revision", revision: before }),
        after: useVersionedAssets({ at: "revision", revision: after }),
    }));
}

describe("useVersionedAssets", () => {
    it("asks two revisions for the same asset id, and each column draws its own version's bytes", async () => {
        const { result } = bothColumns("rev-old", "rev-new");
        await waitFor(() => expect(result.current.after.source).not.toBeNull());

        const drawnBefore = await result.current.before.source!.read(BACKGROUND, "image");
        const drawnAfter = await result.current.after.source!.read(BACKGROUND, "image");

        expect(drawnBefore).toMatchObject({ kind: "bytes", bytes: filled(1) });
        expect(drawnAfter).toMatchObject({ kind: "bytes", bytes: filled(2) });
        expect(drawnBefore).not.toEqual(drawnAfter);

        // The central assertion: one path, two revisions. Two columns sharing a source would show
        // one of these lines twice.
        expect(readBlob.mock.calls.filter(([, path]) => path === BACKGROUND_PATH)).toEqual([
            ["rev-old", BACKGROUND_PATH],
            ["rev-new", BACKGROUND_PATH],
        ]);
        expect(result.current.before.source!.id).not.toBe(result.current.after.source!.id);
    });

    it("reads the working tree off disk rather than out of the repository", async () => {
        const { result } = renderHook(() => useVersionedAssets({ at: "working-tree" }));
        await waitFor(() => expect(result.current.source).not.toBeNull());

        expect(await result.current.source!.read(BACKGROUND, "image")).toMatchObject({ bytes: filled(3) });
        expect(readWorkingFile).toHaveBeenCalledWith(BACKGROUND_PATH);
    });

    it("has no source for a side that does not exist, so that column resolves nowhere", () => {
        const { result } = renderHook(() => useVersionedAssets(null));

        expect(result.current.source).toBeNull();
        expect(readBlob).not.toHaveBeenCalled();
    });

    it("draws a mark for an asset the version does not hold, and counts it", async () => {
        const { result } = renderHook(() => useVersionedAssets({ at: "revision", revision: "rev-old" }));
        await waitFor(() => expect(result.current.source).not.toBeNull());

        const drawn = await result.current.source!.read("55555555-5555-4555-8555-555555555555", "image");

        // Bytes, not a blank: the mounted source substitutes the refusal mark, so the widget shows
        // "this cannot honestly be drawn" rather than an empty fill.
        expect(drawn.kind).toBe("bytes");
        expect(isAssetRefusalPlaceholder(drawn)).toBe(true);
        await waitFor(() => expect(result.current.refusals).toEqual({ absent: 1, failed: 0 }));
    });
});
