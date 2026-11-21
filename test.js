import test, { almost, ok, is } from 'tst'
import { tube, cabinet } from './index.js'
import { cabinet as cabinetAtom } from '@audio/amp-cabinet/audio'
import { amp as ampAtom } from '@audio/amp-tube/audio'
import { chain } from '@audio/amp-cabinet'
import { lowshelf, highshelf, peaking } from '@audio/biquad'
import { readFileSync } from 'node:fs'
import { oversampler } from '@audio/resample-sinc'

const fs = 44100

function sine (f, n = fs, amp = 0.5) {
	let d = new Float32Array(n)
	for (let i = 0; i < n; i++) d[i] = amp * Math.sin(2 * Math.PI * f * i / fs)
	return d
}
function goertzel (d, f, from = 2048, to = d.length - 2048) {
	let w = 2 * Math.PI * f / fs, cw = Math.cos(w), s1 = 0, s2 = 0
	for (let i = from; i < to; i++) { let s0 = d[i] + 2 * cw * s1 - s2; s2 = s1; s1 = s0 }
	return Math.sqrt(Math.max(0, s1 * s1 + s2 * s2 - 2 * cw * s1 * s2)) / (to - from)
}

test('tube — adds even harmonics, finite, level control', () => {
	let d = sine(440)
	tube(d, { fs, gain: 0.7 })
	ok(d.every(isFinite))
	ok(goertzel(d, 880) > goertzel(d, 880 - 173) * 5, '2nd harmonic present')
})

test('tube — tone stack shapes the response', () => {
	let flat = sine(8000), cut = sine(8000)
	tube(flat, { fs, gain: 0.2 })
	tube(cut, { fs, gain: 0.2, treble: -12 })
	let db = 20 * Math.log10(goertzel(cut, 8000) / goertzel(flat, 8000))
	ok(db < -8, 'treble −12 cuts 8 kHz by ' + db.toFixed(1) + ' dB')
	let bassy = sine(100), flat2 = sine(100)
	tube(flat2, { fs, gain: 0.2 })
	tube(bassy, { fs, gain: 0.2, bass: 6 })
	ok(20 * Math.log10(goertzel(bassy, 100) / goertzel(flat2, 100)) > 4, 'bass +6 boosts 100 Hz')
})

test('cabinet — speaker sim rolls off highs, keeps mids; delta IR ≈ identity', () => {
	let mid = sine(1000), hi = sine(8000)
	let m0 = goertzel(mid, 1000), h0 = goertzel(hi, 8000)
	cabinet(mid, { fs }); cabinet(hi, { fs })
	let midDb = 20 * Math.log10(goertzel(mid, 1000) / m0)
	let hiDb = 20 * Math.log10(goertzel(hi, 8000) / h0)
	ok(hiDb < midDb - 12, '8 kHz down ' + (midDb - hiDb).toFixed(1) + ' dB vs 1 kHz')
	let d = sine(440, 8192)
	let ref = Float32Array.from(d)
	let delta = new Float32Array(64); delta[0] = 1
	cabinet(d, { fs, ir: delta })
	let err = 0
	for (let i = 100; i < d.length - 100; i++) err = Math.max(err, Math.abs(d[i] - ref[i]))
	ok(err < 1e-5, 'delta IR identity (err ' + err.toExponential(1) + ')')
})

