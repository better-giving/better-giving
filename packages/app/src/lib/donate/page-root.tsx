import { brandScaleCss, generateBrandScale } from '@better-giving/form/styles/radix-scale';
import {
	createContext,
	useContext,
	useId,
	useMemo,
	type CSSProperties,
	type ReactNode
} from 'react';
import type { Layout } from '../page/shape';

// the outer node of every donor page, and the one place its colour is set.
//
// it carries `data-donate-root`, which is the selector packages/form/src/styles/tokens.css declares
// the form's private layer on outside a shadow root. so the brand clamp, the ladder and the corners
// are declared here once for the whole page, and the donation card and every section under it read
// the same ones. `data-layout` is the whole layout the page is drawn in, for ./page.css to arrange
// the sections by.
//
// the brand colour is the page's only accent, set inline as the `--donate-primary` seed. a page with
// no brand colour sets none and writes no scale, and draws the registry's default theme, whose
// accent is a blue (`--accent-9` in packages/form/src/registry/styles/themes/default.css).
//
// the brand scale is radix's custom-palette generator run on that colour, the module the element
// runs on its own seed (packages/form/src/styles/radix-scale.ts), so a donor page and an embedded
// form draw one scale from one colour. it is rendered here, on the server, as a `<style>` setting
// the registry's `--accent-1`…`--accent-12` and `--accent-contrast` (`brandScaleCss`) on this root,
// and on the donation card's own `[data-donate-root]` inside it. both carry `data-brand-scope`, one
// id per page root, so two roots on one document never read each other's scale. ./card.tsx reads
// the id with `useBrandScope`. the form's `--_a*` and `--_p` aliases are declared one node under
// each root (packages/form/src/styles/tokens.css) and read these steps from there.
//
// the single node inside is where the page's own tokens are declared and its ground is painted:
// the form declares its ladder one node under `[data-donate-root]`, so a token reading a rung has to
// be declared there too, and so does a ground drawn from one.

/** the campaign layouts, the Donation page's own, and `plain` for the donation box alone. */
export type RootLayout = Layout | 'donation' | 'plain';

export type PageRootProps = {
	/** lowercase `#rrggbb`, or `null` for a page drawn in the registry's default accent. */
	readonly brandColour: string | null;
	readonly layout: RootLayout;
	/** the caller's placement; the root sets no outer spacing of its own. */
	readonly className?: string;
	readonly children: ReactNode;
};

const BrandScope = createContext<string | undefined>(undefined);

/** the `data-brand-scope` of the page root drawn around this node, or nothing outside one. */
export function useBrandScope(): string | undefined {
	return useContext(BrandScope);
}

/** what the scale's rules match: every `[data-donate-root]` one page root's id is on. */
export function brandScopeSelector(scope: string): string {
	return `[data-donate-root][data-brand-scope="${scope}"]`;
}

export function PageRoot({ brandColour, layout, className, children }: PageRootProps) {
	const scope = useId();
	// a `PageWithCard` pick or lock report re-renders this root, and the colour has not moved.
	const css = useMemo(() => {
		// a page with no brand colour writes no scale: it draws the accent the registry's default theme
		// declares on `:root` (packages/form/src/registry/styles/themes/default.css).
		if (brandColour === null) return null;
		const scale = generateBrandScale(brandColour);
		return scale === null ? null : brandScaleCss(brandScopeSelector(scope), scale);
	}, [brandColour, scope]);
	return (
		<div
			className={className === undefined ? 'page' : `page ${className}`}
			data-donate-root=""
			data-brand-scope={scope}
			data-layout={layout}
			style={
				brandColour === null ? undefined : ({ '--donate-primary': brandColour } as CSSProperties)
			}
		>
			{/* plain children: react's server renderer leaves quotes in a `<style>` as they are and
			    breaks only a `</style` that would close it early. */}
			{css === null ? null : <style>{css}</style>}
			<BrandScope value={scope}>
				<div className="page-ground">{children}</div>
			</BrandScope>
		</div>
	);
}
