/** @type {import('tailwindcss').Config} */
module.exports = {
    content: [
        './src/renderer/**/*.{ts,tsx,js,jsx,html}',
        // Built-in plugins are compiled from this repo and render inside Studio
        // windows, sharing this one stylesheet — but they are bundled separately
        // by esbuild, so nothing here scans them unless we say so. Without this
        // glob a built-in plugin silently gets only the utilities some renderer
        // file happens to use too, and any class it alone needs is never
        // emitted (a missing `grid-cols-[...]` collapses its grid to one column).
        //
        // Third-party plugins cannot be covered this way: they are not present
        // at build time, so they are limited to the utilities this stylesheet
        // already carries.
        './src/builtin-plugins/**/*.{ts,tsx}',
        // The game runtime, for exactly the same reason: it shares this one stylesheet but is
        // bundled by build-runtime.js, so nothing here scanned it. Every class the runtime alone
        // used was therefore never emitted, and the screen a game showed when it failed to read
        // its pack was styled by whichever of its classes some Studio file happened to use too -
        // which was none of them. A silent failure by construction: the markup is right, the rule
        // does not exist, and the only way to see it is to look at the rendered page.
        './src/runtime/**/*.{ts,tsx}',
        './project/assets/**/*.ejs',
    ],
    // Dark is the default and light is the prefers-color-scheme override (see
    // styles.css), which Electron resolves from the `ui.themeMode` setting via
    // nativeTheme. Theme-aware components use the semantic color tokens below,
    // never a `dark:` variant — the variant is unscoped, so in the game runtime
    // (which shares this stylesheet and must stay dark) it would follow the
    // player's OS instead.
    darkMode: 'media',
    theme: {
        extend: {
            colors: {
                // The accent. Channels live in styles.css `:root`, where they
                // default to the brand anchor #40a8c4 — the value a shipped game
                // always gets. Studio windows override the variable from the
                // `ui.accentColor` setting, so every `*-primary` utility in the
                // product follows it. Presets only, all hue-shifts of the anchor
                // at low saturation: see @shared/constants/accent and
                // docs/design-system.md. Secondary semantic colors below derive
                // from the anchor and do NOT follow the accent.
                primary: 'rgb(var(--nl-primary) / <alpha-value>)',

                // Ink to put ON the accent. Use `text-on-primary`, never `text-white`, on a
                // solid `bg-primary`: a user-chosen light accent flips this to dark ink so the
                // label stays readable. See `accentForeground` in @shared/constants/accent.
                'on-primary': 'rgb(var(--nl-on-primary) / <alpha-value>)',

                // Dark surface ladder (5 depths). Channel values live in
                // styles.css :root so raw CSS / inline styles can reference the
                // same source via rgb(var(--nl-surface)).
                surface: {
                    DEFAULT: 'rgb(var(--nl-surface) / <alpha-value>)',
                    canvas: 'rgb(var(--nl-surface-canvas) / <alpha-value>)',
                    sunken: 'rgb(var(--nl-surface-sunken) / <alpha-value>)',
                    raised: 'rgb(var(--nl-surface-raised) / <alpha-value>)',
                    overlay: 'rgb(var(--nl-surface-overlay) / <alpha-value>)',
                },

                // Foreground text ramp.
                fg: {
                    DEFAULT: 'rgb(var(--nl-fg) / <alpha-value>)',
                    muted: 'rgb(var(--nl-fg-muted) / <alpha-value>)',
                    subtle: 'rgb(var(--nl-fg-subtle) / <alpha-value>)',
                },

                // Hairline borders. Full color values (alpha baked in) that
                // flip between white overlays (dark) and ink overlays (light);
                // see styles.css. No `/alpha` modifier support — the alpha is
                // part of the token.
                edge: {
                    DEFAULT: 'var(--nl-edge)',
                    subtle: 'var(--nl-edge-subtle)',
                    strong: 'var(--nl-edge-strong)',
                },

                // Translucent FILLS (button secondary, hover backgrounds,
                // subtle surfaces). Same values as `edge` but a distinct role so
                // background usage never borrows a border token.
                fill: {
                    DEFAULT: 'var(--nl-fill)',
                    subtle: 'var(--nl-fill-subtle)',
                    strong: 'var(--nl-fill-strong)',
                },

                // The story command line's syntax roles. The verb uses `primary`
                // (it follows the accent) and the scaffold uses `fg-subtle`, so
                // only these two need tokens of their own. See styles.css.
                syntax: {
                    target: 'rgb(var(--nl-syntax-target) / <alpha-value>)',
                    value: 'rgb(var(--nl-syntax-value) / <alpha-value>)',
                },

                // Semantic accents — low-saturation, hue-shifted from the anchor.
                binding: 'rgb(var(--nl-binding) / <alpha-value>)',
                danger: 'rgb(var(--nl-danger) / <alpha-value>)',
                success: 'rgb(var(--nl-success) / <alpha-value>)',
                warning: 'rgb(var(--nl-warning) / <alpha-value>)',
            },
            fontSize: {
                // Single small tier — collapses the ad-hoc text-[9px]/[10px]/[11px].
                '2xs': ['0.6875rem', { lineHeight: '1rem' }],
            },
            fontWeight: {
                normal: '300',
            },
            keyframes: {
                'slide-in-right': {
                    '0%': { transform: 'translateX(100%)', opacity: '0' },
                    '100%': { transform: 'translateX(0)', opacity: '1' },
                },
                'fade-in': {
                    '0%': { opacity: '0' },
                    '100%': { opacity: '1' },
                },
                'scale-in': {
                    '0%': { transform: 'scale(0.95)', opacity: '0' },
                    '100%': { transform: 'scale(1)', opacity: '1' },
                },
                // Two-bar indeterminate progress (the familiar Material pattern): each
                // bar grows/shrinks as it sweeps via animated left/right, and the two
                // are offset in time so the track is never empty. Reads clearly as "busy".
                'progress-indeterminate-1': {
                    '0%': { left: '-35%', right: '100%' },
                    '60%': { left: '100%', right: '-90%' },
                    '100%': { left: '100%', right: '-90%' },
                },
                'progress-indeterminate-2': {
                    '0%': { left: '-200%', right: '100%' },
                    '60%': { left: '107%', right: '-8%' },
                    '100%': { left: '107%', right: '-8%' },
                },
            },
            animation: {
                'slide-in-right': 'slide-in-right 0.3s ease-out',
                'fade-in': 'fade-in 0.2s ease-out',
                'scale-in': 'scale-in 0.2s ease-out',
                'progress-indeterminate-1': 'progress-indeterminate-1 2.1s cubic-bezier(0.65,0.815,0.735,0.395) infinite',
                'progress-indeterminate-2': 'progress-indeterminate-2 2.1s cubic-bezier(0.165,0.84,0.44,1) 1.15s infinite',
            },
        }
    },
    plugins: [],
}