function noise (n, seed = 1) {
	let d = new Float32Array(n)
	for (let i = 0; i < n; i++) d[i] = 0.5 * ((seed = (seed * 16807) % 2147483647) / 2147483647 * 2 - 1)
	return d
}
// a manifest as a host runs it: a stub ctx, the signal in calls of `block` frames (one call by default), each value
// a 1-length array
function host (atom, x, { sr = fs, block = x[0].length, buffers, set = {} } = {}) {
	let params = {}, out = x.map(c => new Float32Array(c.length))
	for (let k in atom.params) params[k] = Float32Array.of(set[k] ?? atom.params[k].default)
	let proc = atom({ sampleRate: sr, maxBlockSize: block, maxChannels: x.length, params, buffers })
	for (let i = 0; i < x[0].length; i += block) proc([x.map(c => c.subarray(i, i + block))], [out.map(c => c.subarray(i, i + block))], params)
	return out
}
const cab = (x, { buffers, mix = 1, block } = {}) => host(cabinetAtom, x, { buffers, block, set: { mix } })
const BLOCKS = [1, 64, 127, 128, 1024]
// a section's slower pole: the larger root of z² + a1·z + a2
const radius = ({ a1, a2 }) => { let d = a1 * a1 - 4 * a2; return d < 0 ? Math.sqrt(a2) : (Math.abs(a1) + Math.sqrt(d)) / 2 }
// the validator's tail measure: after a noise burst, RMS over 64 frames of what it left, against 1/1000 of its RMS,
// from latency + tail on: the windows above that
function loudPast (atom, { sr = fs, set = {}, buffers } = {}) {
	let params = {}
	for (let k in atom.params) params[k] = Float32Array.of(set[k] ?? atom.params[k].default)
	let B = 8192, T = atom.tail({ sampleRate: sr, params, buffers }), end = B + (atom.latency ?? 0) + Math.ceil(T * sr)
	let x = [noise(B, 21), noise(B, 22)].map(c => { let d = new Float32Array(end + 8192); d.set(c); return d })
	let y = host(atom, x, { sr, set, buffers, block: 128 }), floor = 1e-3 * Math.sqrt(x[0].subarray(0, B).reduce((s, v) => s + v * v, 0) / B), loud = 0
	for (let c = 0; c < 2; c++) for (let i = end; i + 64 <= y[c].length; i += 64) {
		let e = 0
		for (let j = i; j < i + 64; j++) e += y[c][j] * y[c][j]
		if (Math.sqrt(e / 64) > floor) loud++
	}
	return loud
}

test('cabinet manifest: without an IR, the kernel\'s biquad chain, bit for bit, in calls of any size', () => {
	// before the ir buffer the manifest ran the kernel on each channel with { fs, mix } and nothing else; streaming,
	// the chain carries its state from call to call
	let x = [noise(fs / 2, 1), noise(fs / 2, 2)]
	for (let mix of [1, 0.5]) for (let [given, buffers] of [['no ctx.buffers', undefined], ['{}', {}], ['{ ir: undefined }', { ir: undefined }]]) {
		let ref = x.map(c => cabinet(Float32Array.from(c), { fs, mix })), diff = 0
		for (let block of [x[0].length, ...BLOCKS]) {
			let y = cab(x, { buffers, mix, block })
			for (let c = 0; c < 2; c++) for (let i = 0; i < ref[c].length; i++) if (y[c][i] !== ref[c][i]) diff++
		}
		is(diff, 0, `mix ${mix}, buffers ${given}: samples that differ`)
	}
})

// The chain's 4.5 and 5.2 kHz lowpasses sit past Nyquist at rates under 10.4 kHz, where their poles leave the unit
// circle: audio's stream suite (8 kHz) read NaN from frame 142 of a 300 Hz tone. Held at 0.49 of the rate, every section
// is stable and the output finite, the kernel's and the processor's alike
test('cabinet: without an IR, stable at every rate; each section\'s poles inside the unit circle, the output finite', () => {
	for (let sr of [8000, 11025, 16000, 22050, 44100, 192000]) {
		ok(chain(sr).every(c => radius(c) < 1), `${sr} Hz: every pole inside the unit circle (largest ${Math.max(...chain(sr).map(radius)).toFixed(4)})`)
		let x = Float32Array.from({ length: sr }, (_, i) => 0.4 * Math.sin(2 * Math.PI * 300 * i / sr))
		ok(cabinet(x.slice(), { fs: sr }).every(Number.isFinite), `${sr} Hz: the kernel's output finite`)
		ok(host(cabinetAtom, [x], { sr }).every(c => c.every(Number.isFinite)), `${sr} Hz: the processor's output finite`)
	}
})

