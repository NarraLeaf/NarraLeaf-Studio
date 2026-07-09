/**
 * Game localization nodes: read/write the player's language and enumerate the
 * project's configured languages (e.g. as a settings-screen selector source).
 * The current language is persisted app-level (host persistence); story text
 * re-resolves per render, so a language switch applies immediately.
 * Comments in English per project convention.
 */

import { localizationKeyUnitId, resolveLocalizedUnitText } from "@shared/types/localization";
import { parseTranslatedText } from "@shared/utils/localizationText";
import { BlueprintGraphExecutionError } from "../../behavior-graph/GraphExecutionError";
import type { BlueprintNodeDef } from "../types";
import { resolveDataPinValue } from "./graphParamResolvers";
import { requireHostApi } from "./hostApi";

type NodeExecuteContext = Parameters<NonNullable<BlueprintNodeDef["execute"]>>[0];

function resolvePinString(ctx: NodeExecuteContext, pinId: string): string {
    const raw = resolveDataPinValue(ctx.graph, ctx.node.id, pinId, ctx.params, ctx.blueprintLocals, 0, {
        hostAdapter: ctx.hostAdapter,
        eventPayload: ctx.eventPayload,
        listItemScope: ctx.listItemScope,
        instanceKey: ctx.instanceKey,
        executionOwner: ctx.executionOwner,
    });
    return raw === null || raw === undefined ? "" : String(raw);
}

/**
 * Resolve a named key's text for the current locale: translation via the
 * fallback chain, else the key's source text, else null when unknown.
 */
async function resolveNamedKeyText(ctx: NodeExecuteContext, keyName: string): Promise<string | null> {
    const api = requireHostApi(ctx);
    const config = api.localization.getConfig();
    if (!config || !(keyName in (config.keys ?? {}))) {
        return null;
    }
    const bundle = { ...config, tables: config.tables ?? {}, keys: config.keys ?? {} };
    const locale = await api.localization.getLocale();
    const translated = resolveLocalizedUnitText(bundle, locale, localizationKeyUnitId(keyName));
    return translated ?? bundle.keys[keyName] ?? null;
}

