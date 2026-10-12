/**
 * The interface (`.ui`) half of the agent core: the `ui` command line's parse, check, compile, apply
 * and print, over documents the caller holds.
 *
 * # What the caller supplies ({@link UiAgentContext})
 *
 * - `document` - the interface document (`editor/ui/uidoc.json`) at the current schema. In Studio,
 *   `UIDocumentService`'s live document. {@link applyUiSource} and {@link applyCompiledUi} change it
 *   IN PLACE, so a caller that commits through a service passes a clone and commits the clone.
 * - `blueprintDocument` - `uigraphs.json`'s `blueprintDocument` (in Studio, `UIGraphService`'s). Only
 *   read: it says which blueprint hangs off which element, so a value binding can be checked against
 *   the blueprint it names (`binding_owner_mismatch` and friends) and `show` can note it. Optional;
 *   absent means no blueprints.
 * - `textKeys` - the project's translation keys and source language, from
 *   `textKeysOf({ localization: projectConfig.app.localization, keysDocument })`. Decides whether a
 *   keyed widget's words are shown and checks `key` lines. Optional; absent means "no project
 *   config", which is what the command line reports for a project it cannot read.
 * - `widgets` - where widget modules come from. Defaults to Studio's built-ins plus every
 *   plugin-owned module in the shared `widgetModuleRegistry`, which in a running workspace already
 *   holds the loaded plugins' widgets. Pass `widgetModuleSourceFromRegistry(widgetModuleRegistry)`
 *   to read the registry alone.
 *
 * Comments in English per project convention.
 */

import type { BlueprintDocument } from "@shared/types/blueprint/document";
import type { UIDocument } from "@shared/types/ui-editor/document";
import type { UIWidgetModule } from "@/lib/ui-editor/widget-modules/types";
import { applyCompiled, type ApplyResult } from "../ui-cli/apply";
import { checkUiSource as checkUiSourceAgainst, type UiCheckResult } from "../ui-cli/check";
import {
    uiApplyCommand,
    uiCheckProjectCommand,
    uiCheckSourceCommand,
    uiShowCommand,
    type UiApplyOptions,
    type UiApplyResult,
    type UiCheckSourceResult,
    type UiProjectInput,
    type UiShowOptions,
    type UiShowResult,
} from "../ui-cli/core";
import { compileUiFile, type UiCompileResult } from "../ui-cli/dsl/compile";
import { parseUiFile, UiParseError } from "../ui-cli/dsl/parse";
import { indexBlueprintDocument, type TextKeys } from "../ui-cli/model";
import { withWidgetModuleSource, type WidgetModuleSource } from "../ui-cli/widgetSource";
import type { BpDiagnostic } from "../blueprint-cli/dsl/ast";
import type { CommandResult } from "./commandResult";

export type UiAgentContext = {
    document: UIDocument;
    blueprintDocument?: BlueprintDocument | null;
    textKeys?: TextKeys | null;
    widgets?: WidgetModuleSource;
};

/** The command bodies' input, from a context. */
export function uiProjectInputOf(context: UiAgentContext): UiProjectInput {
    return {
        document: context.document,
        blueprints: indexBlueprintDocument(context.blueprintDocument ?? null),
        textKeys: context.textKeys ?? null,
    };
}

/** A widget module source reading one registry - Studio's `widgetModuleRegistry` - and nothing else. */
export function widgetModuleSourceFromRegistry(registry: {
    list(): UIWidgetModule[];
    getOwner(type: string): string | undefined;
}): WidgetModuleSource {
    return { list: () => registry.list(), pluginOwnerOf: type => registry.getOwner(type) };
}

// ---------------------------------------------------------------------------
// Printing (`ui show`)
// ---------------------------------------------------------------------------

/**
 * `ui show` exactly: the whole interface with its shared tables, or the one surface / component
 * named (by name or id). `out` is what the terminal prints, `text` the file a `--out` would write.
 */
export function showUi(context: UiAgentContext, options: Omit<UiShowOptions, "projectHint"> = {}): UiShowResult {
    return uiShowCommand(uiProjectInputOf(context), options);
}