test('cabinet manifest: without an IR, the tail is the chain\'s slowest pole falling 60 dB', () => {
	// a pole of radius r falls 60 dB in ln(1000) / -ln(r) samples (J. O. Smith, Introduction to Digital Filters,
	// https://ccrma.stanford.edu/~jos/filters/); the chain's sections are the kernel's
	for (let sr of [44100, 96000]) {
		let r = Math.max(...chain(sr).map(radius))
		almost(cabinetAtom.tail({ sampleRate: sr, params: {}, buffers: { ir: undefined } }), Math.log(1000) / -Math.log(r) / sr, 1e-12, `${sr} Hz: the slowest pole, r = ${r.toFixed(5)}`)
		is(loudPast(cabinetAtom, { sr }), 0, `${sr} Hz: windows above -60 dB past the tail`)
	}
})

test('cabinet manifest: a unit-impulse IR gives the input back', () => {
	let x = [noise(8192, 3), noise(8192, 4)], delta = new Float32Array(64); delta[0] = 1
	let y = cab(x, { buffers: { ir: [delta] } }), err = 0
	for (let c = 0; c < 2; c++) for (let i = 0; i < x[c].length; i++) err = Math.max(err, Math.abs(y[c][i] - x[c][i]))
	ok(err < 1e-5, 'delta IR identity, every channel, as the kernel test above (err ' + err.toExponential(1) + ')')
})

test('cabinet manifest: a short IR gives the convolution computed directly, the IR at unit energy', () => {
	// the kernel scales the IR to unit energy (normalize: true) and blends x·(1 − mix) + wet·mix. Tolerance: the scaled
	// IR and the output are float32, each rounded to 2^-24 of its value, on a signal within ±0.5
	let h = Float32Array.of(0.6, -0.3, 0.2, 0.1, -0.05, 0.02), e = Math.sqrt(h.reduce((s, v) => s + v * v, 0))
	let x = [noise(4096, 5), noise(4096, 6)]
	for (let mix of [1, 0.25]) for (let block of [x[0].length, ...BLOCKS]) {
		let y = cab(x, { buffers: { ir: [h] }, mix, block }), err = 0
		for (let c = 0; c < 2; c++) for (let i = 0; i < x[c].length; i++) {
			let wet = 0
			for (let j = 0; j < h.length && j <= i; j++) wet += h[j] / e * x[c][i - j]
			err = Math.max(err, Math.abs(y[c][i] - (x[c][i] * (1 - mix) + wet * mix)))
		}
		ok(err < 1e-6, `mix ${mix}, calls of ${block}: max deviation ${err.toExponential(1)}`)
	}
	is(cabinetAtom.tail({ sampleRate: fs, params: {}, buffers: { ir: [new Float32Array(2205)] } }), 0.05, 'tail: the IR\'s length')
})

test('cabinet manifest: an IR in direct form, bit for bit, in calls of any size', () => {
	// the IR scaled to unit energy into float32, as the kernel's convolve(…, { normalize: true }) does, and the sum
	// from the first tap on, in float64, as its direct path adds it; the blend x·(1 − mix) + wet·mix
	for (let L of [300, 3000]) {
		let ir = noise(L, L).map((v, i) => v * Math.exp(-i / (L / 4))), e = 0
		for (let j = 0; j < L; j++) e += ir[j] * ir[j]
		let h = Float32Array.from(ir, v => v * (1 / Math.sqrt(e))), x = [noise(6000, 7), noise(6000, 8)]
		for (let mix of [1, Math.fround(0.4)]) {
			// Float32Array.map: each output sample rounded to float32, as the manifest writes it
			let ref = x.map(c => c.map((v, i) => { let wet = 0; for (let j = 0; j <= i && j < L; j++) wet += h[j] * c[i - j]; return v * (1 - mix) + wet * mix })), diff = 0
			for (let block of [x[0].length, ...BLOCKS]) {
				let y = cab(x, { buffers: { ir: [ir] }, mix, block })
				for (let c = 0; c < 2; c++) for (let i = 0; i < ref[c].length; i++) if (y[c][i] !== ref[c][i]) diff++
			}
			is(diff, 0, `IR ${L}, mix ${mix.toFixed(2)}: samples that differ`)
		}
	}
})

