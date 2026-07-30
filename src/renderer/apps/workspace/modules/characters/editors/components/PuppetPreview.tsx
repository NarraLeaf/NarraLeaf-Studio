/**
 * The character inspector's live view of a puppet.
 *
 * The editor had none: a puppet character was four text fields and no picture, and the only way to
 * see the model was to launch Dev Mode. It costs almost nothing to add here because the description
 * lookup already has to mount the model — a preview is the same mount with its container on screen
 * instead of pushed off the left edge.
 *
 * The pose it shows is the character's resting state, so choosing a motion is a visible act rather
 * than a name typed into a box.
 */

import React, { useEffect, useRef, useState } from "react";
import { useWorkspace } from "@/apps/workspace/context";
import { useTranslation } from "@/lib/i18n";
import { Services } from "@/lib/workspace/services/services";
import type { PuppetDescriptionService } from "@/lib/workspace/services/puppet/PuppetDescriptionService";
import type { PuppetDescriptionRequest } from "@/lib/workspace/services/puppet/puppetDescriptionModel";
import { stablePuppetJson } from "@/lib/workspace/services/puppet/puppetDescriptionModel";
import type { PuppetModelSession } from "@/lib/workspace/services/puppet/puppetModelSession";
import type { PuppetDefaultState } from "@/lib/workspace/services/character/types";

const PREVIEW_HEIGHT_PX = 168;

export function PuppetPreview(props: {
    request: PuppetDescriptionRequest | null;
    state: PuppetDefaultState;
}) {
    const { request, state } = props;
    const { t } = useTranslation();
    const { context } = useWorkspace();
    const hostRef = useRef<HTMLDivElement | null>(null);
    const sessionRef = useRef<PuppetModelSession | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [ready, setReady] = useState(false);

    const requestKey = request ? stablePuppetJson(request) : "";
    const latest = useRef(request);
    latest.current = request;

    // Mounting is keyed on the puppet's identity only. A puppet cannot change its `src` - the
    // engine says so outright - so a new model means a new instance, while a new *pose* is an
    // `apply` on the instance that is already up (the effect below).
    useEffect(() => {
        const host = hostRef.current;
        const pending = latest.current;
        setError(null);
        setReady(false);
        if (!context || !host || !requestKey || !pending) {
            return;
        }
        // Each attempt draws into a surface of its own rather than into the host directly.
        // Disposing a backend empties the container it was handed, and mounting is asynchronous -
        // so two overlapping attempts (React's development double-invoke is one, an edit while a
        // load is in flight is another) would have the loser wipe the winner's canvas out of a
        // shared container, leaving a blank box and no error to explain it.
        const surface = document.createElement("div");
        surface.style.cssText = "position:absolute;inset:0";
        host.appendChild(surface);

        let cancelled = false;
        const service = context.services.get<PuppetDescriptionService>(Services.PuppetDescription);
        void service.openSession(pending, surface, {
            size: { width: host.clientWidth || 320, height: host.clientHeight || PREVIEW_HEIGHT_PX },
        }).then(session => {
            if (cancelled) {
                session.dispose();
                return;
            }
            sessionRef.current = session;
            setReady(true);
        }).catch((reason: unknown) => {
            if (!cancelled) {
                setError(reason instanceof Error ? reason.message : String(reason));
            }
        });
        return () => {
            cancelled = true;
            sessionRef.current?.dispose();
            sessionRef.current = null;
            surface.remove();
        };
    }, [context, requestKey]);

    // The engine's contract: a state is applied *whole*, and a null field visibly clears rather
    // than leaving what was there. Sent verbatim so the preview shows what a saved game would.
    useEffect(() => {
        if (!ready) {
            return;
        }
        void Promise.resolve(sessionRef.current?.apply({
            motion: state.motion,
            expression: state.expression,
            skin: state.skin,
            params: {},
            slots: {},
        })).catch(() => undefined);
    }, [ready, state.motion, state.expression, state.skin]);

    if (!request) {
        return null;
    }

    return (
        <div
            className="relative overflow-hidden rounded-md border border-edge bg-fill-subtle"
            style={{ height: PREVIEW_HEIGHT_PX }}
        >
            <div ref={hostRef} className="absolute inset-0" />
            {error !== null && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 px-3 text-center">
                    <span className="text-2xs text-fg-subtle">{t("characters.editor.puppet.previewFailed")}</span>
                    {/* The reason as well as the fact. `openSession` rejects with the *planned*
                        unavailability - "the runtime X is not installed in this project", "the bundle
                        names no entry" - and swallowing that left the author with one sentence that
                        fitted every cause and pointed at none of them. */}
                    <span className="max-w-full break-words text-2xs text-fg-subtle/70">{error}</span>
                </div>
            )}
        </div>
    );
}
