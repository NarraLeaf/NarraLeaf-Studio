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
} from "@/lib/workspace/services/puppet/puppetDescriptionModel";
import { stablePuppetJson } from "@/lib/workspace/services/puppet/puppetDescriptionModel";

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
