import type { ReactNode } from 'react';
import { Form } from 'react-router';
import { PageRoot } from '$lib/donate/page-root';
import type { PageLogo } from '$lib/donate/page-view';
import { SiteFooter, type SiteFooterInfo } from '$lib/donate/site-footer';
import { MAIN_ID, SiteNav } from '$lib/donate/site-nav';
import { INTENT, INTENTS } from './forms';
import { Mark } from './glyph';

// every supporter screen's frame: the donor page's root in the organisation's brand colour, the
// site nav as `/` draws it ($lib/donate/site-nav.tsx), the screen under it at the page's
// width, and the compact site footer ($lib/donate/site-footer.tsx) closing it, as on every donor
// page. signed in, the nav's actions are the address the supporter signed in with and Sign out:
// at the bar's end from 40rem, and under the menu's row below it, where the registry folds actions.

/** the organisation as every supporter screen names it. */
export type SupporterOrg = {
	readonly name: string;
	readonly logo: PageLogo | null;
	/** lowercase `#rrggbb`, or null for the registry's default accent. */
	readonly brandColour: string | null;
	/** what the site footer states: the legal details and the ways to reach the organisation. */
	readonly footer: SiteFooterInfo;
};

/** the signed-in supporter, for the nav's actions. */
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
		<PageRoot
			brandColour={org.brandColour}
			layout="plain"
			header={
				<SiteNav
					name={org.name}
					logo={org.logo}
					current={false}
					{...(account === undefined ? {} : { actions: <Account account={account} /> })}
				/>
			}
			footer={<SiteFooter info={org.footer} />}
		>
			<main className="page-in sa-main" id={MAIN_ID} tabIndex={-1}>
				{children}
			</main>
		</PageRoot>
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
