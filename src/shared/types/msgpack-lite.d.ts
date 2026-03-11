declare module "msgpack-lite" {
    export function encode(input: unknown): Buffer | Uint8Array;
    export function decode(input: Buffer | Uint8Array | number[]): unknown;
}
