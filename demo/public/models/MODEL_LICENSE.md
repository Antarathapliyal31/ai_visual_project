# Demo model license

**File:** `demo-avatar.glb`

- **Name:** Animated Human (low poly)
- **Author:** [Quaternius](https://quaternius.com/)
- **Source:** https://opengameart.org/content/animated-human-low-poly
- **License:** [CC0 1.0 Universal (public domain)](https://creativecommons.org/publicdomain/zero/1.0/)
- **Retrieved:** 2026-07-20

## Modifications

Converted from the original `.blend` to glTF Binary (`.glb`) with Blender 5.0:

- Removed two leftover unnamed Blender actions (`ArmatureAction.001/.002`);
  kept the authored clips (Death, Idle, Jump, Punch, Run, Walk, Working).
- Rebuilt the material as a Principled BSDF with the pack's
  `ClothedLightSkin.png` texture embedded (the original legacy Diffuse BSDF
  graph is not exportable to glTF).

CC0 requires no attribution, but if you reuse this model please consider
crediting Quaternius — and check out their other packs.