test('amp manifest: the kernel\'s whole call LATENCY samples late, bit for bit, in calls of any size', () => {
	// The whole call's tube stage (@audio/saturate-tube) reads LATENCY samples ahead of each output, which a stream
	// cannot: it is that late instead (@audio/resample-sinc's oversampler). 64 zeros on each side keep the whole call's
	// ends, where resample() divides by the taps it has, off the signal; the input highpass rings into the zeros at the
	// end, so the last LATENCY samples are left out. A tone gain of 0 skips its section in the whole call and passes
	// through it streaming
	let L = ampAtom.latency ?? 0, seed = 5, rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647
	for (let [k, sr] of [44100, 48000, 96000, 22050, 44100].entries()) {
		let set = {}
		for (let [name, s] of Object.entries(ampAtom.params)) set[name] = Math.fround(k ? s.min + (s.max - s.min) * rand() : s.default)
		if (k === 4) set.bass = set.treble = 0
		let x = [noise(2000, 2 * k + 31), noise(2000, 2 * k + 32)].map(c => { let d = new Float32Array(c.length + 128 + L); d.set(c, 64); return d })
		let ref = x.map(c => tube(Float32Array.from(c.subarray(0, c.length - L)), { fs: sr, ...set })), diff = 0
		for (let block of BLOCKS) {
			let y = host(ampAtom, x, { sr, block, set })
			for (let c = 0; c < 2; c++) for (let i = 0; i < ref[c].length - L; i++) if (!Object.is(y[c][i + L], ref[c][i])) diff++
		}
		is(diff, 0, `${sr} Hz, ${Object.entries(set).map(([n, v]) => `${n} ${+v.toFixed(2)}`).join(', ')}: samples that differ`)
	}
})

test('amp manifest: 60 dB below a noise burst within latency + tail, at the extremes of the ranges', () => {
	for (let sr of [44100, 96000]) for (let set of [{}, { gain: 1, bass: 12, mid: 12, treble: 12 }, { gain: 0, bass: -12, mid: -12, treble: -12 }, { gain: 1, bass: 12, level: 1 }])
		is(loudPast(ampAtom, { sr, set }), 0, `${sr} Hz ${JSON.stringify(set)}: windows above -60 dB past the tail`)
})

