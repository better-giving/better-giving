import { resolve } from 'node:path';
import type { Alias } from 'vite';

// the registry's `variables` item `@import`s its face sheet, `./fonts.css`, and the donation form
// loads no web font: the card is set in the face the host page gives the element
// (src/styles/tokens.css). so that one import is pointed at an empty sheet, and the copied files
// stay as the registry wrote them, which `pnpm design:check` holds.
//
// an alias rather than a plugin, because vite resolves a css `@import` through its alias table and
// its own resolver alone. the specifier is matched whole, and in this package only
// src/registry/styles/variables.css writes it; "carries no face" in src/embed/build-output.spec.ts
// reads the built runtime for any that came out.
//
// every config in this package that turns its css into a sheet takes it: the embed build, the dev
// page, and both test pools. the app's build repeats the same import removal in
// packages/app/vite.config.ts (`formRegistryFaces`), so a change to this swap is made in both.
export const noRegistryFaces: Alias = {
	find: /^\.\/fonts\.css$/,
	replacement: resolve(import.meta.dirname, 'vite.no-faces.css')
};
