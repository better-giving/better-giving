import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { CORNERS, SHADES } from '../../page/keys';
import { CORNER_PICTURES, SHADE_CARDS, SHADE_TRAYS } from './look-control';

// the look control's swatches are literals under a `raw-colour-ok:` note, because they are pictures
// of the donor page rather than values of the operator system — and a picture is only true while it
// matches what the page draws. packages/form/src/styles/tokens.css is that: `--_s` and `--_r` at
// the root for `light` and `soft`, re-declared in a `@container style(--donate-*: <preset>)` block
// for every other preset, and `--_n3` a fixed lightness off `--_s`.

const tokens = readFileSync(
	new URL('../../../../../form/src/styles/tokens.css', import.meta.url),
	'utf8'
);

/** the value of `name` where the tokens file declares it for `preset` of `seed`. */
function declared(seed: 'shade' | 'corner', preset: string, name: string): string {
	// the root declares every name before the first preset block, so with no block for the preset
	// the first declaration in the file is the root's.
	const at = tokens.indexOf(`@container style(--donate-${seed}: ${preset})`);
	const scope = at === -1 ? tokens : tokens.slice(at);
	const match = scope.match(new RegExp(`^\\s*${name}:\\s*([^;]+);`, 'm'));
	if (!match?.[1]) throw new Error(`no ${name} for ${seed} ${preset} in the form's tokens.css`);
	return match[1].trim();
}

const n3Lightness = tokens.match(/--_n3:\s*oklch\(from var\(--_s\) ([\d.]+) c h\)/)?.[1];

it('reads the rung it pictures the tray at', () => {
	expect(n3Lightness).toBeDefined();
});

it.each(SHADES)('pictures %s as the form draws its card and tray', (shade) => {
	const card = declared('shade', shade, '--_s');
	expect(SHADE_CARDS[shade].background).toBe(card);
	expect(SHADE_TRAYS[shade].background).toBe(
		card.replace(/^oklch\([\d.]+ /, `oklch(${n3Lightness} `)
	);
});

it.each(CORNERS)('pictures %s at the card radius the form draws', (corner) => {
	expect(String(CORNER_PICTURES[corner].borderStartStartRadius)).toBe(
		declared('corner', corner, '--_r')
	);
});
