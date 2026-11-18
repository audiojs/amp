// Tube amp stage — input highpass (rumble/DC) → oversampled tube saturation
// (@audio/saturate-tube) → bass/mid/treble tone stack (RBJ shelves + peaking) → level.
// Classical composition model (no circuit simulation; NAM-class capture = @audio/neural-amp).

import saturate from '@audio/saturate-tube'
import { lowshelf, highshelf, peaking, process as biquad } from '@audio/biquad'
import { oversampler, up, down } from './oversample.js'
export { LATENCY, RING } from './oversample.js'

/**
 * @param {Float32Array} data — mono PCM, processed in place
 * @param {object} opts — { fs=44100, gain=0.5 (0..1 drive), bass=0, mid=0, treble=0 (dB),
 *   level=0.7, oversample=4 }
 */
export default function amp (data, { fs = 44100, gain = 0.5, bass = 0, mid = 0, treble = 0, level = 0.7, oversample = 4 } = {}) {
	// input highpass ~30 Hz (one-pole)
	let a = Math.exp(-2 * Math.PI * 30 / fs)
	let lpState = 0
	for (let i = 0; i < data.length; i++) {
		lpState = data[i] * (1 - a) + lpState * a
		data[i] -= lpState
	}
	saturate(data, { drive: 1 + 7 * gain, fs, oversample })
	if (bass) biquad(data, lowshelf(120, 0.707, fs, bass))
	if (mid) biquad(data, peaking(650, 0.9, fs, mid))
	if (treble) biquad(data, highshelf(3200, 0.707, fs, treble))
	for (let i = 0; i < data.length; i++) data[i] *= level
	return data
}

/** State for stream() at `fs`: calls of up to `maxBlockSize` samples */
export function state (maxBlockSize, fs = 44100) {
	let s = oversampler(maxBlockSize)
	s.hp = new Float64Array(1)                    // the input highpass's lowpass
	s.c = new Float64Array(15)                    // tone stack: low shelf, peaking, high shelf, b0 b1 b2 a1 a2 each
	s.z = new Float64Array(6)                     // and two accumulators each
	s.at = Float64Array.of(fs, NaN, NaN, NaN)     // the rate, and the bass, mid, treble the coefficients are for
	return s
}

/**
 * Streaming form: `n` samples of `data` in place, `s` carried from call to call, the output LATENCY samples late (the
 * tube stage oversampled 4×, as @audio/saturate-tube does it at its bias 0.25). `p` holds gain, bass, mid, treble and
 * level as a host gives a processor its values, each a 1-length array, read at each call. The three tone sections
 * always run, so a gain moved to 0 lets its section ring out: at 0 dB a section passes its input as it is.
 * `lanes` (optional, a Float64Array): gain and level for each of the `n` samples, from 0 and from `M`, in place of p's,
 * for values that move within the call (the ./audio processor's glide); a sample's gain drives its four samples at the
 * higher rate. Without it the call runs on p's values alone.
 */
export function stream (data, p, s, n = data.length, lanes, M = 0) {
	let at = s.at, fs = at[0], a = Math.exp(-2 * Math.PI * 30 / fs), lp = s.hp[0]
	for (let i = 0; i < n; i++) {
		lp = data[i] * (1 - a) + lp * a
		data[i] -= lp
	}
	s.hp[0] = lp
	let drive = 1 + 7 * p.gain[0], norm = Math.tanh(drive * 1.25), dc = Math.tanh(drive * 0.25) / norm, hi = s.hi
	up(s, data, n)
	if (lanes) for (let i = 0, j = 0; i < n; i++) {
		let d = 1 + 7 * lanes[i], nm = Math.tanh(d * 1.25), z = Math.tanh(d * 0.25) / nm
		for (let e = j + 4; j < e; j++) hi[j] = Math.tanh(d * (hi[j] + 0.25)) / nm - z
	}
	else for (let j = 0; j < 4 * n; j++) hi[j] = Math.tanh(drive * (hi[j] + 0.25)) / norm - dc
	down(s, data, n)
	if (at[1] !== p.bass[0] || at[2] !== p.mid[0] || at[3] !== p.treble[0]) {
		at[1] = p.bass[0]
		at[2] = p.mid[0]
		at[3] = p.treble[0]
		tones(s)
	}
	for (let k = 0, c = s.c, z = s.z; k < 3; k++) {
		let b0 = c[5 * k], b1 = c[5 * k + 1], b2 = c[5 * k + 2], a1 = c[5 * k + 3], a2 = c[5 * k + 4], z1 = z[2 * k], z2 = z[2 * k + 1]
		for (let i = 0; i < n; i++) {
			let x = data[i], y = b0 * x + z1
			z1 = b1 * x - a1 * y + z2
			z2 = b2 * x - a2 * y
			data[i] = y
		}
		z[2 * k] = z1; z[2 * k + 1] = z2
	}
	if (lanes) for (let i = 0; i < n; i++) data[i] *= lanes[M + i]
	else for (let i = 0, level = p.level[0]; i < n; i++) data[i] *= level
	return data
}

// The tone stack's coefficients into s.c, for the rate and gains in s.at: @audio/biquad's lowshelf(120, 0.707),
// peaking(650, 0.9) and highshelf(3200, 0.707), RBJ cookbook, the same arithmetic, with no object made
function tones (s) {
	let at = s.at, c = s.c, fs = at[0], w, cw, sw, A, q, a0
	w = Math.PI * 2 * 120 / fs; cw = Math.cos(w); sw = Math.sin(w); A = 10 ** (at[1] / 40); q = Math.sqrt(A) * sw / 0.707
	a0 = (A + 1) + (A - 1) * cw + q
	c[0] = A * ((A + 1) - (A - 1) * cw + q) / a0; c[1] = 2 * A * ((A - 1) - (A + 1) * cw) / a0
	c[2] = A * ((A + 1) - (A - 1) * cw - q) / a0; c[3] = -2 * ((A - 1) + (A + 1) * cw) / a0; c[4] = ((A + 1) + (A - 1) * cw - q) / a0
	w = Math.PI * 2 * 650 / fs; cw = Math.cos(w); q = Math.sin(w) / (2 * 0.9); A = 10 ** (at[2] / 40)
	a0 = 1 + q / A
	c[5] = (1 + q * A) / a0; c[6] = -2 * cw / a0; c[7] = (1 - q * A) / a0; c[8] = -2 * cw / a0; c[9] = (1 - q / A) / a0
	w = Math.PI * 2 * 3200 / fs; cw = Math.cos(w); sw = Math.sin(w); A = 10 ** (at[3] / 40); q = Math.sqrt(A) * sw / 0.707
	a0 = (A + 1) - (A - 1) * cw + q
	c[10] = A * ((A + 1) + (A - 1) * cw + q) / a0; c[11] = -2 * A * ((A - 1) + (A + 1) * cw) / a0
	c[12] = A * ((A + 1) + (A - 1) * cw - q) / a0; c[13] = 2 * ((A - 1) - (A + 1) * cw) / a0; c[14] = ((A + 1) - (A - 1) * cw - q) / a0
}
