// atom manifest — tube amp stage (input HP → oversampled tube saturation →
// bass/mid/treble tone stack → level). Streaming: the 4× oversampler (@audio/resample-sinc's)
// carries its input from call to call, so the output is LATENCY samples late; the
// highpass and the tone stack keep their state. Every param is live. gain and level scale
// the signal with nothing behind them, so each is smoothed (20 ms) and glided sample by
// sample (glide, below): a host's ramp of it is one line, however the host cut its calls;
// held, the kernel runs on the value as it ran. bass, mid and treble retune the tone
// stack, its state kept: smoothed, each call of a host's ramp retunes it a step.

import { lowshelf, highshelf, peaking } from '@audio/biquad'
import { oversampler, up, down } from '@audio/resample-sinc'
import { stream, state, LATENCY, RING } from './tube.js'

export const amp = (ctx) => {
	const st = [], M = ctx.maxBlockSize, g = new Float64Array(2 * GLIDE).fill(NaN), lanes = new Float64Array(2 * M)
	for (let c = 0; c < ctx.maxChannels; c++) st.push(state(M, ctx.sampleRate))
	return (inputs, outputs, params) => {
		const inp = inputs[0], out = outputs[0]
		if (!inp || !inp.length) return
		const n = inp[0].length, moving = glide(g, 0, params.gain, lanes, 0, n, 0) | glide(g, 1, params.level, lanes, M, n, 0)
		for (let c = 0; c < inp.length; c++) {
			out[c].set(inp[c])
			stream(out[c], params, st[c], n, moving ? lanes : undefined, M)
		}
	}
}
amp.channels = 'any'
amp.latency = LATENCY
// The frames after the input stops until the output stays 60 dB under the input's level (contract 1.0: Latency, tail).
// Of a linear processor of impulse response h, a peak-1 input that stops leaves at most the rest of Σ|h| k frames on,
// so its tail is where that rest falls under 1/1000. h here is the processor's linear part, the tube stage taken as
// identity: the input highpass, the oversampler and the tone stack at the values in force; the tube stage counts as a
// gain, its steepest slope drive / tanh(1.25·drive) (at x = -0.25), and the level as one. So a tone stack that boosts
// starts the ring above the input, as bass and treble at 12 dB do to a held DC. Past the oversampler's and the tone
// stack's own response h is the highpass's pole alone, r^n with r = e^(-2π·30/fs) (J. O. Smith, Introduction to Digital
// Filters, https://ccrma.stanford.edu/~jos/filters/Time_Constant_One_Pole.html), so that rest is a geometric sum. The
// host adds the latency. The linear part's rest is a bound; the tube stage's slope, between the two filters, is not
// (the bound through it, with the oversampler's and the filters' own Σ|h|, reads up to 4 times the ring), so it is
// measured: never short at 22.05 to 96 kHz, each control at its ends and centre, after a noise burst, an impulse, a
// tone held at the loudest frequency and a DC held at 0.5 and at 1
amp.tail = ({ sampleRate: fs, params }) => {
	let a = Math.exp(-2 * Math.PI * 30 / fs), drive = 1 + 7 * params.gain[0], G = drive / Math.tanh(1.25 * drive) * params.level[0]
	if (!(G > 0)) return 0
	// c: the oversampler's response (the tube stage as identity) through the tone stack, until the stack's state is 200
	// dB under its largest
	let o = oversampler(4, 1), one = new Float32Array(1), secs = [lowshelf(120, 0.707, fs, params.bass[0]), peaking(650, 0.9, fs, params.mid[0]), highshelf(3200, 0.707, fs, params.treble[0])]
	let z = new Float64Array(6), c = [], top = 0
	for (let k = 0; k < 1 << 22; k++) {
		one[0] = k ? 0 : 1
		up(o, one, 1)
		down(o, one, 1)
		let v = one[0], e = 0
		for (let q = 0; q < 3; q++) {
			let s = secs[q], y = s.b0 * v + z[2 * q]
			z[2 * q] = s.b1 * v - s.a1 * y + z[2 * q + 1]
			z[2 * q + 1] = s.b2 * v - s.a2 * y
			v = y
			e += z[2 * q] * z[2 * q] + z[2 * q + 1] * z[2 * q + 1]
		}
		c.push(v)
		top = Math.max(top, e)
		if (k > LATENCY + RING && e <= 1e-20 * top) break
	}
	// h = the highpass (a at 0, -(1 - a)·a^m at m > 0) on c: h_k = a·c_k - (1 - a)·B_k, B_k = a·(B_(k-1) + c_(k-1)). Past
	// c, h_k = -(1 - a)·B_k and B falls by a a frame: the rest from there is |B_K|. R[k] = Σ |h_j| from j = k on
	let K = c.length, B = 0, h = new Float64Array(K)
	for (let k = 0; k < K; k++) { h[k] = a * c[k] - (1 - a) * B; B = a * (B + c[k]) }
	let R = new Float64Array(K + 1)
	R[K] = Math.abs(B)
	for (let k = K - 1; k >= 0; k--) R[k] = R[k + 1] + Math.abs(h[k])
	// the first k whose rest past it, G·R[k + 1], is under 1/1000; past K in closed form: G·|B_K|·a^(k + 1 - K)
	let k = 0
	while (k < K && !(G * R[k + 1] < 1e-3)) k++
	if (k === K) k = K + Math.floor(Math.log(1e-3 / (G * R[K])) / Math.log(a))
	return Math.max(0, k - LATENCY) / fs
}
amp.params = {
	gain:   { type: 'number', min: 0, max: 1, default: 0.5, smoothing: 0.02 },
	bass:   { type: 'number', min: -12, max: 12, default: 0, unit: 'dB', smoothing: 0.02 },
	mid:    { type: 'number', min: -12, max: 12, default: 0, unit: 'dB', smoothing: 0.02 },
	treble: { type: 'number', min: -12, max: 12, default: 0, unit: 'dB', smoothing: 0.02 },
	level:  { type: 'number', min: 0, max: 1, default: 0.7, smoothing: 0.02 },
}

