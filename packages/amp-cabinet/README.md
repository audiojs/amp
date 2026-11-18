# @audio/amp-cabinet [![npm](https://img.shields.io/npm/v/@audio/amp-cabinet)](https://www.npmjs.com/package/@audio/amp-cabinet) [![MIT](https://img.shields.io/badge/MIT-%E0%A5%90-white)](https://github.com/krishnized/license)

Cabinet simulation — measured-IR convolution (pair with @audio/measure-ir) or classical speaker-sim biquads

```
npm install @audio/amp-cabinet
```

```js
import cabinet from '@audio/amp-cabinet'
```

With an `ir` (capture your own with `@audio/measure-ir`), convolves through `@audio/reverb-convolution` (`normalize: true`, so output level tracks input level regardless of the IR's own loudness) — the accurate path. Without one, a fixed classical speaker-sim biquad chain approximates a closed-back 12" cab: 70 Hz highpass, a low-mid bump, a presence peak around 2.4 kHz, and a steep rolloff above ~4.5 kHz.

```js
cabinet(data, { fs: 44100 })                              // biquad approximation, no IR
cabinet(data, { fs: 44100, ir: measuredCabinetIr })        // measured IR, accurate path
```

| Param | Default | |
|---|---|---|
| `fs` | `44100` | sample rate |
| `ir` | *(none)* | measured cabinet impulse response (`Float32Array`); when set, bypasses the biquad chain entirely |
| `mix` | `1` | 0..1 — wet/dry blend; **only applies to the `ir` path** (the biquad chain ignores it, always fully wet) |

**Mutates `data` in place** and returns it (same array reference, not a copy). Mono only. A delta IR (`[1, 0, 0, …]`) is an exact identity through the convolution path — useful for sanity-checking your own IRs.

`stream(block, { mix: [1] }, state(44100, ir))` is the same in calls of any size, with no latency: the chain carries its state from call to call, or the IR (scaled to unit energy, as above) runs in direct form over the input it has kept. That is bit for bit the whole call's output without an IR and with one of up to 1024 taps; `@audio/reverb-convolution` 1.0 runs a longer one by FFT, whose rounding differs from the direct sum's only where the output is silent (measured: by 1e-15 at most). The direct form costs `ir.length` multiplications a sample, so a long IR costs far more than the whole call's FFT did. Values arrive as a host gives them to a processor, a 1-length array, read at each call.

The `/audio` processor takes the IR as its buffer `ir`, of one channel, and runs every channel of the signal through `stream`, with `mix` as above, smoothed over 20 ms and glided sample by sample along the host's ramp, 32 samples late (`stream`'s `mixes` after the length: the mix for each sample), so a held mix is the value itself, bit for bit. Without one it runs the biquad chain above, sample for sample as `cabinet(data, { fs })` does. Its `tail(ctx)` is the IR's length, or without an IR the chain's slowest pole falling 60 dB, ln(1000) / −ln(r) samples (about 22 ms at 44.1 kHz).

**Use when:** finishing a guitar/bass amp chain — pair after `@audio/amp-tube`.<br>
**Not for:** room/hall ambience (use `@audio/reverb-*`) — this is a fixed speaker-and-mic coloration, not a spatial reverb.

---

Part of the [@audio/amp](https://github.com/audiojs/amp) family.

MIT © [audiojs](https://github.com/audiojs)
