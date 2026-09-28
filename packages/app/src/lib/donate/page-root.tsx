import type { CSSProperties, ReactNode } from 'react';
import type { Corner, Layout, Palette, Shade } from '../page/keys';
import { brandHue, groundHue, pageHue2 } from '../page/palette';

// the outer node of every donor page, and the one place a page's look is set.
//
// it carries the four axes as attributes and `data-donate-root` beside them, which is the selector
// packages/form/src/styles/tokens.css declares the form's private layer on outside a shadow root.
// so the brand clamp, the ladder and the corners are declared here once for the whole page, and the
// donation card and every block under it read the same ones. ./page.css turns `data-shade` and
// `data-corner` into the form's two preset seeds and reads `data-palette`; `data-layout` is for the
// blocks to arrange themselves by.
//
// the brand colour is the one axis that is a value rather than a keyword, so it is set inline as
// the `--donate-primary` seed, and with it the hues its palette draws grounds at — worked out here,
// on the server render, because each is a condition on a number (../page/palette.ts). a page with
// no brand colour sets none of them and draws the form's registered grey.
//
// the single node inside is where the page's own tokens are declared and its ground is painted:
// the form declares its ladder one node under `[data-donate-root]`, so a token reading a rung has to
// be declared there too, and so does a ground drawn from one.

export type PageRootProps = {
	/** lowercase `#rrggbb`, or `null` for a page drawn in the form's own grey. */
	readonly brandColour: string | null;
	readonly shade: Shade;
	readonly corner: Corner;
	readonly palette: Palette;
	readonly layout: Layout;
	/** the caller's placement; the root sets no outer spacing of its own. */
	readonly className?: string;
	readonly children: ReactNode;
};

const DRAWS_BRAND_HUE: ReadonlySet<Palette> = new Set(['tint', 'duo', 'bold']);

const degrees = (hue: number) => String(Math.round(hue * 10) / 10);

function seeds(brandColour: string | null, palette: Palette): CSSProperties | undefined {
	if (brandColour === null) return undefined;
	const hue = brandHue(brandColour);
	const second = pageHue2(hue, palette);
	return {
		'--donate-primary': brandColour,
		...(DRAWS_BRAND_HUE.has(palette) ? { '--page-hue': degrees(groundHue(hue)) } : {}),
		...(second === null ? {} : { '--page-hue-2': degrees(second) })
	} as CSSProperties;
}

export function PageRoot({
	brandColour,
	shade,
	corner,
	palette,
	layout,
	className,
	children
}: PageRootProps) {
	return (
		<div
			className={className === undefined ? 'page' : `page ${className}`}
			data-donate-root=""
			data-shade={shade}
			data-corner={corner}
			data-palette={palette}
			data-layout={layout}
			style={seeds(brandColour, palette)}
		>
			<div className="page-ground">{children}</div>
		</div>
	);
}