test('amp manifest: the tail holds after a burst, an impulse, a held tone at the loudest frequency and a held DC', () => {
	// Contract 1.0, Latency, tail: the time after the input stops until the output stays 60 dB under the input's level.
	// Read as @audio/compile's validator reads it, RMS over 64 frames of what the input left (the output less the silent
	// input's), against 1/1000 of each input's level (the burst's RMS, the impulse's over a window, the tone's largest
	// window), with the window sliding a frame at a time: from stop + latency + tail on, none may be above. Inputs: the
	// validator's noise burst, impulse and tone held at the frequency the impulse response is loudest at, and a DC held at
	// 0.5 (the validator's) and at 1. Settings: the defaults, each control at an end, the one the validator found short
	// (a held DC through bass and treble at 12 dB: rang 42.1 ms, declared 37.1), and the least margin of a survey of the
	// controls' ends and centres
	let W = 64, L = ampAtom.latency
	let render = (x, sr, set) => host(ampAtom, [x], { sr, set, block: 128 })[0]
	let ring = (y, q, stop, floor) => {
		let e = 0, last = stop - 1, f2 = floor * floor * W
		for (let j = stop; j < stop + W; j++) e += (y[j] - q[j]) ** 2
		for (let i = stop; i + W < y.length; i++) { if (e > f2) last = i; e += (y[i + W] - q[i + W]) ** 2 - (y[i] - q[i]) ** 2 }
		return last + 1 - stop - L
	}
	let loudest = (h, sr) => {
		let best = 0, at = 0
		for (let i = 0; i <= 200; i++) {
			let f = i && 5 * (0.45 * sr / 5) ** (i / 200), w = 2 * Math.PI * f / sr, re = 0, im = 0
			for (let k = 0; k < h.length; k++) re += h[k] * Math.cos(w * k), im -= h[k] * Math.sin(w * k)
			if (re * re + im * im > best) best = re * re + im * im, at = f
		}
		return at
	}
	let SETS = [{}, { gain: 1, bass: 12, mid: -3.392, treble: 12, level: 0.8986 }, { gain: 1, bass: 12, mid: 12, treble: 12, level: 1 }, { gain: 0, bass: -12, mid: -12, treble: -12, level: 1 }, { gain: 1, bass: -12, mid: 12, treble: 12, level: 0.1 }, { gain: 0, bass: 12, mid: -12, treble: 12, level: 0.9 }]
	for (let sr of [22050, 44100, 96000]) for (let set of SETS) {
		let params = {}
		for (let k in ampAtom.params) params[k] = Float32Array.of(set[k] ?? ampAtom.params[k].default)
		let T = Math.ceil(ampAtom.tail({ sampleRate: sr, params }) * sr), pad = Math.round(sr / 4), wait = T + 4096, worst = -Infinity, by = ''
		let one = (name, x, stop, level) => { let y = render(x, sr, set), q = render(new Float32Array(x.length), sr, set), r = ring(y, q, stop, 1e-3 * level); if (r > worst) worst = r, by = name; return y }
		let burst = noise(pad, 31).map(v => v * 0.3), b = new Float32Array(pad + L + wait)
		b.set(burst)
		one('noise burst', b, pad, Math.sqrt(burst.reduce((s, v) => s + v * v, 0) / pad))
		let im = new Float32Array(pad + L + wait)
		im[pad - 1] = 1
		let yi = one('impulse', im, pad, 1 / Math.sqrt(W)), qi = render(new Float32Array(im.length), sr, set)
		let hz = Math.round(loudest(Array.from({ length: Math.min(8192, pad) }, (_, k) => yi[pad - 1 + k] - qi[pad - 1 + k]), sr)), hold = Math.round(Math.min(1, Math.max(0.25, T / sr / 2)) * sr)
		for (let [name, A, f] of [[hz ? `tone of ${hz} Hz` : 'dc', 0.5, hz], ['dc 0.5', 0.5, 0], ['dc 1', 1, 0]]) {
			let x = new Float32Array(hold + L + wait), top = 0
			for (let i = 0; i < hold; i++) x[i] = f ? A * Math.sin(2 * Math.PI * f * i / sr) : A
			for (let i = 0; i + W <= hold; i += W) { let s = 0; for (let j = i; j < i + W; j++) s += x[j] * x[j]; top = Math.max(top, Math.sqrt(s / W)) }
			one(name, x, hold, top)
		}
		ok(worst <= T, `${sr} Hz ${JSON.stringify(set)}: rings ${(worst / sr * 1000).toFixed(1)} ms (${by}), declares ${(T / sr * 1000).toFixed(1)} ms`)
	}
}, { timeout: 120000 })


// --- live values, moved by a host (contract 1.0: Parameters, `smoothing`; What a host owes, 3) ---

const values = (m, set = {}) => Object.fromEntries(Object.keys(m.params).map(k => [k, Float32Array.of(set[k] ?? m.params[k].default)]))
// A host as contract 1.0 asks one to be: `params` from the start; at frame `at` the values `to`, each with `smoothing`
// reached by a linear ramp of that many seconds from the value in force (`ramp: false`: a jump); the call split at
// `at`, no call longer than 32 frames while a value moves, each call handed the values at its first frame as float32.
// audio's toStream hands a call the same. Otherwise calls of `block` frames, or of what `cut()` gives (1 to `block`)
function hosted (m, x, { params = {}, at = Infinity, to = {}, block = 128, cut, ramp = true, sampleRate = fs, buffers } = {}) {
	let n = x[0].length, live = values(m, params), out = x.map(() => new Float32Array(n)), len = {}
	let proc = m({ sampleRate, maxBlockSize: block, maxChannels: x.length, params: values(m, params), buffers })
	for (let p in to) len[p] = ramp && m.params[p].smoothing > 0 ? Math.max(1, Math.round(m.params[p].smoothing * sampleRate)) : 0
	for (let i = 0, k; i < n; i += k) {
		k = Math.min(n - i, cut ? cut() : block)
		if (i < at && i + k > at) k = at - i
		for (let p in to) {
			let d = i - at, from = params[p] ?? m.params[p].default
			if (d < 0) continue
			if (d < len[p]) { live[p] = Float32Array.of(to[p] + (from - to[p]) * (1 - d / len[p])); k = Math.min(k, 32, at + len[p] - i) }
			else live[p] = Float32Array.of(to[p])
		}
		proc([x.map(c => c.subarray(i, i + k))], [out.map(c => c.subarray(i, i + k))], live)
	}
	return out
}
// the largest |second difference| of y over [a, b); the largest of |w[n+1] − w[n−1]| and |w[n]| there; the peak
const d2max = (y, a, b) => { let m = 0; for (let i = Math.max(1, a); i < Math.min(y.length - 1, b); i++) m = Math.max(m, Math.abs(y[i + 1] - 2 * y[i] + y[i - 1])); return m }
const turnOf = (w, a, b) => { let m = 0; for (let i = Math.max(1, a); i < Math.min(w.length - 1, b); i++) m = Math.max(m, Math.abs(w[i + 1] - w[i - 1]), Math.abs(w[i])); return m }
const peakOf = (y, a, b) => { let m = 0; for (let i = a; i < b; i++) m = Math.max(m, Math.abs(y[i])); return m }
const tone = (f, A, n) => Float32Array.from({ length: n }, (_, i) => A * Math.sin(2 * Math.PI * f * i / fs))
const IR = { ir: [noise(600, 77).map((v, i) => v * Math.exp(-i / 150))] }

