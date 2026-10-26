import type { CSSProperties, ReactNode } from 'react';
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
// no brand colour sets none and draws the form's registered grey.
//
// the single node inside is where the page's own tokens are declared and its ground is painted:
// the form declares its ladder one node under `[data-donate-root]`, so a token reading a rung has to
// be declared there too, and so does a ground drawn from one.

/** the campaign layouts, the Donation page's own, and `plain` for the donation box alone. */
export type RootLayout = Layout | 'donation' | 'plain';

export type PageRootProps = {
	/** lowercase `#rrggbb`, or `null` for a page drawn in the form's own grey. */
	readonly brandColour: string | null;
	readonly layout: RootLayout;
	/** the caller's placement; the root sets no outer spacing of its own. */
	readonly className?: string;
	readonly children: ReactNode;
};

export function PageRoot({ brandColour, layout, className, children }: PageRootProps) {
	return (
		<div
			className={className === undefined ? 'page' : `page ${className}`}
			data-donate-root=""
			data-layout={layout}
			style={
				brandColour === null ? undefined : ({ '--donate-primary': brandColour } as CSSProperties)
			}
		>
			<div className="page-ground">{children}</div>
		</div>
	);
}
