/**
 * Nothing is ever entered outside the editor: a shipped game shows the state its runtime resolves,
 * never one an author is looking at. Returning null keeps `variantOverrideIdFor` on its runtime path.
 */
export function useEnteredElementState(_elementId: string, _enabled: boolean): null {
    return null;
}
