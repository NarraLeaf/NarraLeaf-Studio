/**
 * Build-time flag, replaced by esbuild's `define`. `true` in development
 * bundles (see project/build/build-apps.js and project/app/dev-electron.js),
 * `false` in production, so guarded dev-only code is tree-shaken out of
 * release builds.
 */
declare const __NLS_STUDIO_DEV__: boolean;
