import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { CLAIM_REASSERT_MS } from "@/lib/live";
import { nameInitials, nameMonogramColor } from "@/lib/components/monogram";
import { useTranslation } from "@/lib/i18n";
import { Services } from "@/lib/workspace/services/services";
import type { LiveSessionService } from "@/lib/workspace/services/live/LiveSessionService";
import type { LiveSessionView } from "@/lib/workspace/services/live/liveSessionView";
import { uiNodeClaimKey, UI_NODE_CLAIM_PREFIX } from "@shared/live/ops";
import { useWorkspace } from "../../context";

/**
 * The blueprint canvas, as a live session shows it: which nodes somebody else is inside.
 *
 * `uiLiveSession` one document along, and the same file again for the same reason. What differs is
 * only the address: a node is named by its blueprint, its graph and itself, because node ids are not
 * unique across the document - the seeded entry nodes use fixed ids, and `global.appBoot` is in every
 * project.
 */

/* ---------------------------------------------------------------------------- holding one */

/** The one thing a hold needs of a live session. See `LiveSession.claimUINode`. */
export type UINodeClaimPort = {
    claimUINode(blueprintId: string, graphId: string, nodeId: string, holding: boolean): void;
};

/**
 * Hold the node this canvas has selected, keep saying so, and give it back when it changes.
 *
 * Asserted for as long as the node is selected rather than for as long as its author is typing - the
 * interface element's rule, for its reason: a node's parameter editors keep a draft in their own
 * state until they are blurred, so what a claim means here is "somebody has this node open".
 *
 * ⚠ **One node, the first of a selection.** A rubber-band over forty nodes is a gesture about their
 * arrangement, not about what is written in them, and forty claims would take forty rows of the room's
 * claim set for a drag nobody is drafting anything into.
 */
export function useUINodeClaimHold(input: {
    /** Null before the workspace is up, which is a window that cannot be in a session either. */
    service: UINodeClaimPort | null;
    blueprintId: string | null;
    graphId: string | null;
    /** The node open for editing, or null when none is. */
    nodeId: string | null;
}): void {
    const { service, blueprintId, graphId, nodeId } = input;

    useEffect(() => {
        if (!service || blueprintId === null || graphId === null || nodeId === null) {
            return;
        }
        service.claimUINode(blueprintId, graphId, nodeId, true);
        // An interval rather than a message per keystroke: see `CLAIM_REASSERT_MS`.
        const timer = setInterval(() => service.claimUINode(blueprintId, graphId, nodeId, true), CLAIM_REASSERT_MS);
        return () => {
            clearInterval(timer);
            service.claimUINode(blueprintId, graphId, nodeId, false);
        };
    }, [service, blueprintId, graphId, nodeId]);
}

/* --------------------------------------------------------------------------- reading them */

/** Claim key to the account editing it, for every node somebody else holds. */
export type UINodeClaims = Readonly<Record<string, string>>;

const NO_CLAIMS: UINodeClaims = {};

const UINodeClaimsContext = createContext<UINodeClaims>(NO_CLAIMS);

/**
 * The claims on the blueprints, kept as one value that only changes when it would read differently.
 *
 * One subscription rather than one per node: a graph draws hundreds of cards, and a card that read
 * the service itself would re-render on every remote edit anywhere in the room.
 */
export function UINodeClaimsProvider({ children }: { children: React.ReactNode }) {
    const { context, isInitialized } = useWorkspace();
    const service = useMemo(
        () => (context && isInitialized ? context.services.get<LiveSessionService>(Services.Live) : null),
        [context, isInitialized],
    );
    const [claims, setClaims] = useState<UINodeClaims>(NO_CLAIMS);

    useEffect(() => {
        if (!service) {
            setClaims(NO_CLAIMS);
            return;
        }
        const read = () => setClaims(previous => {
            const next = othersUINodeClaims(service.getView());
            return signatureOf(next) === signatureOf(previous) ? previous : next;
        });
        // On the way in as well as on every change: a canvas opened during a session has missed the
        // message that carried the claims standing at that moment.
        read();
        return service.onChanged(read);
    }, [service]);

    return <UINodeClaimsContext.Provider value={claims}>{children}</UINodeClaimsContext.Provider>;
}

function signatureOf(claims: UINodeClaims): string {
    return Object.entries(claims)
        .map(([key, account]) => `${key}=${account}`)
        .sort()
        .join("\n");
}

/** Who else is inside this node, or null when nobody is. */
export function useUINodeClaim(blueprintId: string, graphId: string, nodeId: string): string | null {
    return useContext(UINodeClaimsContext)[uiNodeClaimKey(blueprintId, graphId, nodeId)] ?? null;
}

/**
 * Which graph the surrounding canvas is drawing.
 *
 * A card knows its own node id and nothing else - React Flow hands it `data`, and the blueprint and
 * the graph are properties of the canvas rather than of the node. Passing them down through the node
 * data instead would put them on every card in the projection and re-key every one of them whenever
 * the author switched layer.
 */
export type BlueprintGraphAddress = { blueprintId: string; graphId: string } | null;

const BlueprintGraphAddressContext = createContext<BlueprintGraphAddress>(null);

export const BlueprintGraphAddressProvider = BlueprintGraphAddressContext.Provider;

/** Who else is inside one node of the graph this canvas is drawing, or null when nobody is. */
export function useUINodeClaimAt(nodeId: string): string | null {
    const address = useContext(BlueprintGraphAddressContext);
    const claims = useContext(UINodeClaimsContext);
    if (!address) {
        return null;
    }
    return claims[uiNodeClaimKey(address.blueprintId, address.graphId, nodeId)] ?? null;
}

/**
 * Everybody else's claims on the blueprints, by claim key.
 *
 * This window's own are left out, for the cast's reason. ⚠ The claim set holds every kind of claim at
 * once, keyed by a prefix, so this reads only its own keys back out.
 */
export function othersUINodeClaims(view: LiveSessionView): UINodeClaims {
    const self = selfAccount(view);
    const held: Record<string, string> = {};
    for (const [key, account] of Object.entries(view.claims)) {
        if (key.startsWith(UI_NODE_CLAIM_PREFIX) && account !== self) {
            held[key] = account;
        }
    }
    return held;
}

function selfAccount(view: LiveSessionView): string | null {
    return view.session?.members.find(member => member.instance === view.self)?.account ?? null;
}

/* ------------------------------------------------------------------------- what it draws */

/**
 * The mark on a node somebody else is editing.
 *
 * The same monogram every other claim wears, so a person is recognisable wherever they turn up in the
 * workspace rather than being a different glyph per document.
 */
export function UINodeClaimMark({ account }: { account: string }) {
    const { t } = useTranslation();
    return (
        <span
            data-ui-node-claim={account}
            data-tip={t("blueprint.live.nodeClaimed", { name: account })}
            className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full text-2xs font-medium leading-none text-white"
            style={{ backgroundColor: nameMonogramColor(account) }}
        >
            {nameInitials(account).slice(0, 1)}
        </span>
    );
}
