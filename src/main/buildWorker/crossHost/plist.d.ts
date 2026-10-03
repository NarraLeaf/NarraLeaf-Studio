/**
 * The `plist` package, which ships no types: the XML property-list reader and writer electron-builder
 * uses for a macOS bundle's Info.plist files. Studio's own packager uses the same one so the files it
 * writes are the files electron-builder writes, byte for byte. Only what that packager calls.
 */
declare module "plist" {
    export type PlistValue = string | number | boolean | Date | Buffer | PlistObject | PlistValue[] | null;
    export type PlistObject = { [key: string]: PlistValue };
    export function parse(xml: string): PlistValue;
    export function build(value: PlistValue): string;
}
