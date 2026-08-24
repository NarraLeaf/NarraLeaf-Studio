const path = require('path');
const { rootDir } = require('./utils');

const runtimeSourceDir = path.join(rootDir, 'src', 'runtime');

/**
 * The import boundary of the game runtime's renderer bundle.
 *
 * It lives in a module of its own, with no dependency heavier than `path`, so that the vitest
 * guard (src/renderer/lib/ui-editor/runtime/app/importBoundary.test.ts) can load this plugin and
 * ask IT what is allowed instead of keeping a second copy of the lists that would rot the first
 * time someone adds a shim here.
 */
function runtimeAliasPlugin() {
    const shim = name => path.join(runtimeSourceDir, 'renderer', 'shims', name);
    const exactAliases = new Map([
        [
            '@/lib/i18n',
            shim('i18n.ts'),
        ],
        [
            '@/lib/ui-editor/hooks/useEnteredElementState',
            shim('useEnteredElementState.ts'),
        ],
        [
            '@/lib/workspace/hooks/useAssetObjectUrl',
            shim('useAssetObjectUrl.ts'),
        ],
        [
            '@/lib/workspace/hooks/useEditorFontFamily',
            shim('useEditorFontFamily.ts'),
        ],
        [
            '@/lib/workspace/hooks/useSurfacePuppetSession',
            shim('useSurfacePuppetSession.ts'),
        ],
        [
            '@/apps/workspace/modules/properties/framework/utils/colorUtils',
            shim('colorUtils.ts'),
        ],
        [
            '@/lib/workspace/services/ui-editor/UIEditorStateService',
            shim('UIEditorStateService.ts'),
        ],
        [
            '@/lib/workspace/services/ui-editor/UIDocumentService',
            shim('UIDocumentService.ts'),
        ],
        [
            '@/lib/workspace/services/ui/UIStore',
            shim('UIStore.ts'),
        ],
        [
            '@/lib/ui-editor/interaction/inlineTextEdit',
            shim('inlineTextEdit.ts'),
        ],
        [
            '@/lib/ui-editor/interaction/containerDrillSelection',
            shim('containerDrillSelection.ts'),
        ],
        [
            '@/lib/ui-editor/interaction/surfaceInlineTextEditActivation',
            shim('surfaceInlineTextEditActivation.ts'),
        ],
        [
            '@/lib/ui-editor/interaction/doubleClickDebug',
            shim('doubleClickDebug.ts'),
        ],
    ]);
    // The game runtime bundle may only reach Studio renderer code through:
    //   1. an explicit shim alias above,
    //   2. the shared ui-editor tree, or
    //   3. a triaged pure module (functions/constants over @shared types only).
    // Everything else is a Studio module and must fail the build instead of
    // silently falling through to the tsconfig "@/*" path mapping.
    const allowedPrefixes = ['@/lib/ui-editor/'];
    const allowedExact = new Set([
        // Pure blueprint helpers (no services, no state); candidates to move
        // under @/lib/ui-editor or @shared eventually.
        '@/lib/workspace/services/ui-editor/blueprint/blueprintVariableRefs',
        '@/lib/workspace/services/ui-editor/blueprint/fieldEvaluation',
        '@/lib/workspace/services/ui-editor/blueprint/fnCatalog',
        '@/lib/workspace/services/ui-editor/blueprint/ownerKeys',
        // The IME composition guards: four functions and a module-level boolean
        // over React's own event types, with nothing Studio about them. Not
        // moved under @/lib/ui-editor because they are not a ui-editor concern -
        // thirty-odd Studio text fields ask them, and only three of the callers
        // are widget renderers. A player composing Japanese into a text widget
        // needs the same guard an author composing into a dialog does, so the
        // runtime needs the module rather than a copy of it.
        '@/lib/utils/imeComposition',
    ]);
    return {
        name: 'runtime-alias',
        setup(build) {
            build.onResolve({ filter: /^@\/(?:apps|lib)\/.*$/ }, args => {
                const target = exactAliases.get(args.path);
                if (target) {
                    return { path: target };
                }
                if (allowedPrefixes.some(prefix => args.path.startsWith(prefix)) || allowedExact.has(args.path)) {
                    return undefined; // fall through to tsconfig paths
                }
                return {
                    errors: [{
                        text: `Runtime bundle must not import "${args.path}" (imported by ${args.importer}). ` +
                            `Add a shim under src/runtime/renderer/shims + an alias in build-runtime.js, ` +
                            `or move the code into a shared module under @/lib/ui-editor.`,
                    }],
                };
            });
        },
    };
}

module.exports = { runtimeAliasPlugin };
