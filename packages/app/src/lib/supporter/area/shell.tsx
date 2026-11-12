import type { ReactNode } from 'react';
import { Form } from 'react-router';
import { PageRoot } from '$lib/donate/page-root';
import { initials, type PageLogo } from '$lib/donate/page-view';
import { imageSrc } from '$lib/page/image-src';
import { INTENT, INTENTS } from './forms';
import { Mark } from './glyph';

// every supporter screen's frame: the donor page's root in the organisation's brand colour, the
// organisation's top bar as /donate draws it (`Masthead` in $lib/donate/page-view.tsx, the same
// classes and the same logo rule), and the screen under it at the page's width. signed in, the
// bar's end carries the address the supporter signed in with and Sign out, where a donor page puts
// its Share link.

/** the organisation as every supporter screen names it. */
export type SupporterOrg = {
	readonly name: string;
	readonly logo: PageLogo | null;
	/** lowercase `#rrggbb`, or null for the registry's default accent. */
	readonly brandColour: string | null;
};

/** the signed-in supporter, for the bar's end. */
export type SupporterAccount = {
	readonly email: string;
	/** where Sign out posts, with `intent` set to `sign-out`. */
	readonly signOutAction: string;
};

export type SupporterShellProps = {
	readonly org: SupporterOrg;
	/** absent before sign-in: the start form and the sign-in screens. */
	readonly account?: SupporterAccount | undefined;
	readonly children: ReactNode;
};

export function SupporterShell({ org, account, children }: SupporterShellProps) {
	return (
		<PageRoot brandColour={org.brandColour} layout="plain">
			<header className="page-mast">
				<div className="page-in page-mast-in">
					<OrgMark org={org} />
					{account === undefined ? null : <Account account={account} />}
				</div>
			</header>
			<main className="page-in sa-main">{children}</main>
		</PageRoot>
	);
}

/** a logo at least twice as wide as it is tall stands for the name, as on /donate. */
function OrgMark({ org }: { readonly org: SupporterOrg }) {
	const { name, logo } = org;
	if (logo === null) {
		const letters = initials(name);
		return (
			<>
				{letters === '' ? null : (
					<span className="page-mast-badge" aria-hidden="true">
						{letters}
					</span>
				)}
				<p className="page-mast-name" title={name}>
					{name}
				</p>
			</>
		);
	}
	const art = (alt: string) => (
		<img
			className="page-mast-logo"
			src={imageSrc(logo.imageId)}
			alt={alt}
			width={logo.width}
			height={logo.height}
		/>
	);
	return logo.width >= 2 * logo.height ? (
		<p className="page-mast-name">{art(name)}</p>
	) : (
		<>
			{art('')}
			<p className="page-mast-name" title={name}>
				{name}
			</p>
		</>
	);
}

function Account({ account }: { readonly account: SupporterAccount }) {
	return (
		<Form method="post" action={account.signOutAction} className="sa-account">
			<input type="hidden" name={INTENT} value={INTENTS.signOut} />
			<span className="sa-account-email">{account.email}</span>
			<button type="submit" className="ds-btn ds-btn-ghost ds-btn-sm">
				<Mark name="log-out" />
				Sign out
			</button>
		</Form>
	);
}
