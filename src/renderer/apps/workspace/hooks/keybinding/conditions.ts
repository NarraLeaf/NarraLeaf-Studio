import { FocusArea, FocusContext } from "@/lib/workspace/services/ui/types";

/**
 * Keybinding condition function type
 * Returns true if the keybinding should be active
 */
export type KeybindingCondition = (context: FocusContext) => boolean;

/**
 * Creates a condition that checks if the specified area is focused
 * @param area - The focus area to check
 * @param targetId - Optional specific target ID within the area
 * @returns A condition function
 * 
 * @example
 * // Active when left panel is focused
 * whenFocused(FocusArea.LeftPanel)
 * 
 * @example
 * // Active when a specific panel is focused
 * whenFocused(FocusArea.LeftPanel, "assets-panel")
 */
export function whenFocused(area: FocusArea, targetId?: string): KeybindingCondition {
    return (context: FocusContext) => {
        if (targetId !== undefined) {
            return context.area === area && context.targetId === targetId;
        }
        return context.area === area;
    };
}

/**
 * Creates a condition that checks if the specified target ID is focused (any area)
 * @param targetId - The target ID to check
 * @returns A condition function
 * 
 * @example
 * // Active when any element with this ID is focused
 * whenTargetFocused("my-panel")
 */
export function whenTargetFocused(targetId: string): KeybindingCondition {
    return (context: FocusContext) => context.targetId === targetId;
}

/**
 * Creates a condition that is active when NO dialog is open
 * @returns A condition function
 * 
 * @example
 * // Active only when no dialog is shown
 * whenNoDialog()
 */
export function whenNoDialog(): KeybindingCondition {
    return (context: FocusContext) => context.area !== FocusArea.Dialog;
}

/**
 * Creates a condition that is active when any area except the specified ones is focused
 * @param excludedAreas - Areas where the keybinding should NOT be active
 * @returns A condition function
 * 
 * @example
 * // Active everywhere except in dialogs
 * whenNotIn(FocusArea.Dialog)
 */
export function whenNotIn(...excludedAreas: FocusArea[]): KeybindingCondition {
    return (context: FocusContext) => !excludedAreas.includes(context.area);
}

/**
 * Creates a condition that is active when the editor area is focused
 * @param tabId - Optional specific editor tab ID
 * @returns A condition function
 * 
 * @example
 * // Active when any editor is focused
 * whenEditorFocused()
 * 
 * @example
 * // Active when a specific editor tab is focused
 * whenEditorFocused("image-preview:123")
 */
export function whenEditorFocused(tabId?: string): KeybindingCondition {
    return whenFocused(FocusArea.Editor, tabId);
}

/**
 * Creates a condition that is always true (global keybinding)
 * @returns A condition function that always returns true
 * 
 * @example
 * // Always active
 * always()
 */
export function always(): KeybindingCondition {
    return () => true;
}

/**
 * Creates a condition that is never true (disabled keybinding)
 * @returns A condition function that always returns false
 * 
 * @example
 * // Never active (useful for temporarily disabling)
 * never()
 */
export function never(): KeybindingCondition {
    return () => false;
}

// ============ Condition Combinators ============

/**
 * Combines multiple conditions with AND logic
 * All conditions must be true for the keybinding to be active
 * @param conditions - Array of conditions to combine
 * @returns A combined condition function
 * 
 * @example
 * // Active when left panel is focused AND a specific panel
 * and(
 *   whenFocused(FocusArea.LeftPanel),
 *   whenTargetFocused("assets-panel")
 * )
 */
export function and(...conditions: KeybindingCondition[]): KeybindingCondition {
    return (context: FocusContext) => conditions.every((cond) => cond(context));
}

/**
 * Combines multiple conditions with OR logic
 * Any condition being true will make the keybinding active
 * @param conditions - Array of conditions to combine
 * @returns A combined condition function
 * 
 * @example
 * // Active when either left or right panel is focused
 * or(
 *   whenFocused(FocusArea.LeftPanel),
 *   whenFocused(FocusArea.RightPanel)
 * )
 */
export function or(...conditions: KeybindingCondition[]): KeybindingCondition {
    return (context: FocusContext) => conditions.some((cond) => cond(context));
}

/**
 * Negates a condition
 * @param condition - The condition to negate
 * @returns A negated condition function
 * 
 * @example
 * // Active when NOT in dialog
 * not(whenFocused(FocusArea.Dialog))
 */
export function not(condition: KeybindingCondition): KeybindingCondition {
    return (context: FocusContext) => !condition(context);
}

/**
 * Creates a condition from a boolean getter function
 * Useful for dynamic conditions based on component state
 * @param getter - A function that returns a boolean
 * @returns A condition function
 * 
 * @example
 * // Active based on component state
 * fromGetter(() => isEditing)
 */
export function fromGetter(getter: () => boolean): KeybindingCondition {
    return () => getter();
}

/**
 * Creates a condition that depends on both focus context and external state
 * @param predicate - A function that receives the context and returns boolean
 * @returns A condition function
 * 
 * @example
 * // Complex condition with context and state
 * contextual((ctx) => ctx.area === FocusArea.Editor && hasSelection)
 */
export function contextual(
    predicate: (context: FocusContext) => boolean
): KeybindingCondition {
    return predicate;
}

