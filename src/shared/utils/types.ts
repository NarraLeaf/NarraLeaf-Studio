
export type ValuesOf<T> = T[keyof T];
export type Result<T, OK extends true | false = true | false> = OK extends true ? { ok: true; data: T } : {
    ok: false;
    error: string | { code?: string; message: string }
};
export type Overlap<T, U> = {
    [K in keyof T]: K extends keyof U ? T[K] & U[K] : never;
};
export type MayPromise<T> = T | Promise<T>;
export type DeepPartial<T> = {
    [P in keyof T]?: DeepPartial<T[P]>;
}
export type StringKeyOf<T> = Extract<keyof T, string>;
