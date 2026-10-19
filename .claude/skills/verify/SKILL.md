---
name: verify
description: Typecheck and lint this repo before a commit. Written by `skills/setup/SKILL.md` from the sheet's `verify` line.
---

Run from the repo root: `pnpm exec biome format . && pnpm lint && pnpm check`. Red → fix it before the commit; the commit waits.
