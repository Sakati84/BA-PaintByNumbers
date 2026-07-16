const DIGIT_WIDTH = 5;
const DIGIT_HEIGHT = 7;
const DIGIT_GAP = 1;
const NUMBER_GLYPH_MARGIN = 0.5;

/**
 * Returns true only when the complete 5x7 number glyph box fits inside the
 * marker's measured interior circle. The half diagonal keeps both raster and
 * vector labels within the region instead of forcing unreadable tiny text.
 */
export function canFitNumberGlyph(radius: number, labelText: string): boolean {
  const digitCount = Math.max(1, labelText.length);
  const columns = digitCount * DIGIT_WIDTH + Math.max(0, digitCount - 1) * DIGIT_GAP;
  return radius >= Math.hypot(columns, DIGIT_HEIGHT) * 0.5 + NUMBER_GLYPH_MARGIN;
}

/** Keeps the fallback dot and its outline inside the measured marker radius. */
export function fallbackColorDotRadius(markerRadius: number): number {
  return Math.max(0.65, Math.min(2, markerRadius * 0.6));
}
