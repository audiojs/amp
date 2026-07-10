// Cabinet simulation — convolve with a speaker impulse response (capture your own with
// @audio/measure-ir). Without an IR, a classical speaker-sim biquad chain approximates a
// closed-back 12" cab: 70 Hz highpass, low bump, presence peak, steep rolloff above ~4.5 kHz.

import convolve from '@audio/reverb-convolution'
import { lowpass, highpass, peaking, process as biquad } from '@audio/biquad'

/**
 * @param {Float32Array} data — mono PCM, processed in place
 * @param {object} opts — { fs=44100, ir (Float32Array — measured cab IR), mix=1 }
 */
export default function cabinet (data, { fs = 44100, ir, mix = 1 } = {}) {
	if (ir) return convolve(data, { ir, mix, normalize: true })
	biquad(data, highpass(70, 0.707, fs))
	biquad(data, peaking(110, 1, fs, 2))
	biquad(data, peaking(2400, 1.2, fs, 3))
	biquad(data, lowpass(4500, 0.707, fs))
	biquad(data, lowpass(5200, 0.707, fs))
	return data
}
