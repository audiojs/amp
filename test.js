import test, { almost, ok, is } from 'tst'
import { tube, cabinet } from './index.js'

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
