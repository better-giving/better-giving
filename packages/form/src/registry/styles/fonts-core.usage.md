# fonts-core

Registry item `fonts-core` (files: `styles/fonts-core.css`, six `styles/fonts/*.woff2` faces, `styles/fonts/red-hat-round-OFL.txt`). No npm packages, no Tailwind.

## What it is

The core subset of `fonts`, for a self-contained widget that inlines its fonts: Red Hat Round Text at 400, 500, 600 and 700, and Red Hat Round Display at 600 and 700, all upright. Six files, about 270 KB, against the 35 faces and about 1.5 MB of `fonts`. `fonts-core.css` declares the `@font-face` rules with `font-display: swap`, and each rule equals the one in `fonts.css` for that face (a test holds them equal).

## Using it

Import `styles/fonts-core.css` in place of `styles/fonts.css`, and name the faces as `--font-body` ("Red Hat Round Text") and `--font-display` ("Red Hat Round Display") do. Weights outside the set fall back to the nearest face that is here.

- Not included: Mono, Gochi Hand, italics, and the light, extra-bold and black weights. A widget that sets `--font-mono` or `--font-gochi` gets the next family in the stack.
- `fonts` and `fonts-core` write the same face files, so the CLI treats them as alternatives: add one of them.
- The `variables` item imports `fonts.css`. To ship the core subset with it, point that import at `fonts-core.css` in your bundle and leave `fonts` out.

## Notes

The faces are under the SIL Open Font License; the text travels with them in `red-hat-round-OFL.txt`.
