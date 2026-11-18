# @audio/amp-tube [![npm](https://img.shields.io/npm/v/@audio/amp-tube)](https://www.npmjs.com/package/@audio/amp-tube) [![MIT](https://img.shields.io/badge/MIT-%E0%A5%90-white)](https://github.com/krishnized/license)

Tube amp stage — highpass → oversampled tube saturation → bass/mid/treble tone stack → level

```
npm install @audio/amp-tube
```

```js
import amp from '@audio/amp-tube'
```

A classical guitar-amp composition, not a circuit simulation (NAM-class capture lives at `@audio/neural-amp`): one-pole ~30 Hz input highpass (rumble/DC) → `@audio/saturate-tube` at `drive = 1 + 7·gain` (oversampled) → bass/mid/treble tone stack (RBJ low-shelf, peaking, high-shelf) → output level. Tone-stack stages only run when their gain is non-zero (`bass`/`mid`/`treble` at `0` are true no-ops, not near-unity filters).

```js
amp(data, { fs: 44100, gain: 0.7 })
amp(data, { fs: 44100, gain: 0.6, bass: 3, treble: -6, level: 0.8 })
```

| Param | Default | |
|---|---|---|
| `gain` | `0.5` | 0..1 — drive into the tube stage (maps to `drive = 1 + 7·gain`) |
| `bass` | `0` | dB — low-shelf at 120 Hz |
| `mid` | `0` | dB — peaking at 650 Hz |
| `treble` | `0` | dB — high-shelf at 3200 Hz |
| `level` | `0.7` | output gain multiplier (linear, not dB) |
| `fs` | `44100` | sample rate |
| `oversample` | `4` | oversample factor passed through to the tube stage |

**Mutates `data` in place** and returns it (same array reference, not a copy). Mono only.

`stream(block, { gain: [0.6], bass: [3], mid: [0], treble: [-6], level: [0.8] }, state(1024, 44100))` is the same chain in calls of any size (up to the size given to `state`), the highpass's, the tube stage's and the tone stack's state carried from call to call. The tube stage oversamples 4× as `@audio/saturate-tube` does, with `@audio/resample-sinc`'s streaming oversampler, on the arithmetic the whole call resamples with; the whole call reads 31 samples ahead of each output there, so a stream's output is `LATENCY` (31) samples late. Shifted back by that it is the whole call's output bit for bit, except near the ends of a whole signal (within 31 samples, and the tone stack carries the start's difference on, about 1e-7 after 2000 samples). The three tone sections always run in the stream: at 0 dB a section passes its input as it is, so the output is the whole call's, and a gain moved to 0 lets its section ring out instead of cutting it. Values arrive as a host gives them to a processor, each a 1-length array, read at each call. The `./audio` processor runs it on each channel: latency 31 samples and every parameter live, each smoothed over 20 ms: `gain` and `level` glided sample by sample along the host's ramp, 32 samples late, so a moved value is one line however the host cut its calls and a held one is the value itself, bit for bit (`stream` takes them as `lanes` after the length: gain and level from 0 and `stride`); `bass`, `mid` and `treble` retune the stack at each call of the ramp. Its tail is where the rest of the linear part's Σ|h| (the highpass, the oversampler and the tone stack at the values in force), times the tube stage's steepest slope and the level, falls under 1/1000, less the latency: a boosting stack starts the ring above the input (about 43 ms at the defaults, 54 ms at gain 1 with bass and treble at 12 dB).

**Use when:** a guitar/bass amp-in-a-box stage — drive, tone-shape, and level in one call.<br>
**Not for:** speaker-cabinet coloration (pair with `@audio/amp-cabinet`) or bare saturation without the tone stack (use `@audio/saturate-tube` directly).

---

Part of the [@audio/amp](https://github.com/audiojs/amp) family.

MIT © [audiojs](https://github.com/audiojs)
