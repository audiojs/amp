// Cabinet simulation — convolve with a speaker impulse response (capture your own with
// @audio/measure-ir). Without an IR, a classical speaker-sim biquad chain approximates a
// closed-back 12" cab: 70 Hz highpass, low bump, presence peak, steep rolloff above ~4.5 kHz.

import convolve from '@audio/reverb-convolution'
import { lowpass, highpass, peaking } from 'digital-filter/iir/biquad.js'

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
 * @param {object} opts — { fs=44100, ir (Float32Array — measured cab IR), mix=1 }
 */
export default function cabinet (data, { fs = 44100, ir, mix = 1 } = {}) {
	if (ir) return convolve(data, { ir, mix, normalize: true })
	biquadRun(data, highpass(70, 0.707, fs))
	biquadRun(data, peaking(110, 1, fs, 2))
	biquadRun(data, peaking(2400, 1.2, fs, 3))
	biquadRun(data, lowpass(4500, 0.707, fs))
	biquadRun(data, lowpass(5200, 0.707, fs))
	return data
}
