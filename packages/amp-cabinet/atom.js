// atom manifest — speaker cabinet sim. Without an IR the kernel runs its classical
// closed-back 12" biquad chain — that scalar form is what this atom exposes.
// A captured IR is an array argument: use the kernel via direct import for that.
// streaming: false: the kernel builds its filter state inside each call.

import cabinetFn from './cabinet.js'

export const cabinet = (ctx) => (inputs, outputs, params) => {
	const inp = inputs[0], out = outputs[0]
	if (!inp || !inp.length) return
	for (let c = 0; c < inp.length; c++) {
		out[c].set(inp[c])
		cabinetFn(out[c], { fs: ctx.sampleRate, mix: params.mix[0] })
	}
}
cabinet.channels = 'any'
cabinet.streaming = false
cabinet.params = {
	mix: { type: 'number', min: 0, max: 1, default: 1 },
}