test('manifests: a value that scales the signal is glided: a host\'s ramp of it is one line, the same whatever the calls, the value itself after it', () => {
	// A host ramps a jump over the param's `smoothing` (0.02 s: N = 882 frames) in calls of 32 frames; the change on the
	// 128-frame grid and inside a call. The measure: the largest |second difference| from 4 samples before the change to
	// 4096 after, over the larger of the unchanged render's there and the changed one's 2048 before it. Derived, for an
	// output m·w plus a part the value leaves alone, m moving along a straight line of slope s from one frame to the next:
	// d2(m·w)[n] = m[n]·d2w[n] + (m[n+1] − m[n])·w[n+1] + (m[n−1] − m[n])·w[n−1], the first at most the larger steady
	// render's |d2| (linear in m, so largest at an end of the line), the rest s·|w[n+1] − w[n−1]| along it and s·|w[n ± 1]|
	// at a corner: measure ≤ steady + s·turn(w)/ref.
	// The cabinet's mix: y = dry + m·(wet − dry), dry and wet the renders at mix 0 and 1, s = |Δmix|/N, plus four float32
	// roundings of y. level: y = m·w, w the render unchanged, m = level/level₀; gain, at −60 dBFS where the tube stage
	// is its slope at 0, d·sech²(0.25·d)/tanh(1.25·d) with d = 1 + 7·gain (the derivative of its curve at 0): m that over
	// its value at the old gain, s the largest step of m between two frames of the host's line; margin 1.1 for what of
	// the curve is not its slope at that level.
	// From the glide's end (the ramp's N frames, then 32: it plays the host's line 32 frames late), the render at the new
	// value, bit for bit: level and mix at once, gain `reach` samples on, as far as the points a sample shapes reach the
	// output (@audio/resample-sinc's oversampler: to its latency; the tone stack at 0 dB passes it as it is). Before the
	// glide each was one step of the whole change (×91 to ×318 at 220 Hz)
	let n = fs * 3 / 4, N = Math.round(0.02 * fs), seed = 9, u = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296, reach = oversampler(4, 0).latency
	let G = g => { let d = 1 + 7 * Math.fround(g); return d / Math.cosh(0.25 * d) ** 2 / Math.tanh(1.25 * d) }
	const ROWS = [
		// processor, the change, its law (or 'mix'), input level, frames past the line before the render at the new value
		[ampAtom, { gain: 0.75 }, G, 1e-3, reach], [ampAtom, { level: 0.75 }, v => Math.fround(v), 0.5, 0], [cabinetAtom, { mix: 0.75 }, 'mix', 0.5, 0],
	]
	for (let [m, to, law, A, settle] of ROWS) for (let f of [220, 1000]) for (let at of [22016, 22063]) {
		let k = Object.keys(to)[0], base = { [k]: 0.25 }, buffers = m === cabinetAtom ? IR : undefined, label = `${m.name}.${k} 0.25 → ${to[k]}, ${f} Hz, at ${at}`
		let x = [tone(f, A, n)], w0 = at - 4, w1 = at + 4096
		let a = hosted(m, x, { params: base, buffers })[0], b = hosted(m, x, { params: base, at, to, buffers })[0], c = hosted(m, x, { params: { ...base, ...to }, buffers })[0]
		let ref = Math.max(d2max(a, w0, w1), d2max(b, at - 2048, at - 4)), measure = d2max(b, w0, w1) / ref
		let steady = Math.max(d2max(a, w0, w1), d2max(c, w0, w1)) / ref, bound, dry, wet
		if (law === 'mix') {
			dry = hosted(m, x, { params: { mix: 0 }, buffers })[0], wet = hosted(m, x, { params: { mix: 1 }, buffers })[0]
			bound = steady + (Math.abs(to.mix - base.mix) / N * turnOf(wet.map((y, i) => y - dry[i]), w0, w1) + 4 * 2 ** -24 * peakOf(b, w0, w1)) / ref
		} else {
			let most = 0
			for (let t = 0; t < N; t++) most = Math.max(most, Math.abs(law(base[k] + (to[k] - base[k]) * (t + 1) / N) - law(base[k] + (to[k] - base[k]) * t / N)))
			bound = 1.1 * (steady + most / law(base[k]) * turnOf(a, w0, w1) / ref)
		}
		ok(measure <= bound, `${label}: ×${measure.toFixed(2)}, derived ≤ ×${bound.toFixed(2)}`)
		let from = at + N + 32 + settle, off = 0
		for (let i = from; i < n; i++) if (!Object.is(b[i], c[i])) off++
		is(off, 0, `${label}: from ${from - at} frames after the change, the render at ${to[k]}`)
		if (law !== 'mix' || at !== 22063 || f !== 220) continue
		// the same samples whatever the host's calls: blocks of 1, 32, 128 and random cuts (32 frames at most while it
		// moves). 1-frame calls give every frame's float32 value, longer ones float32 values 32 frames apart, joined in
		// doubles: the two lines part by a float32 ulp of the value at most (2^-23 of 0.75), and each render rounds once to
		// float32: within 2^-23·(0.75·max|wet − dry| + max|y|)
		let Wd = 0
		for (let i = 0; i < n; i++) Wd = Math.max(Wd, Math.abs(wet[i] - dry[i]))
		let ys = [1, 32, 128].map(block => hosted(m, x, { params: base, at, to, block, buffers })[0]).concat([hosted(m, x, { params: base, at, to, block: 128, buffers, cut: () => 1 + Math.floor(u() * 128) })[0]])
		let tol = 2 ** -23 * (0.75 * Wd + peakOf(ys[0], 0, n))
		for (let j = 1; j < ys.length; j++) {
			let far = 0
			for (let i = 0; i < n; i++) far = Math.max(far, Math.abs(ys[j][i] - ys[0][i]))
			ok(far <= tol, `${label}: ${['', 'blocks of 32', 'blocks of 128', 'random calls'][j]}: within ${far.toExponential(2)} of 1-frame calls (≤ ${tol.toExponential(2)})`)
		}
	}
})