// A value that scales the signal, glided sample by sample so that a host's steps of it join into one line: the dynamics
// family's helper, copied (families share no code), one text in each manifest here that glides. A host hands each call
// the value at its first frame and, while a value moves (a `smoothing` ramp), calls with 32 frames at most (contract
// 1.0: Parameters, Time; What a host owes, 3). So the line through the values the calls bring, each at its call's first
// frame, is known 32 frames behind any call's first frame, however the host cut the calls; the glide plays it 32 frames
// late: the host's ramp itself, the same whether the host calls with 1, 32 or a mix of frames. A value that follows a
// call of more than 32 frames came with no ramp: it is reached in a straight line over 32 frames. The first call of an
// instance starts on its value, and a value held 32 frames is the value itself, so a value that does not move is bit
// for bit what it was before the glide existed.
// `g`: the memory, GLIDE slots a value from j·GLIDE (made NaN): the value the last call brought, where in the ring its
// first frame is, its frames, the frames the line had been at that value before it (64 once held and the ring all of
// it; counted to 63 at most, so that a long call after a move cannot reach 64 before the ring is made all of it), how
// many of `row`'s hold it, then the line, a frame a slot, in a ring of 64. `src`: the param's array. The line's values
// for this call's `n` frames go to `row` from `at`: as they are, or with `lin` 1 the gain e^(v·ln10/20) of a value in
// dB. Returns 1 while they move, 0 when every one is the value (then `row` holds it, filled once, and a caller may run
// its kernel on the value alone). Only arrays and whole numbers cross the call.
const GLIDE = 69
function glide (g, j, src, row, at, n, lin) {
	let o = j * GLIDE, r = o + 5, v = src[0], was = g[o]
	if (!(was === was)) { g[o] = v; g[o + 1] = 0; g[o + 2] = n; g[o + 3] = 0; g[o + 4] = 0 }
	else if (v !== was || g[o + 3] < 64) {
		let len = g[o + 2], L = len < 32 ? len : 32, w = (g[o + 1] + len) & 63, d = v - was, held = v === was ? Math.min(g[o + 3] + len, 63) : 0
		for (let q = 0; q < L; q++) g[r + ((w - L + q) & 63)] = was + d * q / L
		g[r + w] = v
		g[o] = v; g[o + 1] = w; g[o + 2] = n; g[o + 3] = held; g[o + 4] = 0
		if (held < 32) {
			for (let i = 0; i < n; i++) {
				let u = i < 32 ? g[r + ((w + i - 32) & 63)] : v
				row[at + i] = lin ? Math.exp(u * (Math.LN10 / 20)) : u
			}
			return 1
		}
	} else { g[o + 1] = (g[o + 1] + g[o + 2]) & 63; g[o + 2] = n }
	// held 32 frames: the ring made all of the value once (a move from it reads the line from there), the row filled
	// with it as far as no call since it was held has filled it; from then on a call only moves the ring's position
	if (g[o + 3] < 64) { for (let q = 0; q < 64; q++) g[r + q] = v; g[o + 3] = 64 }
	if (g[o + 4] < n) {
		let u = lin ? Math.exp(v * (Math.LN10 / 20)) : v
		for (let i = 0; i < n; i++) row[at + i] = u
		g[o + 4] = n
	}
	return 0
}
