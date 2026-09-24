/**
 * Vertical magnification of a waveform canvas.
 *
 * Display only - it scales how tall the samples are drawn, never what plays. A quiet intro drawn at
 * its true height is a flat line, and an author placing a loop point inside one needs its shape.
 * Samples magnified past the lane are clipped at its edge, so a loud passage reads as a solid band
 * rather than spilling into the neighbouring lane.
 */

/** The most the samples can be magnified: 32x is about 30 dB, enough to lift room tone into view. */
export const MAX_AMPLITUDE = 32;
/** One wheel notch. */
const AMPLITUDE_STEP = 1.25;

/** One wheel notch of magnification: up magnifies, down shrinks back towards true size. */
export function stepAmplitude(current: number, deltaY: number): number {
    if (deltaY === 0) {
        return current;
    }
    const next = deltaY < 0 ? current * AMPLITUDE_STEP : current / AMPLITUDE_STEP;
    // Snap to exactly 1 near the bottom, so winding back always lands on the true height.
    return next < 1.01 ? 1 : Math.min(MAX_AMPLITUDE, next);
}

/** The corner readout while magnified; nothing at true size, where there is nothing to say. */
export function amplitudeLabel(amplitude: number): string | null {
    return amplitude > 1 ? `\u00d7${amplitude.toFixed(1)}` : null;
}
