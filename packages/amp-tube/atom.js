// atom manifest — tube amp stage (input HP → oversampled tube saturation →
// bass/mid/treble tone stack → level). streaming: false: the oversampled
// saturation stage needs whole-signal context (family precedent).

import ampFn from './tube.js'

export const amp = (ctx) => (inputs, outputs, params) => {
	const inp = inputs[0], out = outputs[0]
	if (!inp || !inp.length) return
	const opts = {
		fs: ctx.sampleRate,
		gain: params.gain[0],
		bass: params.bass[0],
		mid: params.mid[0],
		treble: params.treble[0],
		level: params.level[0],
	}
	for (let c = 0; c < inp.length; c++) {
		out[c].set(inp[c])
		ampFn(out[c], opts)
	}
}
amp.channels = 'any'
amp.streaming = false
amp.params = {
	gain:   { type: 'number', min: 0, max: 1, default: 0.5 },
	bass:   { type: 'number', min: -12, max: 12, default: 0, unit: 'dB' },
	mid:    { type: 'number', min: -12, max: 12, default: 0, unit: 'dB' },
	treble: { type: 'number', min: -12, max: 12, default: 0, unit: 'dB' },
	level:  { type: 'number', min: 0, max: 1, default: 0.7 },
}
