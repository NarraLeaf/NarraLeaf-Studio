import type {
    TestAvailabilityContext,
    TestBooleanParameterDefinition,
    TestDefinition,
    TestParameterOption,
    TestParameterValue,
    TestParameterValues,
    TestSelectParameterDefinition,
} from "./types";

/**
 * Turning a test's parameter *declarations* into the values a run is started with.
 *
 * Deliberately pure and free of the workspace: the host asks a definition for its option lists once
 * per picker open, and everything after that - which value a row starts on, whether a remembered
 * one still exists, what `ctx.parameters` ends up carrying - is arithmetic over the answers. Keeping
 * it here means the picker and the run controller cannot disagree about it, and that it can be
 * tested without a project on disk.
 *
 * The one rule everything below serves: **a value the declaration cannot account for is not a
 * value.** An ending the author deleted must not leave the picker pointing at nothing, and it must
 * not reach `run` either.
 */

/**
 * A declaration together with the options it offered when it was asked.
 *
 * The option list is captured rather than re-derived because `options(ctx)` is a call into a
 * definition - possibly a plugin's - and asking twice could answer twice differently, which would
 * put the picker's dropdown and the value it starts a run with out of step.
 */
export type ResolvedTestParameter =
    | { kind: "select"; definition: TestSelectParameterDefinition; options: readonly TestParameterOption[] }
    | { kind: "boolean"; definition: TestBooleanParameterDefinition };

/** The parameter's id, whichever kind it is. */
export function testParameterId(parameter: ResolvedTestParameter): string {
    return parameter.definition.id;
}

/**
 * Ask a definition for its parameters, with every `select`'s list already evaluated.
 *
 * A definition that throws while the picker is opening is a defect in it and not a reason to take
 * the picker down, so the same treatment `checkAvailability` gets applies: log it, and count the
 * list as empty - which surfaces as the test being unavailable, named, rather than as a dropdown
 * that quietly lost its contents.
 */
export function resolveTestParameters(
    definition: TestDefinition,
    ctx: TestAvailabilityContext,
): ResolvedTestParameter[] {
    const declared = definition.parameters ?? [];
    const resolved: ResolvedTestParameter[] = [];
    const seen = new Set<string>();

    for (const parameter of declared) {
        // First declaration wins. The values are keyed by id, so a duplicate would draw two rows
        // that write the same key and disagree about what it holds.
        if (seen.has(parameter.id)) {
            continue;
        }
        seen.add(parameter.id);

        if (parameter.kind === "boolean") {
            resolved.push({ kind: "boolean", definition: parameter });
            continue;
        }

        let options: TestParameterOption[] = [];
        try {
            options = parameter.options(ctx) ?? [];
        } catch (error) {
            console.error(
                `[testing] ${definition.id} could not list options for parameter ${parameter.id}`,
                error,
            );
        }
        resolved.push({ kind: "select", definition: parameter, options });
    }

    return resolved;
}

/**
 * The first `select` with nothing to choose from, or `null`.
 *
 * What the host's availability gate reads: a test that cannot be told which ending to walk to
 * cannot be run, and saying so on the row - with the parameter's own name - is the honest form of
 * that. See {@link TestSelectParameterDefinition.options}.
 */
export function findEmptyTestSelect(
    parameters: readonly ResolvedTestParameter[],
): TestSelectParameterDefinition | null {
    for (const parameter of parameters) {
        if (parameter.kind === "select" && parameter.options.length === 0) {
            return parameter.definition;
        }
    }
    return null;
}

/**
 * What one parameter starts on: the remembered value if it is still a value, otherwise the default.
 *
 * `undefined` only for a `select` with no options, which is the state that makes the whole test
 * unavailable - so nothing downstream has to invent a value for it.
 */
export function resolveTestParameterValue(
    parameter: ResolvedTestParameter,
    remembered: TestParameterValue | undefined,
): TestParameterValue | undefined {
    if (parameter.kind === "boolean") {
        return typeof remembered === "boolean" ? remembered : parameter.definition.defaultValue ?? false;
    }
    const has = (value: string | undefined): boolean =>
        value !== undefined && parameter.options.some(option => option.value === value);
    if (typeof remembered === "string" && has(remembered)) {
        return remembered;
    }
    // The author deleted the ending this used to point at, or the definition names a default it no
    // longer offers. Either way the first option is the only answer that is certainly still real.
    if (has(parameter.definition.defaultValue)) {
        return parameter.definition.defaultValue;
    }
    return parameter.options[0]?.value;
}

/**
 * The values a run would start with, for every declared parameter and no other id.
 *
 * This is the whole of invariant 2 for parameters (see `types.ts`): whatever the caller hands over,
 * only declared ids come out, and only values the declaration can account for.
 */
export function resolveTestParameterValues(
    parameters: readonly ResolvedTestParameter[],
    remembered?: TestParameterValues,
): TestParameterValues {
    const values: Record<string, TestParameterValue> = {};
    for (const parameter of parameters) {
        const value = resolveTestParameterValue(parameter, remembered?.[parameter.definition.id]);
        if (value !== undefined) {
            values[parameter.definition.id] = value;
        }
    }
    return values;
}
