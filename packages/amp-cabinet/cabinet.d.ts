/** Cabinet simulation — measured-IR convolution, or a classical speaker-sim biquad chain without one. */
export interface CabinetOptions {
  /** sample rate in Hz, default 44100 */
  fs?: number
  /** measured cabinet impulse response; when set, bypasses the biquad chain entirely */
  ir?: Float32Array
  /** 0..1, wet/dry blend — only applies to the `ir` path; the biquad chain ignores it, default 1 */
  mix?: number
}

/** Process a mono buffer in place; returns the same array. */
export default function cabinet(data: Float32Array, options?: CabinetOptions): Float32Array
