/**
 * What a model contains, for an inspector that has to draw dropdowns from it.
 *
 * A thin adapter over `PuppetDescriptionService`: it decides *when* to ask (the puppet's identity
 * changed) and keeps the answer in React state. The lookup itself lives in the service on purpose —
 * a story row offering a character's motions needs the same answer, and a hook is not reachable
 * from a command's parameter resolver.
 *
 * Lives under `lib/workspace/hooks/` beside `useAssetObjectUrl` and `useSurfacePuppetSession` rather
 * than inside the character editor that first needed it: the `nl.puppet` widget's inspector asks the
 * same question, and a widget reaching into `apps/workspace/modules/characters` for it would be the
 * wrong dependency.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useWorkspace } from "@/apps/workspace/context";
import { Services } from "@/lib/workspace/services/services";
import type { PuppetDescriptionService } from "@/lib/workspace/services/puppet/PuppetDescriptionService";
import type {
    PuppetDescriptionRequest,
    PuppetDescriptionResult,
    PuppetDescriptionUnavailableReason,
} from "@/lib/workspace/services/puppet/puppetDescriptionModel";
import { stablePuppetJson } from "@/lib/workspace/services/puppet/puppetDescriptionModel";
import type { CharacterAppearance } from "@/lib/workspace/services/character/CharacterAppearance";
import type { TranslationKey } from "@shared/i18n";

export interface PuppetDescriptionView {
    /** Null while the first lookup is in flight, and whenever there is nothing to ask about. */
    result: PuppetDescriptionResult | null;
    loading: boolean;
    /** Re-mount the model and ask again, ignoring both caches. */
    refresh: () => void;
}

/**
 * Ask for `request`, re-asking whenever its identity changes.
 *
 * The effect depends on a *stable encoding* of the request rather than the object, because the
 * inspector rebuilds it on every render — depending on the reference would mount a model per
 * keystroke. The request itself travels through a ref, since that encoding is a fingerprint and not
 * something to parse back.
 */
export function usePuppetDescription(request: PuppetDescriptionRequest | null): PuppetDescriptionView {
    const { context } = useWorkspace();
    const [result, setResult] = useState<PuppetDescriptionResult | null>(null);
    const [loading, setLoading] = useState(false);
    const [nonce, setNonce] = useState(0);
    const latest = useRef(request);
    latest.current = request;
    const requestKey = request ? stablePuppetJson(request) : "";

    useEffect(() => {
        const pending = latest.current;
        if (!context || !requestKey || !pending) {
            setResult(null);
            setLoading(false);
            return;
        }
        let cancelled = false;
        setLoading(true);
        const service = context.services.get<PuppetDescriptionService>(Services.PuppetDescription);
        void service
            .describe(pending, nonce > 0 ? { refresh: true } : undefined)
            .then(next => {
                if (!cancelled) {
                    setResult(next);
                    setLoading(false);
                }
            });
        return () => { cancelled = true; };
    }, [context, requestKey, nonce]);

    const refresh = useCallback(() => { setNonce(value => value + 1); }, []);
    return { result, loading, refresh };
}

/**
 * What to ask about, for a character whose appearance is a puppet — or null for one that is not.
 *
 * The four values that decide what a backend would load, and nothing else. The resting pose is
 * deliberately out: applying a motion does not change which motions exist, and putting it in here
 * would re-mount the model every time the author picked one.
 *
 * Shared because two surfaces need the identical mapping — the character editor and the story
 * inspector — and a second copy of it would be a second answer to "is this the same model".
 */
export function puppetDescriptionRequestFor(appearance: CharacterAppearance | undefined): PuppetDescriptionRequest | null {
    // `getPuppet()` already answers null for a kind that is not runtime-drawn, and it answers for all
    // three that are - so it is asked directly. A `getKind() === "puppet"` guard here would have
    // starved every `live2d` and `spine` character of its description while looking like a null check.
    const puppet = appearance?.getPuppet() ?? null;
    if (!puppet?.assetId || !puppet.backend) {
        return null;
    }
    return {
        assetId: puppet.assetId,
        backend: puppet.backend,
        entry: puppet.entry,
        options: puppet.options,
        size: puppet.size,
    };
}

/**
 * Where a description came from, said in one line — the author's only way to tell "the model has no
 * animations" from "Studio never managed to ask it".
 *
 * The keys live under `characters.editor.puppet.*` because that is where they were written, but they
 * describe the *model*, not the character editor, and the story inspector shows the same sentence
 * about the same fact. One table rather than two catalogues that drift.
 */
export function puppetDescribeStatusKey(reason: PuppetDescriptionUnavailableReason | null | undefined): TranslationKey {
    switch (reason) {
        case "no-model": return "characters.editor.puppet.describeNoModel";
        case "no-backend": return "characters.editor.puppet.describeNoBackend";
        case "backend-missing": return "characters.editor.puppet.describeBackendMissing";
        case "not-described": return "characters.editor.puppet.describeNotSupported";
        case "failed": return "characters.editor.puppet.describeFailed";
        // Exhaustive rather than defaulting: a `default` arm reported a *new* kind of unavailability as
        // "filled from the model", which is the one answer that is certainly wrong. `null` - the
        // description succeeded - is the only case that maps to the success line.
        case null:
        case undefined:
            return "characters.editor.puppet.describeOk";
    }
}
