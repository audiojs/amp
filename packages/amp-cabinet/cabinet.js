// Cabinet simulation — convolve with a speaker impulse response (capture your own with
// @audio/measure-ir). Without an IR, a classical speaker-sim biquad chain approximates a
// closed-back 12" cab: 70 Hz highpass, low bump, presence peak, steep rolloff above ~4.5 kHz.

import convolve from '@audio/reverb-convolution'
import { lowpass, highpass, peaking, process as biquad } from '@audio/biquad'

/** The biquad chain's sections at `fs`, in order */
export const chain = fs => [
	highpass(70, 0.707, fs),
	peaking(110, 1, fs, 2),
	peaking(2400, 1.2, fs, 3),
	lowpass(4500, 0.707, fs),
	lowpass(5200, 0.707, fs),
]

/**
 * @param {Float32Array} data — mono PCM, processed in place
 * @param {object} opts — { fs=44100, ir (Float32Array — measured cab IR), mix=1 }
 */
export default function cabinet (data, { fs = 44100, ir, mix = 1 } = {}) {
	if (ir) return convolve(data, { ir, mix, normalize: true })
	for (let c of chain(fs)) biquad(data, c)
	return data
}

/**
 * State for stream() at `fs`: the chain's, or with `ir` that IR at unit energy (as cabinet() scales it) and the last
 * ir.length samples of input, twice over so that they read in one run
 */
export function state (fs = 44100, ir) {
	if (!ir) return { chain: chain(fs), z: new Float64Array(10), h: null, x: null, w: 0 }
	let e = 0
	for (let j = 0; j < ir.length; j++) e += ir[j] * ir[j]
	let g = e > 0 ? 1 / Math.sqrt(e) : 1
	return { chain: null, z: null, h: Float32Array.from(ir, v => v * g), x: new Float32Array(2 * ir.length), w: 0 }
}

/**
 * Streaming form, with no latency: `n` samples of `data` in place, `s` carried from call to call. `p` holds mix as a
 * host gives a processor its values, a 1-length array, read at each call; as in cabinet(), only the IR blends by it.
 * The IR runs in direct form, ir.length multiplications a sample, the sum in cabinet()'s order (bit for bit its
 * direct path, an IR of up to 1024 taps; @audio/reverb-convolution 1.0 runs a longer one by FFT). `mixes` (optional, a
 * Float64Array): the mix for each of the `n` samples, in place of p's, for a mix that moves within the call (the
 * ./audio processor's glide).
 */
export function stream (data, p, s, n = data.length, mixes) {
	let h = s.h
	if (!h) {
		for (let k = 0, z = s.z; k < 5; k++) {
			let c = s.chain[k], z1 = z[2 * k], z2 = z[2 * k + 1]
			for (let i = 0; i < n; i++) {
				let x = data[i], y = c.b0 * x + z1
				z1 = c.b1 * x - c.a1 * y + z2
				z2 = c.b2 * x - c.a2 * y
				data[i] = y
			}
			z[2 * k] = z1; z[2 * k + 1] = z2
		}
		return data
	}
	let L = h.length, x = s.x, w = s.w, mix = p.mix[0]
	for (let i = 0; i < n; i++, w = w + 1 < L ? w + 1 : 0) {
		let v = data[i], acc = 0
		x[w] = x[w + L] = v
		for (let j = 0, o = w + L; j < L; j++) acc += h[j] * x[o - j]
		let m = mixes ? mixes[i] : mix
		data[i] = v * (1 - m) + acc * m
	}
	s.w = w
	return data
}
