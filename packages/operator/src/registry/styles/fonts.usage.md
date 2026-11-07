# fonts

Registry item `fonts` (files: `styles/fonts.css`, the `styles/fonts/*.woff2` faces, `styles/fonts/red-hat-round-OFL.txt`).

## What it is

Self-hosted faces under the SIL Open Font License (text in `red-hat-round-OFL.txt`): Red Hat Round Display (300 to 900, upright and italic), Red Hat Round Text and Red Hat Round Mono (300 to 700), and a Gochi Hand latin subset. `fonts.css` declares the `@font-face` rules with `font-display: swap`.

## Using it

Import `styles/fonts.css` (the `variables` and `tokens` items already do). The faces are named by role variables in the `variables` item:

- `--font-display`: headings and figures.
- `--font-body`: everything else.
- `--font-mono`: ids and code.
- `--font-gochi`: the handwritten accent, used sparingly.

Do not name a face at a call site; use the variable (`font-display`, `font-body`, `font-mono` in Tailwind).

## Notes

Only the weights a face ships are declared; Tailwind's weight ladder is closed to 400, 500, 600 and 700. Codepoints outside a face fall through to the next family in the stack.
