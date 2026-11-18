// Streaming 4× oversampling around a memoryless transfer: the saturate packages' shape() (shape.js) as a stream,
// the input carried from call to call. The taps are @audio/resample-sinc's (a Lanczos-windowed sinc, 16 zero
// crossings a side, each output divided by the sum of its taps), computed once into tables. A whole call of shape()
// reads 20 samples ahead of each output (16 to upsample, 4 more to decimate); a stream cannot, so its output is
// LATENCY samples late. Shifted back by that, it is shape()'s output bit for bit, except within 20 samples of the
// ends of a whole signal, where resample() divides by the sum of the taps that remain inside it.
// One copy in each package that oversamples (saturate-tape, -transistor, -tube, -waveshaper; amp-tube): one text.

const L = 4, HALF = 16, T = 2 * HALF, H = T - 1     // the factor, zero crossings a side, taps, samples of history

/** samples the output is late */
export const LATENCY = 20
/** samples the output still moves once the input stops, past LATENCY (for a transfer that takes 0 to 0) */
export const RING = 19

const sinc = x => x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x)
// UP[p·T + k]: tap k of the output p/4 of a sample past an input; UW[p]: their sum. DN and DW: the decimator's.
// Each tap as resample() computes it, sinc(x)·sinc(x / 16) at x = (t − frac)·scale, and summed in its order
const UP = new Float64Array(L * T), UW = new Float64Array(L), DN = new Float64Array(T)
let DW = 0
for (let p = 0; p < L; p++) for (let t = 1 - HALF; t <= HALF; t++) {
	let x = (t - p / L) * 1, k = sinc(x) * sinc(x / HALF)
	UP[p * T + t + HALF - 1] = k; UW[p] += k
}
for (let t = 1 - HALF; t <= HALF; t++) {
	let x = (t - 0) * (1 / L), k = sinc(x) * sinc(x / HALF)
	DN[t + HALF - 1] = k; DW += k
}

/** State for calls of up to `maxBlockSize` samples; `hi` holds a call's samples at 4× the rate between up() and down() */
export function oversampler (maxBlockSize) {
	return {
		x: new Float32Array(H + maxBlockSize), hi: new Float32Array(L * maxBlockSize),
		y: new Float32Array(H + L * maxBlockSize), dry: new Float32Array(maxBlockSize),
	}
}

/** `n` samples of `data` in; their 4·n samples at the higher rate out to o.hi */
export function up (o, data, n) {
	let x = o.x, hi = o.hi
	for (let i = 0; i < n; i++) x[H + i] = data[i]
	for (let i = 0, j = 0; i < n; i++) for (let p = 0; p < L; p++, j++) {
		let s = 0
		for (let k = 0, q = p * T; k < T; k++) s += x[i + k] * UP[q + k]
		hi[j] = s / UW[p]
	}
}

/** o.hi decimated into `n` samples of `data`, LATENCY samples late, and the input as late into o.dry */
export function down (o, data, n) {
	let x = o.x, y = o.y, hi = o.hi, dry = o.dry
	for (let j = 0; j < L * n; j++) y[H + j] = hi[j]
	for (let i = 0; i < n; i++) {
		let s = 0
		for (let k = 0, j = L * i; k < T; k++) s += y[j + k] * DN[k]
		data[i] = s / DW
		dry[i] = x[i + H - LATENCY]
	}
	x.copyWithin(0, n, n + H)
	y.copyWithin(0, L * n, L * n + H)
}
