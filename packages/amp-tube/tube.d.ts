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

/** A number as a host gives a processor its values: a 1-length array. */
export type Value = ArrayLike<number>

/** State of `stream`: the highpass's, @audio/resample-sinc's 4× oversampler and the tone stack's, and the rate and gains designed for. */
export type AmpTubeState = import('@audio/resample-sinc').Oversampler & { hp: Float64Array; c: Float64Array; z: Float64Array; at: Float64Array }

/** Samples the streaming form's output is late: the whole call's tube stage reads that far ahead. */
export declare const LATENCY: 31
/** Samples the tube stage's oversampler still moves once its input stops, past LATENCY (the filters ring on). */
export declare const RING: 31

/** State for `stream` at `fs` (default 44100), for calls of up to `maxBlockSize` samples. */
export function state(maxBlockSize: number, fs?: number): AmpTubeState

/**
 * Streaming form: `length` samples of `data` in place (default all), `state` carried from call to call, the output
 * LATENCY samples late (the tube stage oversampled 4×, as `@audio/saturate-tube` at its bias 0.25). Values read at
 * each call. The three tone sections always run: at 0 dB a section passes its input as it is, and one moved to 0
 * rings out. `lanes`: gain and level for each sample, from 0 and `stride`, in place of `values`' (the ./audio
 * processor's glide). Returns `data`.
 */
export function stream(data: Float32Array, values: { gain: Value; bass: Value; mid: Value; treble: Value; level: Value }, state: AmpTubeState, length?: number, lanes?: Float64Array, stride?: number): Float32Array
