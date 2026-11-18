import { variableRegistrySpec } from "@shared/documents/specs";

/**
 * Which file the variables panel's two project scopes write, as the project-relative path the freeze
 * policy takes.
 *
 * Through the document spec rather than spelled out here, for the reason `writeFreeze` gives: a path
 * written a second time is a path that falls behind the one `VariableRegistryService` actually saves
 * to. If the two ever disagree, the panel offers an edit the write boundary refuses.
 *
 * ⚠ **The scene section is not this document and must not carry this scope.** Scene variables are
 * declaration rows in a story, so what governs them is the story's own freeze - and this panel shows
 * them read-only anyway.
 */
export function variableRegistryFreezeScope(): string {
    return variableRegistrySpec.pathFor();
}
