/** @type {import('tailwindcss').Config} */
module.exports = {
    content: [
        './src/renderer/**/*.{ts,tsx,js,jsx,html}',
        './project/assets/**/*.ejs',
    ],
    theme: {
        extend: {
            colors: {
                // Brand anchor — fixed. Do not change; secondary colors derive
                // from this by hue-shift at low saturation. See docs/design-system.md.
                primary: '#40a8c4',

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

                // Hairline borders (fixed white alphas).
                edge: {
                    DEFAULT: 'rgb(255 255 255 / 0.1)',
                    subtle: 'rgb(255 255 255 / 0.05)',
                    strong: 'rgb(255 255 255 / 0.2)',
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
            },
            animation: {
                'slide-in-right': 'slide-in-right 0.3s ease-out',
                'fade-in': 'fade-in 0.2s ease-out',
                'scale-in': 'scale-in 0.2s ease-out',
            },
        }
    },
    plugins: [],
}