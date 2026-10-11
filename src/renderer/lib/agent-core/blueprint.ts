/**
 * The blueprint (`.bp`) half of the agent core: the `blueprint` command line's catalogue, print,
 * check and apply, over documents the caller holds.
 *
 * # The node catalogue
 *
 * Every body reads the shared `blueprintNodeRegistry`. In Studio, `BlueprintNodeCatalogService`
 * seeds it with the core nodes and stores every plugin node in it, so plugin nodes are listed,
 * described and accepted with no further step; the catalogue service's `getNodeOwner` is what to
 * pass as `nodeOwnerOf` for the "plugin" line of `node`. A headless caller seeds the core nodes with
 * {@link ensureCoreBlueprintNodes} first (the command line also registers the bundled plugins').
 *
 * # What the caller supplies ({@link BlueprintProjectDocuments})
 *
 * - `blueprintDocument` - `uigraphs.json`'s `blueprintDocument`, migrated (in Studio, the live one
 *   `UIGraphService` holds; from disk, through `readableBlueprintDocument`). {@link applyBlueprintSource}
 *   changes it IN PLACE.
 * - `uiDocument` - the interface document: which surfaces, components and elements exist, what type
 *   each element is (widget scope, element references), the list shapes, and the asset names that
 *   travel through lists and bound properties. Null for a project with none.
 * - `variableRegistry` - `editor/variables.json` (`{ entries }`) or its entries; what a
 *   `Get Persistent` / `Get Saved` id is checked against. Optional.
 * - `stories` - every story document (migrated) with its name, for the variables story rows write
 *   (asset-name judgement). Optional; absent means no story writes.
 *
 * Page parameters and save fields are read by the nodes from module-level tables. A running Studio
 * keeps them current itself (`UIDocumentService`, `SaveSchemaService`); a headless caller publishes
 * them with `publishPageParams(uiDocument)` and `publishSaveSchema(saveSchemaJson)` before checking
 * or printing.
 *
 * Comments in English per project convention.
 */

import type { BlueprintDocument } from "@shared/types/blueprint/document";
import type { StoryDocument } from "@shared/types/story";
import type { UIDocument } from "@shared/types/ui-editor/document";
import type { VariableRegistryEntry } from "@shared/types/variables/registry";
import { registerCoreBlueprintNodes } from "@/lib/ui-editor/blueprint-nodes";
import {
    blueprintApplyCommand,
    blueprintCheckProjectCommand,
    blueprintCheckSourceCommand,
    checkOptionsFor,
    type BlueprintApplyOptions,
    type BlueprintApplyResult,
    type BlueprintCheckSourceResult,
    type BlueprintProjectInput,
} from "../blueprint-cli/core";
import { checkBlueprintSource as checkBlueprintSourceWith, type CheckResult } from "../blueprint-cli/check";
import { assetNameContextOf, projectVariablesOf, uiDocumentTargetsOf } from "../blueprint-cli/model";
import type { CommandResult } from "./commandResult";

export type BlueprintProjectDocuments = {
    blueprintDocument: BlueprintDocument;
    uiDocument: UIDocument | null;
    variableRegistry?: { entries?: Record<string, VariableRegistryEntry> } | readonly VariableRegistryEntry[] | null;
    stories?: readonly { name: string; document: StoryDocument }[];
};

/** Seed the shared registry with Studio's core nodes. Idempotent; Studio has already done it. */
export function ensureCoreBlueprintNodes(): void {
    registerCoreBlueprintNodes();
}

/** Everything a graph is judged against, from the project's documents. */
export function buildBlueprintProjectContext(docs: BlueprintProjectDocuments): BlueprintProjectInput {
    return {
        blueprintDocument: docs.blueprintDocument,
        targets: uiDocumentTargetsOf(docs.uiDocument),
        variables: projectVariablesOf(docs.variableRegistry ?? null),
        assetNameContext: assetNameContextOf(docs.uiDocument, docs.stories ?? []),
    };
}

/**
 * Parse, compile and validate a `.bp` source against the project (or on its own with `null`). The
 * compiled `blueprints` are safe to apply only when `ok`.
 */
export function checkBlueprintSource(source: string, context: BlueprintProjectInput | null): CheckResult {
    return checkBlueprintSourceWith(
        source,
        context ? checkOptionsFor(context) : { existing: null, persistentVariables: [], savedVariables: [] },
    );
}

/** `blueprint check <file>` as text. */
export function checkBlueprintSourceText(
    source: string,
    context: BlueprintProjectInput | null,
    options: { fileName?: string; json?: boolean } = {},
): BlueprintCheckSourceResult {
    return blueprintCheckSourceCommand(source, context, options);
}

/** `blueprint check` with no file: every stored blueprint against the project. */
export function checkBlueprintProjectText(
    context: BlueprintProjectInput,
    options: { fileName?: string; json?: boolean } = {},
): CommandResult {
    return blueprintCheckProjectCommand(context, options);
}

/**
 * `blueprint apply <file>` exactly, into `context.blueprintDocument` IN PLACE: each compiled
 * blueprint replaces whatever held its owner, and the owner records follow. `applied` is absent when
 * nothing changed (the file did not check clean, or `beforeApply` refused).
 */
export function applyBlueprintSource(
    source: string,
    context: BlueprintProjectInput,
    options: BlueprintApplyOptions = {},
): BlueprintApplyResult {
    return blueprintApplyCommand(source, context, options);
}
