import { DEFAULT_LINTING_CONFIGURATION, DEFAULT_NETWORK_CONFIGURATION } from "../workspace/project/configuration";
import type { LintContext } from "./context";

/**
 * An empty-but-valid {@link LintContext} for rule tests.
 *
 * Exists so a rule test is one line of setup - `createTestLintContext({ stories: [...] })` - rather
 * than twelve lines of empty collections that every new rule file would copy and that would all
 * need editing the day the context grows a field. `io` refuses everything (`null` / `ok: false`),
 * which is the correct default: a test that cares about bytes says so by overriding it.
 */
export function createTestLintContext(overrides: Partial<LintContext> = {}): LintContext {
    return {
        config: { ...DEFAULT_LINTING_CONFIGURATION },
        // The secure default, same as a new project. A test about the network rule turns it on.
        network: { ...DEFAULT_NETWORK_CONFIGURATION },
        stories: [],
        blueprintDocument: null,
        uiDocument: null,
        assets: [],
        referencedAssetIds: new Set<string>(),
        assetReferences: new Map(),
        characters: [],
        variableRegistry: [],
        persistentNameCollisions: [],
        savedNameCollisions: [],
        localization: null,
        voice: null,
        buildPlatforms: [],
        io: {
            exists: async () => false,
            readBytes: async () => null,
            probeImage: async () => ({ ok: false, reason: "test context has no io" }),
        },
        ...overrides,
    };
}
