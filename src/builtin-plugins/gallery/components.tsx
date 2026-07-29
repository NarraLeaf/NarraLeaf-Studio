/**
 * Small shared pieces for the Gallery panel and editor tab.
 *
 * The asset-URL cache is the notable one. A gallery grid shows dozens of
 * thumbnails at once and the author scrolls through them constantly; creating
 * and revoking an object URL per mount made images flash on every scroll. URLs
 * are therefore created once per asset and held for the session, and revoked in
 * one pass when the plugin unloads (`disposeAssetUrls`). The cache is bounded by
 * the number of distinct images in the gallery, which is the same set the author
 * is looking at.
 */

import { useEffect, useState } from "react";
import { ImageOff, Lock } from "lucide-react";
import { AssetType, ui, type PluginApp } from "narraleaf-studio/plugin";

const urlCache = new Map<string, Promise<string>>();
let disposeApp: PluginApp | null = null;

function assetUrl(app: PluginApp, assetId: string): Promise<string> {
    disposeApp = app;
    const cached = urlCache.get(assetId);
    if (cached) {
        return cached;
    }
    const asset = app.services.assets.get(AssetType.Image, assetId);
    const pending = asset
        ? app.services.assets.createObjectUrl(asset)
        : Promise.reject(new Error(`missing image asset: ${assetId}`));
    urlCache.set(assetId, pending);
    // A failed fetch must not poison the cache forever - the asset may simply
    // not have been imported yet.
    pending.catch(() => urlCache.delete(assetId));
    return pending;
}

/** Release every cached object URL. Call from the plugin's setup cleanup. */
export function disposeAssetUrls(): void {
    const app = disposeApp;
    for (const pending of urlCache.values()) {
        pending.then(url => app?.services.assets.revokeObjectUrl(url)).catch(() => undefined);
    }
    urlCache.clear();
    disposeApp = null;
}

export function useAssetUrl(app: PluginApp, assetId: string | null | undefined): string | null {
    const [url, setUrl] = useState<string | null>(null);

    useEffect(() => {
        if (!assetId) {
            setUrl(null);
            return;
        }
        let disposed = false;
        assetUrl(app, assetId)
            .then(next => {
                if (!disposed) {
                    setUrl(next);
                }
            })
            .catch(() => {
                if (!disposed) {
                    setUrl(null);
                }
            });
        return () => {
            disposed = true;
        };
    }, [app, assetId]);

    return url;
}

export type GalleryThumbProps = {
    app: PluginApp;
    assetId: string | null | undefined;
    /** Draws the locked treatment: dimmed art behind a lock glyph. */
    locked?: boolean;
    className?: string;
    /** `cover` crops to fill (grid cells); `contain` shows the whole image (inspector). */
    fit?: "cover" | "contain";
};

/**
 * An image asset rendered as a thumbnail, with an explicit empty state.
 *
 * A variant with no image is a real authoring state (the author made the slot
 * before picking the art), so it gets a distinct glyph rather than an
 * indistinguishable blank box.
 */
export function GalleryThumb({ app, assetId, locked, className = "", fit = "cover" }: GalleryThumbProps) {
    const url = useAssetUrl(app, assetId);

    return (
        <div className={`relative grid place-items-center overflow-hidden bg-surface-sunken ${className}`}>
            {url ? (
                <img
                    src={url}
                    alt=""
                    draggable={false}
                    className={`h-full w-full ${fit === "cover" ? "object-cover" : "object-contain"} ${locked ? "opacity-30 grayscale" : ""}`}
                />
            ) : (
                <ImageOff size={16} className="text-fg-subtle" />
            )}
            {locked && (
                <div className="absolute inset-0 grid place-items-center">
                    <Lock size={16} className="text-fg-muted drop-shadow" />
                </div>
            )}
        </div>
    );
}

/**
 * Text input that keeps a local draft and commits on blur or Enter.
 *
 * Committing per keystroke would re-normalize and re-persist the whole catalog
 * on every letter typed, and push a dynamic-options refresh through the
 * blueprint inspector each time.
 */
export function InlineNameInput({
    value,
    onCommit,
    placeholder,
    allowEmpty = false,
    className,
    size = "sm",
}: {
    value: string;
    onCommit: (next: string) => void;
    placeholder?: string;
    /** Descriptions may legitimately be cleared; names may not. */
    allowEmpty?: boolean;
    className?: string;
    size?: "sm" | "md";
}) {
    const [draft, setDraft] = useState(value);

    useEffect(() => {
        setDraft(value);
    }, [value]);

    const commit = () => {
        const next = draft.trim();
        if (next === value) {
            return;
        }
        if (!next && !allowEmpty) {
            setDraft(value);
            return;
        }
        onCommit(next);
    };

    return (
        <ui.Input
            size={size}
            fullWidth
            className={className}
            placeholder={placeholder}
            value={draft}
            onChange={event => setDraft(event.target.value)}
            onBlur={commit}
            onKeyDown={event => {
                if (event.key === "Enter") {
                    event.currentTarget.blur();
                } else if (event.key === "Escape") {
                    setDraft(value);
                    event.currentTarget.blur();
                }
            }}
        />
    );
}
