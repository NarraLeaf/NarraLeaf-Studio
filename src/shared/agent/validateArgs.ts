import type { AgentJsonSchema } from "./tools";

/**
 * Check a tool call's arguments against the tool's `inputSchema`.
 *
 * Only the part of JSON Schema the tool table actually uses: `type`, `properties`, `required`,
 * `items`, `enum`, `additionalProperties` (as a boolean or a schema), `minimum` / `maximum` and
 * `oneOf`. A schema with no `type` accepts any value, which is how `variable_upsert`'s
 * `defaultValue` says "of the declared type" without a second keyword. `default` and `description`
 * are documentation here: defaults are applied by whoever reads the argument, not invented on the
 * way through.
 *
 * Written rather than borrowed because the table is small and fixed, and because the answer has to
 * be something a model can act on - a short list of `path: what is wrong` lines - rather than the
 * shape a general validator reports in.
 *
 * Pure and shared, so main validates before routing a call and a test can pin every rule.
 */

export type AgentArgsValidation = { ok: true } | { ok: false; errors: string[] };

/** Enough to say what is wrong without burying it. */
const MAX_ERRORS = 8;

export function validateAgentArgs(schema: AgentJsonSchema, value: unknown): AgentArgsValidation {
    const errors: string[] = [];
    check(schema, value, "", errors);
    return errors.length === 0 ? { ok: true } : { ok: false, errors: errors.slice(0, MAX_ERRORS) };
}

function check(schema: AgentJsonSchema, value: unknown, path: string, errors: string[]): void {
    if (errors.length >= MAX_ERRORS) {
        return;
    }
    const where = path || "arguments";

    if (schema.oneOf && schema.oneOf.length > 0) {
        const matches = schema.oneOf.filter(option => {
            const scratch: string[] = [];
            check(option, value, path, scratch);
            return scratch.length === 0;
        });
        if (matches.length !== 1) {
            errors.push(`${where}: must match exactly one of ${schema.oneOf.length} allowed shapes (matched ${matches.length})`);
            return;
        }
    }

    if (schema.type && !hasType(schema.type, value)) {
        errors.push(`${where}: expected ${article(schema.type)}, got ${describe(value)}`);
        return;
    }

    if (schema.enum && !schema.enum.some(option => option === value)) {
        errors.push(`${where}: must be one of ${schema.enum.map(option => JSON.stringify(option)).join(", ")}`);
        return;
    }

    if (typeof value === "number") {
        if (schema.minimum !== undefined && value < schema.minimum) {
            errors.push(`${where}: must be at least ${schema.minimum}`);
        }
        if (schema.maximum !== undefined && value > schema.maximum) {
            errors.push(`${where}: must be at most ${schema.maximum}`);
        }
    }

    if (Array.isArray(value) && schema.items) {
        value.forEach((item, index) => check(schema.items!, item, `${path}[${index}]`, errors));
        return;
    }

    if (isPlainObject(value) && (schema.properties || schema.required || schema.additionalProperties !== undefined)) {
        const properties = schema.properties ?? {};
        for (const name of schema.required ?? []) {
            if (!(name in value) || value[name] === undefined) {
                errors.push(`${join(path, name)}: required`);
            }
        }
        for (const [name, item] of Object.entries(value)) {
            if (item === undefined) {
                continue;
            }
            const property = properties[name];
            if (property) {
                check(property, item, join(path, name), errors);
            } else if (schema.additionalProperties === false) {
                const known = Object.keys(properties);
                errors.push(`${join(path, name)}: unknown argument${known.length ? ` (expected ${known.join(", ")})` : ""}`);
            } else if (isPlainObject(schema.additionalProperties)) {
                check(schema.additionalProperties, item, join(path, name), errors);
            }
        }
    }
}

function hasType(type: NonNullable<AgentJsonSchema["type"]>, value: unknown): boolean {
    switch (type) {
        case "object":
            return isPlainObject(value);
        case "array":
            return Array.isArray(value);
        case "string":
            return typeof value === "string";
        case "boolean":
            return typeof value === "boolean";
        case "number":
            return typeof value === "number" && Number.isFinite(value);
        case "integer":
            return typeof value === "number" && Number.isInteger(value);
        case "null":
            return value === null;
        default:
            return false;
    }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function join(path: string, name: string): string {
    return path ? `${path}.${name}` : name;
}

function article(type: string): string {
    return /^[aeiou]/.test(type) ? `an ${type}` : `a ${type}`;
}

function describe(value: unknown): string {
    if (value === null) {
        return "null";
    }
    if (Array.isArray(value)) {
        return "an array";
    }
    if (typeof value === "number") {
        return Number.isInteger(value) ? "an integer" : "a number";
    }
    return article(typeof value);
}