export const localizationBlueprintNodes: BlueprintNodeDef[] = [
    {
        type: "blueprint.localization.getCurrentLanguage",
        displayName: "Get Current Language",
        category: "Localization",
        keywords: ["localization", "language", "locale", "i18n", "translation", "get"],
        graphKinds: ["event", "macro"],
        isPure: false,
        isLatent: true,
        pins: [
            { id: "in", kind: "input", semantic: "exec", label: "In" },
            { id: "next", kind: "output", semantic: "exec", label: "Next" },
            {
                id: "value",
                kind: "output",
                semantic: "data",
                valueType: "string",
                label: "Language",
            },
        ],
        async execute(ctx) {
            const api = requireHostApi(ctx);
            return {
                nextPort: "next",
                outputValues: {
                    value: await api.localization.getLocale(),
                },
            };
        },
    },
    {
        type: "blueprint.localization.setLanguage",
        displayName: "Set Language",
        category: "Localization",
        keywords: ["localization", "language", "locale", "i18n", "translation", "set", "switch"],
        graphKinds: ["event", "macro"],
        isPure: false,
        isLatent: true,
        pins: [
            { id: "in", kind: "input", semantic: "exec", label: "In" },
            { id: "next", kind: "output", semantic: "exec", label: "Next" },
            {
                id: "language",
                kind: "input",
                semantic: "data",
                valueType: "string",
                label: "Language",
            },
        ],
        async execute(ctx) {
            const api = requireHostApi(ctx);
            const config = api.localization.getConfig();
            if (!config) {
                throw new BlueprintGraphExecutionError("This project has no languages configured", ctx.node.id);
            }
            const raw = resolveDataPinValue(ctx.graph, ctx.node.id, "language", ctx.params, ctx.blueprintLocals, 0, {
                hostAdapter: ctx.hostAdapter,
                eventPayload: ctx.eventPayload,
                listItemScope: ctx.listItemScope,
                instanceKey: ctx.instanceKey,
                executionOwner: ctx.executionOwner,
            });
            const code = String(raw ?? "").trim();
            if (!code || !config.locales.some(locale => locale.code === code)) {
                throw new BlueprintGraphExecutionError(`Unknown language: ${code || "(empty)"}`, ctx.node.id);
            }
            await api.localization.setLocale(code);
            return { nextPort: "next" };
        },
    },
    {
        type: "blueprint.localization.getText",
        displayName: "Get Text",
        category: "Localization",
        keywords: ["localization", "text", "string", "key", "i18n", "translation", "lookup"],
        graphKinds: ["event", "macro"],
        isPure: false,
        isLatent: true,
        pins: [
            { id: "in", kind: "input", semantic: "exec", label: "In" },
            { id: "next", kind: "output", semantic: "exec", label: "Next" },
            {
                id: "key",
                kind: "input",
                semantic: "data",
                valueType: "string",
                label: "Key",
            },
            {
                id: "value",
                kind: "output",
                semantic: "data",
                valueType: "string",
                label: "Text",
            },
        ],
        inspectorParams: [
            { key: "key", label: "Key", kind: "select", dynamicOptionsSource: "localizationKeys" },
        ],
        async execute(ctx) {
            const keyName = resolvePinString(ctx, "key").trim();
            if (!keyName) {
                throw new BlueprintGraphExecutionError("Provide a text key", ctx.node.id);
            }
            const text = await resolveNamedKeyText(ctx, keyName);
            return {
                nextPort: "next",
                outputValues: {
                    // Unknown keys render as the key name so the defect is visible in-game.
                    value: text ?? keyName,
                },
            };
        },
    },
    {
        type: "blueprint.localization.hasText",
        displayName: "Has Text",
        category: "Localization",
        keywords: ["localization", "text", "key", "i18n", "exists", "check"],
        graphKinds: ["event", "macro"],
        isPure: false,
        isLatent: true,
        pins: [
            { id: "in", kind: "input", semantic: "exec", label: "In" },
            { id: "next", kind: "output", semantic: "exec", label: "Next" },
            {
                id: "key",
                kind: "input",
                semantic: "data",
                valueType: "string",
                label: "Key",
            },
            {
                id: "value",
                kind: "output",
                semantic: "data",
                valueType: "boolean",
                label: "Exists",
            },
        ],
        inspectorParams: [
            { key: "key", label: "Key", kind: "select", dynamicOptionsSource: "localizationKeys" },
        ],
        async execute(ctx) {
            const keyName = resolvePinString(ctx, "key").trim();
            const text = keyName ? await resolveNamedKeyText(ctx, keyName) : null;
            return {
                nextPort: "next",
                outputValues: {
                    value: text !== null,
                },
            };
        },
    },
    {
        type: "blueprint.localization.formatText",
        displayName: "Format Text",
        category: "Localization",
        keywords: ["localization", "format", "placeholder", "interpolate", "template", "text"],
        graphKinds: ["event", "macro"],
        isPure: false,
        isLatent: true,
        pins: [
            { id: "in", kind: "input", semantic: "exec", label: "In" },
            { id: "next", kind: "output", semantic: "exec", label: "Next" },
            {
                id: "text",
                kind: "input",
                semantic: "data",
                valueType: "string",
                label: "Text",
            },
            {
                id: "values",
                kind: "input",
                semantic: "data",
                valueType: "list",
                label: "Values",
            },
            {
                id: "value",
                kind: "output",
                semantic: "data",
                valueType: "string",
                label: "Result",
            },
        ],
        async execute(ctx) {
            const template = resolvePinString(ctx, "text");
            const raw = resolveDataPinValue(ctx.graph, ctx.node.id, "values", ctx.params, ctx.blueprintLocals, 0, {
                hostAdapter: ctx.hostAdapter,
                eventPayload: ctx.eventPayload,
                listItemScope: ctx.listItemScope,
                instanceKey: ctx.instanceKey,
                executionOwner: ctx.executionOwner,
            });
            const values = Array.isArray(raw) ? raw : raw === null || raw === undefined ? [] : [raw];
            const result = parseTranslatedText(template)
                .map(part => {
                    if (part.kind === "text") {
                        return part.text;
                    }
                    const value = values[part.index];
                    return value === null || value === undefined ? "" : String(value);
                })
                .join("");
            return {
                nextPort: "next",
                outputValues: {
                    value: result,
                },
            };
        },
    },
    {
        type: "blueprint.localization.getAvailableLanguages",
        displayName: "Get Available Languages",
        category: "Localization",
        keywords: ["localization", "language", "locale", "i18n", "translation", "list", "selector"],
        graphKinds: ["event", "macro"],
        isPure: false,
        isLatent: true,
        pins: [
            { id: "in", kind: "input", semantic: "exec", label: "In" },
            { id: "next", kind: "output", semantic: "exec", label: "Next" },
            {
                id: "value",
                kind: "output",
                semantic: "data",
                valueType: "any",
                label: "Languages",
            },
        ],
        async execute(ctx) {
            const api = requireHostApi(ctx);
            const config = api.localization.getConfig();
            return {
                nextPort: "next",
                outputValues: {
                    value: (config?.locales ?? []).map(locale => ({
                        code: locale.code,
                        displayName: locale.displayName,
                        isSource: locale.code === config?.sourceLocale,
                    })),
                },
            };
        },
    },
];