test('amp manifest: the tone controls are smoothed: a host retunes the tone stack along its ramp, a small step a call', () => {
	// A running IIR whose coefficients change leaves a transient as large as the change times its state, to first order. A
	// host's ramp over N = 882 frames makes ⌈N/32⌉ changes in place of one; the largest is `share` of the whole (computed
	// here from @audio/biquad's coefficients, which tube.js's tone stack reproduces, at the values the calls bring), and
	// each rings for the section's slowest pole, τ = −1/ln r samples, r its largest radius at either end, so the transients
	// of calls 32 frames apart add up to at most 1/(1 − e^(−32/τ)) of one. A jump's transient depends on the signal's phase
	// where it lands, and a ramp's calls land at many: the jump is taken at its worst of 32 instants over a period. The
	// ramped render's measure over the steady one's (the render at the new value, or 1: a tone through a gain that the
	// control moves one way is largest at an end) is then at most the jump's × share × that overlap; margin 1.1 for the
	// terms of second order. The stack follows the tube stage and only the level follows it: the transient passes nothing
	// that bends. The measure as above; −6 → 6 dB, a quarter to three quarters of each control
	let at = 22016, n = at + 4096 + 64, N = Math.round(0.02 * fs)
	let radius = ({ a1, a2 }) => { let d = a1 * a1 - 4 * a2; return d < 0 ? Math.sqrt(a2) : (Math.abs(a1) + Math.sqrt(d)) / 2 }
	let SEC = { bass: v => lowshelf(120, 0.707, fs, Math.fround(v)), mid: v => peaking(650, 0.9, fs, Math.fround(v)), treble: v => highshelf(3200, 0.707, fs, Math.fround(v)) }
	for (let k of ['bass', 'mid', 'treble']) for (let f of [220, 1000]) {
		let from = -6, to = 6, x = [tone(f, 0.5, n)], label = `amp.${k} ${from} → ${to} dB, ${f} Hz`, a = hosted(ampAtom, x, { params: { [k]: from } })[0]
		let measure = (y, t) => Math.max(d2max(y, t - 4, t + 4096) / d2max(a, t - 4, t + 4096), 1), jump = 0, T = fs / f
		for (let j = 0; j < 32; j++) { let t = at - Math.round(j * T / 32); jump = Math.max(jump, measure(hosted(ampAtom, x, { params: { [k]: from }, at: t, to: { [k]: to }, ramp: false })[0], t)) }
		let ramped = measure(hosted(ampAtom, x, { params: { [k]: from }, at, to: { [k]: to } })[0], at), steady = measure(hosted(ampAtom, x, { params: { [k]: to } })[0], at)
		let co = v => { let c = SEC[k](v); return [c.b0, c.b1, c.b2, c.a1, c.a2] }, first = co(from), last = co(to), whole = 0, most = 0
		for (let e = 0; e < 5; e++) whole = Math.max(whole, Math.abs(last[e] - first[e]))
		for (let s = 1, was = first; s <= Math.ceil(N / 32); s++) {
			let now = co(to + (from - to) * (1 - Math.min(N, 32 * s) / N))
			for (let e = 0; e < 5; e++) most = Math.max(most, Math.abs(now[e] - was[e]))
			was = now
		}
		let tau = -1 / Math.log(Math.max(radius(SEC[k](from)), radius(SEC[k](to)))), bound = steady + 1.1 * (jump - steady) * (most / whole) / (1 - Math.exp(-32 / tau))
		ok(ramped <= bound, `${label}: a jump ×${jump.toFixed(1)} at its worst, the ramp ×${ramped.toFixed(3)}, derived ≤ ×${bound.toFixed(3)}`)
	}
})

