import { resolve } from 'node:path';
import type { Alias } from 'vite';

// the registry's `variables` item `@import`s its full face sheet, `./fonts.css` — 35 faces and about
// 1.5 MB — and its `fonts-core` item is the six-face subset for a self-contained widget. the
// fonts-core usage note gives the recipe this is: point that one import at fonts-core.css in the
// bundle (src/registry/styles/fonts-core.usage.md). the copied files stay as the registry wrote them,
// which `pnpm design:check` holds.
//
// an alias rather than a plugin, because vite resolves a css `@import` through its alias table and
// its own resolver alone. the specifier is matched whole, and in this package only
// src/registry/styles/variables.css writes it; "takes the six core faces and no other" in
// src/embed/build-output.spec.ts reads the built runtime for the faces that came out.
//
// every config in this package that turns its css into a sheet takes it: the embed build, the dev
// page, and both test pools. packages/app builds this package's tokens.css too and cannot import this
// file (biome.jsonc), so packages/app/vite.config.ts states the same swap for its own build.
export const registryFaces: Alias = {
	find: /^\.\/fonts\.css$/,
	replacement: resolve(import.meta.dirname, 'src/registry/styles/fonts-core.css')
};
