import { useMemo } from "react";
import { useTranslation } from "@/lib/i18n";
import type { ContextMenuDef } from "@/lib/components/elements/ContextMenu";
import { useWorkspaceFrozen } from "../../hooks/useWorkspaceFrozen";

/**
 * What a control inside an editor renders as while the workspace is frozen.
 *
 * The correctness half of freeze is not here and never will be: `@/lib/app/writeFreeze` refuses every
 * write of project data at the boundary, so nothing a panel does while frozen reaches the author's
 * files. This module is the other half - **do not offer an action that cannot happen.** Measured
 * before it existed: a frozen workspace let the author walk the whole New Scene flow, name the scene,
 * press OK, and get a tab for a scene that was never written. The app said yes and then discarded it.
 *
 * It follows `components/ui/freezeActionPolicy` (the same decision, for the top bar) on all four
 * counts, because a workspace where the top bar and the panels disagree about what a freeze looks like
 * teaches the author nothing:
 *
 *  - **Disabled, not hidden.** A control that vanishes cannot explain itself; the author reads the gap
 *    as a broken editor rather than as a frozen project. So {@link FreezeGuard.writes} greys a button
 *    and puts the reason on it, and never removes it.
 *  - **One reason, one string.** `workspace.shell.freeze.unavailable` is the same text the top bar
 *    uses. The author learns "this is what frozen looks like" once instead of reading a different
 *    excuse per panel.
 *  - **Navigation, selection and inspection are never touched.** Opening a tab, selecting an element,
 *    reading its properties, expanding a tree, scrolling a timeline: all of that is the entire point of
 *    a frozen workspace, so nothing here has any business disabling it. Only the write is blocked.
 *  - **Computed at render, never written back.** Documents, registries and registered menu items
 *    outlive a freeze; a freeze that marked them disabled would leave them disabled after the thaw.
 *
 * Two shapes, because the surfaces genuinely differ. A button has somewhere to put a reason;
 * a drag gesture does not, and {@link FreezeGuard.gesture} makes it inert instead - a half-inert
 * gesture (drag starts, drop does nothing) is worse than either, because it reads as a bug.
 */
export type FrozenControlProps = {
    disabled: boolean;
    /** Hover text: the freeze reason when the freeze is why, the caller's own otherwise. */
    title: string | undefined;
};

export type FreezeGuard = {
    /** Whether this window's project data is frozen right now. */
    readonly frozen: boolean;
    /**
     * The single hover string for everything the freeze switches off.
     *
     * Exposed for the call sites that build their own `title` (a control that already composes one,
     * a tooltip component); prefer {@link writes}, which picks between this and the caller's own.
     */
    readonly reason: string;
    /**
     * Render props for a control whose action writes project data.
     *
     * `ownDisabled` / `ownTitle` are the control's existing state, kept intact: a button that was
     * already disabled for its own reason must not start claiming the freeze is why, because that
     * lie outlives the thaw.
     */
    writes(ownDisabled?: boolean, ownTitle?: string): FrozenControlProps;
    /**
     * The `disabled` field for a menu row that writes project data.
     *
     * `disabled` alone, with no reason: `ContextMenuItemDef` has no tooltip, and appending an
     * explanation to every greyed label would turn a menu into a paragraph. The row still renders,
     * so the author can see the action exists - which is the same bargain the top bar's menus make.
     */
    menuRow(ownDisabled?: boolean): { disabled: boolean };
    /**
     * A drag/pointer handler, or `undefined` while frozen - so the gesture is never half-attached.
     *
     * Returning `undefined` rather than a no-op is deliberate: `draggable`, `onDragOver` and React
     * Flow's `nodesDraggable` all key off whether a handler is there, and a present-but-inert
     * `onDragStart` produces a drag that picks up and refuses to drop. Pass the whole set through
     * this, or none of it.
     */
    gesture<F>(handler: F): F | undefined;
    /**
     * A handler that has no control to grey out - a keybinding, a dialog's confirm, a drop target -
     * wrapped so it does nothing while frozen.
     *
     * The author is not told here. They will be: the write boundary announces the refusal through
     * `SaveStatusService` the moment anything tries to save, and a toast per blocked keystroke would
     * bury that one useful message under a dozen.
     */
    run<A extends unknown[], R>(handler: (...args: A) => R): (...args: A) => R | undefined;
};

/**
 * The decision itself, with no React in it, so the surfaces that opt in can be tested without
 * mounting an editor. {@link useFreezeGuard} is the only thing that should build one in app code.
 */
export function makeFreezeGuard(frozen: boolean, reason: string): FreezeGuard {
    return {
        frozen,
        reason,
        writes(ownDisabled = false, ownTitle) {
            return {
                disabled: ownDisabled || frozen,
                // The caller's own reason wins when it is the one that applies: an already-disabled
                // control is disabled for its own cause, freeze or no freeze.
                title: ownDisabled ? ownTitle : frozen ? reason : ownTitle,
            };
        },
        menuRow(ownDisabled = false) {
            return { disabled: ownDisabled || frozen };
        },
        gesture(handler) {
            return frozen ? undefined : handler;
        },
        run(handler) {
            return (...args) => (frozen ? undefined : handler(...args));
        },
    };
}

/**
 * Disable every row of a context menu that was built somewhere else, naming the ones that stay live.
 *
 * For the menus a module does not assemble itself - the UI editor's canvas menu is put together by
 * `@/lib/ui-editor/context-menu/buildCanvasContextMenu`, and widget modules contribute rows to it at
 * runtime - so {@link FreezeGuard.menuRow} cannot be spread onto the literals.
 *
 * `readOnlyIds` names what KEEPS working, never what is switched off, for the same reason the top
 * bar's exemption is a table rather than a flag: the list of ways to mutate a document grows, and a
 * new row that nobody remembered to add would default to writable inside a frozen project. Getting
 * the exemption wrong greys out a harmless row; getting an opt-out wrong offers a write.
 *
 * A row with a submenu stays enabled and has its children walked instead - a group that could not be
 * opened would hide what the freeze is doing, and the author is here to look.
 */
export function freezeContextMenuRows(
    items: ContextMenuDef,
    frozen: boolean,
    readOnlyIds: ReadonlySet<string>,
): ContextMenuDef {
    if (!frozen) {
        return items;
    }
    return items.map(item => {
        if ("separator" in item && item.separator) {
            return item;
        }
        if ("submenu" in item && item.submenu) {
            return { ...item, submenu: freezeContextMenuRows(item.submenu, true, readOnlyIds) as typeof item.submenu };
        }
        if (readOnlyIds.has(item.id)) {
            return item;
        }
        return { ...item, disabled: true };
    });
}

/**
 * How a workspace surface opts into the frozen read-only affordance: call this, then route every
 * control and gesture that writes project data through the returned guard.
 *
 * Reads the freeze through `useWorkspaceFrozen`, which reads `WorkspaceFreezeService` - the
 * workspace-scoped face of the latch, not the module latch, so it thaws on a project switch.
 */
export function useFreezeGuard(): FreezeGuard {
    const frozen = useWorkspaceFrozen();
    const { t } = useTranslation();
    const reason = t("workspace.shell.freeze.unavailable");
    return useMemo(() => makeFreezeGuard(frozen, reason), [frozen, reason]);
}
