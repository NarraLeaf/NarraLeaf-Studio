/**
 * Build-time flag, replaced by esbuild's `define`. `true` in development
 * bundles (see project/build/build-apps.js and project/app/dev-electron.js),
 * `false` in production, so guarded dev-only code is tree-shaken out of
 * release builds.
 */
declare const __NLS_STUDIO_DEV__: boolean;

/**
 * Stylesheets are imported for their side effect only - esbuild extracts them
 * into the bundle (project/build/postCss-plugin.js) and there is no runtime
 * value to bind. The body is deliberately empty rather than declaring a default
 * export: this repo does not use CSS modules, so a declared default would type
 * as a real object something that is `undefined` at runtime.
 *
 * Needed because the TypeScript 7 preview behind `yarn lint:oxc` treats an
 * unresolvable side-effect import as an error (TS2882) where 5.x let it pass.
 */
declare module "*.css" {}
