// Tube amp stage — input highpass (rumble/DC) → oversampled tube saturation
// (@audio/saturate-tube) → bass/mid/treble tone stack (RBJ shelves + peaking) → level.
// Classical composition model (no circuit simulation; NAM-class capture = @audio/neural-amp).

import saturate from '@audio/saturate-tube'
import { lowshelf, highshelf, peaking } from 'digital-filter/iir/biquad.js'

function biquadRun (data, c) {
	let x1 = 0, x2 = 0, y1 = 0, y2 = 0
	for (let i = 0; i < data.length; i++) {
		let x = data[i]
		let y = c.b0 * x + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2
		x2 = x1; x1 = x; y2 = y1; y1 = data[i] = y
	}
}

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
	if (bass) biquadRun(data, lowshelf(120, 0.707, fs, bass))
	if (mid) biquadRun(data, peaking(650, 0.9, fs, mid))
	if (treble) biquadRun(data, highshelf(3200, 0.707, fs, treble))
	for (let i = 0; i < data.length; i++) data[i] *= level
	return data
}
