/**
 * What a node that opens a page hands the page: its `props` input, with each declared parameter's own
 * input laid over it under the parameter's name.
 *
 * One reader for the four nodes that grow those inputs (`Go Page`, `Replace Page`, `Show Layer`,
 * `Set Frame Page`), so the rule for which of them counts is written once.
 *
 * Comments in English per project convention.
 */

import { coerceUIPageParamValue, getActiveUIPageParams } from "@shared/types/ui-editor/pageParams";
import type { BlueprintNodeDef } from "../types";
import { uiPageParamPinId } from "../effectivePins";
import { resolveNodeInput } from "./graphParamResolvers";

type NodeExecutionContext = Parameters<BlueprintNodeDef["execute"]>[0];

/**
 * The props to open `targetSurfaceId` with.
 *
 * The declared inputs are the picked page's - the page in the card's own field, `pickedParam`: a
 * page that arrives on a wire instead may declare other parameters or none, and values typed for one
 * page's names are not answers to another's. So when the node's input of that name is wired - the
 * card shows no parameter inputs then - or the page it opens is not the picked one, the node gives
 * the `props` input alone, exactly what it gave before pages declared anything.
 *
 * An input given nothing - unwired, nothing typed on the card - is left out rather than written as
 * empty, so the page reads the parameter's declared default (`withUIPageParamDefaults`). A value is
 * turned into the declared type on the way, as the page will read it.
 *
 * With nothing declared, or nothing given, the `props` input is returned as it was read - including
 * a value that is not an object - so a graph written before the page declared anything behaves
 * exactly as it did.
 */
export function readOpenedPageProps(
    ctx: NodeExecutionContext,
    targetSurfaceId: string,
    pickedParam: string,
    rawPropsPinId = "props",
): unknown {
    const raw = resolveNodeInput(ctx, rawPropsPinId);
    const pickedSurfaceId = ctx.params[pickedParam];
    const picked = typeof pickedSurfaceId === "string" ? pickedSurfaceId.trim() : "";
    const pageWired = ctx.graph.edges.some(edge => edge.to.nodeId === ctx.node.id && edge.to.port === pickedParam);
    if (!targetSurfaceId || picked !== targetSurfaceId || pageWired) {
        return raw;
    }
    const given: Record<string, unknown> = {};
    for (const param of getActiveUIPageParams(targetSurfaceId)) {
        const value = resolveNodeInput(ctx, uiPageParamPinId(param.id));
        if (value !== undefined) {
            given[param.name] = coerceUIPageParamValue(param.type, value);
        }
    }
    if (Object.keys(given).length === 0) {
        return raw;
    }
    const base = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
    return { ...base, ...given };
}
