import type { SelectOption } from "@/lib/components/elements";
import {
    formatStageAspectRatio,
    formatStageSize,
    parseStageSize,
    stageSizeValue,
    stageSizesEqual,
    STAGE_SIZE_PRESETS,
    type StageSize,
} from "@shared/types/stageSize";

/** The option that swaps the preset list for two number fields. */
export const CUSTOM_STAGE_SIZE_VALUE = "custom";

/**
 * The sizes offered for a given template.
 *
 * A template that declares sizes offers those and nothing else - its surfaces are positioned in
 * absolute coordinates, so a size it was not drawn for produces an interface hanging off the edge
 * of its own stage. One that declares none (the blank entry, and any template whose manifest is
 * silent) offers the full preset list.
 */
export function offeredStageSizes(templateStageSizes: readonly StageSize[]): readonly StageSize[] {
    return templateStageSizes.length > 0 ? templateStageSizes : STAGE_SIZE_PRESETS;
}

/** Whether the author may type a size of their own, rather than pick one the template allows. */
export function allowsCustomStageSize(templateStageSizes: readonly StageSize[]): boolean {
    return templateStageSizes.length === 0;
}

export function stageSizeSelectOptions(sizes: readonly StageSize[]): SelectOption[] {
    return sizes.map(size => ({
        value: stageSizeValue(size),
        label: formatStageSize(size),
        secondaryLabel: formatStageAspectRatio(size),
    }));
}

/**
 * The size to carry into a newly picked template.
 *
 * Keeps what the author already chose when the template allows it, so walking back to the first
 * page and returning does not quietly reset the stage. Otherwise takes the template's first
 * declared size, which is the only honest answer - the previous choice is one this template's
 * content cannot be laid out at.
 */
export function stageSizeForTemplate(
    current: string,
    templateStageSizes: readonly StageSize[],
): string {
    if (templateStageSizes.length === 0) {
        return current;
    }
    const parsed = parseStageSize(current);
    if (parsed && templateStageSizes.some(size => stageSizesEqual(size, parsed))) {
        return current;
    }
    return stageSizeValue(templateStageSizes[0]);
}
