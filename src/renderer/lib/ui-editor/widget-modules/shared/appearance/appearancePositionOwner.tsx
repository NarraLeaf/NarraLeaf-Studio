import { createContext, useContext, type ReactNode } from "react";

const AppearancePositionInLayoutContext = createContext(false);

/**
 * Whether this element's position in the state being shown is edited in the layout section instead.
 *
 * Inside a widget that declares its own states, X and Y at the top of the panel already mean "where
 * this sits in the state on screen" - dragging writes there, and typing a number writes there. The
 * appearance model's X and Y offsets are the channel that carries it, which makes them the same
 * number twice under two different names, one of them measured from somewhere the author cannot see.
 * They are hidden there rather than kept in step, so there is one place a position is edited.
 *
 * A context rather than a prop because the fields sit three components below the panel, and every
 * layer in between would otherwise carry a flag it makes no use of. Reads `false` everywhere else,
 * which is the plain appearance model every other element still has.
 */
export function useAppearancePositionInLayout(): boolean {
    return useContext(AppearancePositionInLayoutContext);
}

export function AppearancePositionInLayoutProvider({
    value,
    children,
}: {
    value: boolean;
    children: ReactNode;
}) {
    return (
        <AppearancePositionInLayoutContext.Provider value={value}>
            {children}
        </AppearancePositionInLayoutContext.Provider>
    );
}