/** One surface in the `.ui` format, as `ui show --surface` prints it; null when nothing is called that. */
export function printUiSurface(context: UiAgentContext, surface: string): string | null {
    return showUi(context, { surface }).text ?? null;
}

/** One component definition in the `.ui` format, as `ui show --component` prints it; null on a miss. */
export function printUiComponent(context: UiAgentContext, component: string): string | null {
    return showUi(context, { component }).text ?? null;
}

/** The whole interface, shared tables included, as a bare `ui show` prints it. */
export function printUiProject(context: UiAgentContext): string {
    return showUi(context).text ?? "";
}

// ---------------------------------------------------------------------------
// Checking and compiling
// ---------------------------------------------------------------------------

/**
 * Both layers over a `.ui` source: the compiler's diagnostics, then the project's - bindings and
 * their owners (`binding_owner_mismatch`), components, page parameters, the entry page, frames,
 * keys, dropped elements. Pass `null` for a file checked on its own (the project layer is skipped).
 * `compiled` is what {@link applyCompiledUi} takes; it is safe to apply only when `ok`.
 */
export function checkUiSource(source: string, context: UiAgentContext | null): UiCheckResult {
    return withWidgetModuleSource(context?.widgets, () => {
        const input = context ? uiProjectInputOf(context) : null;
        return checkUiSourceAgainst(source, {
            existing: input?.document ?? null,
            blueprints: input?.blueprints ?? null,
            textKeys: input?.textKeys ?? null,
        });
    });
}

/** `ui check <file>` as text: the report the terminal prints, and the exit code. */
export function checkUiSourceText(
    source: string,
    context: UiAgentContext | null,
    options: { fileName?: string } = {},
): UiCheckSourceResult {
    return uiCheckSourceCommand(source, context ? uiProjectInputOf(context) : null, {
        fileName: options.fileName,
        widgets: context?.widgets,
    });
}

/** `ui check` with no file: the stored document's own problems. */
export function checkUiProjectText(context: UiAgentContext, options: { fileName?: string } = {}): CommandResult {
    return uiCheckProjectCommand(uiProjectInputOf(context), options);
}

/**
 * The compiler layer alone: parse, then compile against `context.document` (which an unstated id is
 * matched against). A parse error comes back as one `dsl.parse` diagnostic and no result.
 */
export function compileUiSource(
    source: string,
    context: UiAgentContext | null,
): { compiled: UiCompileResult | null; diagnostics: BpDiagnostic[] } {
    return withWidgetModuleSource(context?.widgets, () => {
        try {
            const compiled = compileUiFile(parseUiFile(source), {
                existing: context?.document ?? null,
                textKeys: context?.textKeys ?? null,
            });
            return { compiled, diagnostics: [...compiled.diagnostics] };
        } catch (error) {
            if (error instanceof UiParseError) {
                return {
                    compiled: null,
                    diagnostics: [{ severity: "error", code: "dsl.parse", message: error.message, line: error.line }],
                };
            }
            throw error;
        }
    });
}

// ---------------------------------------------------------------------------
// Applying
// ---------------------------------------------------------------------------

/**
 * Put a compiled file into `document` IN PLACE: each surface and component it describes replaces the
 * stored one, structs and actions merge, the entry page moves when the file names one. The result
 * names the surfaces and components added and replaced and counts `elementsRemoved`; the names of
 * the elements that go are on the compiled input (`compiled.surfaces[i].dropped`,
 * `compiled.components[i].dropped`), which is where the check reads them from too.
 */
export function applyCompiledUi(document: UIDocument, compiled: UiCompileResult): ApplyResult {
    return applyCompiled(document, compiled);
}

/**
 * `ui apply <file>` exactly, against `context.document` IN PLACE: the check report, then the apply
 * summary. `applied` is absent when the file did not check clean (exit 1) or `beforeApply` refused
 * (exit 2); the document is untouched in both cases.
 */
export function applyUiSource(
    source: string,
    context: UiAgentContext,
    options: Omit<UiApplyOptions, "widgets"> = {},
): UiApplyResult {
    return uiApplyCommand(source, uiProjectInputOf(context), { ...options, widgets: context.widgets });
}
