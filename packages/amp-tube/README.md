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

**Use when:** a guitar/bass amp-in-a-box stage — drive, tone-shape, and level in one call.<br>
**Not for:** speaker-cabinet coloration (pair with `@audio/amp-cabinet`) or bare saturation without the tone stack (use `@audio/saturate-tube` directly).

---

Part of the [@audio/amp](https://github.com/audiojs/amp) family.

MIT © [audiojs](https://github.com/audiojs)
