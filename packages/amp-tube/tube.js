// Tube amp stage — input highpass (rumble/DC) → oversampled tube saturation
// (@audio/saturate-tube) → bass/mid/treble tone stack (RBJ shelves + peaking) → level.
// Classical composition model (no circuit simulation; NAM-class capture = @audio/neural-amp).

import saturate from '@audio/saturate-tube'
import { lowshelf, highshelf, peaking, process as biquad } from '@audio/biquad'

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
