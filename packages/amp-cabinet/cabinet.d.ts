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

/** A biquad section, normalized (a0 = 1), as `@audio/biquad` makes it. */
export interface Section { b0: number; b1: number; b2: number; a1: number; a2: number }

/** The biquad chain's sections at `fs`, in order: 70 Hz highpass, 110 Hz bump, 2.4 kHz peak, 4.5 and 5.2 kHz lowpasses. */
export function chain(fs: number): Section[]

/** A number as a host gives a processor its values: a 1-length array. */
export type Value = ArrayLike<number>

/** State of `stream`: the chain's, or with an IR, that IR at unit energy and the input history it reads. */
export interface CabinetState { chain: Section[] | null; z: Float64Array | null; h: Float32Array | null; x: Float32Array | null; w: number }

/** State for `stream` at `fs` (default 44100); with `ir`, convolving with it. */
export function state(fs?: number, ir?: Float32Array): CabinetState

/**
 * Streaming form, with no latency: `length` samples of `data` in place (default all), `state` carried from call to
 * call; `mix` read at each call, applying to the IR only. The IR runs in direct form, ir.length multiplications a
 * sample: bit for bit the whole call with an IR of up to 1024 taps, which `@audio/reverb-convolution` 1.0 sums
 * directly too. `mixes`: the mix for each sample, in place of `values`' (the ./audio processor's glide). Returns
 * `data`.
 */
export function stream(data: Float32Array, values: { mix: Value }, state: CabinetState, length?: number, mixes?: Float64Array): Float32Array
