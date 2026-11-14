import type { LocalizationUnit } from "@shared/types/localization";

/** Store any unit id as an ordinary own property in the locale document. */
export function setLocalizationUnit(
    units: Record<string, LocalizationUnit>,
    unitId: string,
    unit: LocalizationUnit,
): void {
    Object.defineProperty(units, unitId, { value: unit, enumerable: true, configurable: true, writable: true });
}

/** A unit exists only when the locale document contains that id. */
export function getLocalizationUnit(
    units: Readonly<Record<string, LocalizationUnit>>,
    unitId: string,
): LocalizationUnit | undefined {
    return Object.hasOwn(units, unitId) ? units[unitId] : undefined;
}