test('manifests: each live number is glided or a retune, each smoothed over 20 ms', () => {
	// glided: it scales the signal with nothing behind it, so its jump was a step of the output; a retune: a filter's
	// coefficients, its state kept. One time, 20 ms, the dynamics and effect families' for theirs
	const CLASS = { glided: { amp: 'gain level', cabinet: 'mix' }, retune: { amp: 'bass mid treble' } }
	for (let m of [ampAtom, cabinetAtom]) for (let [k, s] of Object.entries(m.params)) {
		if (s.type !== 'number' || s.restart) continue
		let in_ = Object.keys(CLASS).filter(c => CLASS[c][m.name]?.split(' ').includes(k))
		is(in_.length, 1, `${m.name}.${k}: in one class (${in_.join(', ') || 'none'})`)
		is(s.smoothing, 0.02, `${m.name}.${k}: smoothed over 20 ms`)
	}
})

test('the glide is one text in every manifest that keeps a copy', () => {
	let copies = ['tube', 'cabinet'].map(p => { let s = readFileSync(new URL(`./packages/amp-${p}/audio.js`, import.meta.url), 'utf8'), i = s.indexOf('// A value that scales the signal, glided'); return i < 0 ? null : s.slice(i) })
	ok(copies[0]?.includes('function glide (') && copies.every(t => t === copies[0]), 'amp-tube and amp-cabinet audio.js')
})
