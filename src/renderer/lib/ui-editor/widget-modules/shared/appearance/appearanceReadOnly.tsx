import { createContext, useContext, type ReactNode } from "react";

const AppearanceReadOnlyContext = createContext(false);

/**
 * Whether the appearance panel this control belongs to may be written right now.
 *
 * The panel is an inspector field like any other, so a frozen workspace already clamps it with a
 * `disabled` `<fieldset>` and nearly nothing here has to think about it. This context exists for the
 * one part that the clamp cannot reach: **the per-property animation popover renders through a
 * portal into `document.body`**, so it is not a descendant of that fieldset, and its duration,
 * easing and clear controls would keep accepting input in a project that is not being saved.
 *
 * A context rather than a prop because the popover sits five components below the panel - the panel
 * is the only place that knows, and every layer in between would otherwise have to carry a flag it
 * makes no use of.
 *
 * Reads `false` outside a panel, which is the writable default every other host already gets.
 */
export function useAppearanceReadOnly(): boolean {
  return useContext(AppearanceReadOnlyContext);
}

export function AppearanceReadOnlyProvider({
  value,
  children
}: {
  value: boolean;
  children: ReactNode;
}) {
  return (
    <AppearanceReadOnlyContext.Provider value={value}>
      {children}
    </AppearanceReadOnlyContext.Provider>
  );
}
