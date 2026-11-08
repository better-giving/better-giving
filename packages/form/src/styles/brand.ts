// the brand scale on one element's card: the design registry's accent variables, written from the
// seed the host computes into a constructed sheet the shadow root adopts after the shared ones
// (`sheetsFor` in ../element.ts).
//
// the registry ships its scales as generated literals and no way to make one at runtime — no
// generator and no seed hook, only its CLI's `theme:generate` (../registry/styles/variables.usage.md
// → Themes) — so a seeded scale comes from ./radix-scale.ts, the same radix generator the registry's
// scales were made with, and goes onto the registry's own names: `--accent-1` to `--accent-12` and
// `--accent-contrast`. an unseeded card writes nothing and draws the registry's default theme as it
// is.
//
// the variables are set on the card's root, the `[data-theme]` node, and on nothing above it. the
// registry declares its roles — `--primary: var(--accent-9)`, `--ring`, the form slots — on every
// `[data-theme]` element, and a custom property holding a `var()` is resolved where it is declared,
// so an accent set on `:host` would leave every role on the card reading the default accent.
// `:host > [data-theme]` outranks the theme file's `[data-theme="default"]` by its pseudo-class, and
// the sheet is adopted after it besides.
//
// a sheet rather than the card's `style` attribute keeps the scale below any rule a host aims at the
// card through `::part(card)`, which a `style` attribute would outrank. it hides nothing: the values
// are as readable through `getComputedStyle` as an attribute is.

import { brandScaleCss, generateBrandScale } from './radix-scale';

/**
 * what `--donate-primary` computes to where no host sets it: the `initial-value` ./tokens.css
 * registers, which is the registry's default accent step 9 (`--accent-9` in
 * ../registry/styles/themes/default.css). "the seed's default is the registry's accent 9" in
 * ./brand.spec.ts holds the three equal.
 */
export const UNSEEDED = 'oklch(0.5198 0.1225 247.31)';

/** the registry names a seeded card's sheet sets: every step of the accent scale, and its ink. */
export const BRAND_TOKENS = [
	...Array.from({ length: 12 }, (_, i) => `--accent-${i + 1}`),
	'--accent-contrast'
] as const;

/** where the sheet sets them: the card's root, which carries the registry theme. */
const CARD_ROOT = ':host > [data-theme]';

/**
 * the seed as the host computes it.
 *
 * `--donate-primary` is registered (./tokens.css), so the computed value is a colour an engine has
 * already serialized — `rgb()` for any legacy sRGB form or keyword, the function as written for the
 * rest — or the registered initial value where nothing above the element sets one.
 */
export function brandSeedOf(host: Element): string {
	const view = host.ownerDocument.defaultView;
	if (view === null) return '';
	return view.getComputedStyle(host).getPropertyValue('--donate-primary').trim();
}

/** the keyframes `seedWatch` below runs, which change nothing; only the run is wanted. */
const WATCH_KEYFRAMES = '@keyframes donate-seed-watch { to { visibility: hidden; } }';

/**
 * the scale for a seed the generator does not read — `lab()`, `lch()`, a `color()` space it has no
 * matrix for — approximated in relative colour so a seeded card never draws the default accent.
 *
 *   step N = oklch(L_N, C_9 × k_N, H_9), and step 9 = the seed
 *
 * where L_N and k_N are the mean lightness and the mean chroma share, relative to step 9, that
 * radix's red, blue, violet, grass and teal (@radix-ui/colors 3.0.0, light) hold at step N. step 10
 * is the seed moved 0.03 in lightness, darker, and lighter below 0.4, where a darker step would be no
 * change a donor can see; the `clamp(-1, …, 1)` is a sign taken off the seed's own lightness. the ink
 * is white, or step 12's lightness and chroma where the seed is lighter than 0.73 and too light to
 * carry white, as radix draws its sky, mint, lime, yellow and amber.
 */
const APPROXIMATED = (() => {
	const seed = 'var(--donate-primary)';
	const steps: Readonly<Record<number, readonly [number, number]>> = {
		1: [0.993, 0.03],
		2: [0.982, 0.06],
		3: [0.959, 0.14],
		4: [0.932, 0.25],
		5: [0.9, 0.33],
		6: [0.859, 0.44],
		7: [0.803, 0.55],
		8: [0.729, 0.73],
		11: [0.54, 0.9],
		12: [0.326, 0.48]
	};
	const tooLight = `clamp(0, (l - 0.73) * 1000, 1)`;
	const declarations = BRAND_TOKENS.map((name) => {
		if (name === '--accent-contrast') {
			return `${name}: oklch(from ${seed} calc(1 - ${tooLight} * 0.674) calc(${tooLight} * c * 0.48) h);`;
		}
		const step = Number(name.slice('--accent-'.length));
		const table = steps[step];
		if (table !== undefined) {
			return `${name}: oklch(from ${seed} ${table[0]} calc(c * ${table[1]}) h);`;
		}
		if (step === 9) return `${name}: ${seed};`;
		// step 10, the one neither the table nor the seed answers
		return `${name}: oklch(from ${seed} calc(l - 0.03 * clamp(-1, (l - 0.4) * 1000, 1)) c h);`;
	});
	return `${CARD_ROOT} { ${declarations.join(' ')} }`;
})();

/**
 * the css the brand sheet holds: the watch's keyframes, and the scale for a seeded card — generated
 * where the generator reads the seed, approximated where it does not, and nothing for an unseeded
 * card, which keeps the registry's own.
 */
export function brandCss(seed: string): string {
	if (seed === UNSEEDED || seed === '') return WATCH_KEYFRAMES;
	const scale = generateBrandScale(seed);
	return `${WATCH_KEYFRAMES}\n${scale === null ? APPROXIMATED : brandScaleCss(CARD_ROOT, scale)}`;
}

/**
 * a node for the shadow root that calls `onChange` when the seed it inherits may have moved.
 *
 * nothing on the platform reports a computed value changing, but a registered custom property
 * transitions, and a transition reports itself as it is created. the seed reaches this node by
 * inheritance, so a host's stylesheet, a class on an ancestor and the element's own `style`
 * attribute all arrive here alike. `step-start` puts the node at the new value at once, so the length
 * only has to be above zero, and `--_dur-spin` is the one duration ./tokens.css keeps above zero
 * under `prefers-reduced-motion: reduce` too.
 *
 * a node that is not rendered starts no transition — under a closed `<dialog>` or a hidden tab panel
 * a change reports nothing, then or when the panel opens. an animation starts each time a node is
 * rendered again, so the watch also runs `WATCH_KEYFRAMES` once and reports its `animationstart`,
 * which catches up whatever moved out of sight. the node paints nothing; it is rendered — hidden,
 * sized to nothing and out of flow — for both.
 */
export function seedWatch(doc: Document, onChange: () => void): HTMLElement {
	const node = doc.createElement('div');
	node.setAttribute('aria-hidden', 'true');
	node.style.cssText =
		'position:absolute;inline-size:0;block-size:0;overflow:hidden;visibility:hidden;' +
		'pointer-events:none;transition-property:--donate-primary;' +
		'transition-duration:var(--_dur-spin);transition-timing-function:step-start;' +
		'animation:donate-seed-watch var(--_dur-spin);';
	node.addEventListener('transitionrun', onChange);
	node.addEventListener('animationstart', onChange);
	return node;
}
