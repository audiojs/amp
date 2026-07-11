/** Tube amp stage — highpass → oversampled tube saturation → bass/mid/treble tone stack → level. */
export interface AmpTubeOptions {
  /** 0..1, drive into the tube stage (maps to drive = 1 + 7·gain), default 0.5 */
  gain?: number
  /** dB, low-shelf at 120 Hz; 0 is a true no-op (stage skipped), default 0 */
  bass?: number
  /** dB, peaking at 650 Hz; 0 is a true no-op (stage skipped), default 0 */
  mid?: number
  /** dB, high-shelf at 3200 Hz; 0 is a true no-op (stage skipped), default 0 */
  treble?: number
  /** output gain multiplier (linear, not dB), default 0.7 */
  level?: number
  /** sample rate in Hz, default 44100 */
  fs?: number
  /** oversample factor passed through to the tube stage, default 4 */
  oversample?: number
}

/** Process a mono buffer in place; returns the same array. */
export default function amp(data: Float32Array, options?: AmpTubeOptions): Float32Array
