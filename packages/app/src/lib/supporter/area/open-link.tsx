import { useRef } from 'react';
import { Form } from 'react-router';
import { imageSrc } from '$lib/page/image-src';
import { StateCard } from './cards';
import { INTENT, INTENTS } from './forms';
import { SupporterShell, type SupporterOrg } from './shell';

// the screen a mailed link opens on. the link is spent by its press, never by the visit: a mail
// scanner fetching the address publishes nothing and signs nobody in.
//
// the press posts its token once. a second post finds the token spent and is answered with the
// expired screen, which then replaces the first post's answer, so a double press would tell a
// supporter whose page just went live that the link had expired. `opening` alone arrives a render
// late (the router draws its navigation state in a transition), so the press also remembers the
// token it sent; every answer to it leaves this screen (routes/fundraise.open.tsx).
//
// a confirm link whose page is still waiting shows that page's title and photo above the press, so
// the supporter sees what goes public before they publish it.

export type OpenLinkProps = {
	readonly org: SupporterOrg;
	/** what the link does: `confirm` publishes a page, `sign_in` signs in. */
	readonly purpose: 'confirm' | 'sign_in';
	/** the link's token, posted back with the press. */
	readonly token: string;
	/** while the press is out. */
	readonly opening: boolean;
	/** the page a confirm link publishes; null for a sign-in link or a page no longer waiting. */
	readonly page?: PublishedPage | null | undefined;
};

/** what a confirm link's page shows before it is published. */
export type PublishedPage = { readonly title: string; readonly photoId: string | null };

const PUBLISH_LEDE =
	'Your page goes public when you publish it, and you’re signed in to manage it.';

export function OpenLink({ org, purpose, token, opening, page = null }: OpenLinkProps) {
	const confirm = purpose === 'confirm';
	const sent = useRef<string | null>(null);
	const press = (
		<Form
			method="post"
			onSubmit={(event) => {
				if (opening || sent.current === token) event.preventDefault();
				else sent.current = token;
			}}
		>
			<input type="hidden" name={INTENT} value={INTENTS.open} />
			<input type="hidden" name="token" value={token} />
			<button type="submit" className="ds-btn ds-btn-primary" aria-busy={opening || undefined}>
				{confirm ? 'Publish my page' : 'Continue'}
			</button>
		</Form>
	);
	return (
		<SupporterShell org={org}>
			{confirm && page !== null ? (
				<section className="sa-plane sa-card sa-narrow" aria-labelledby="open-link-heading">
					<h1 className="sa-h1-sm" id="open-link-heading">
						Publish your fundraiser
					</h1>
					{page.photoId === null ? null : (
						<img className="sa-photo-frame" src={imageSrc(page.photoId)} alt="" />
					)}
					<p className="sa-quote">
						<b>{page.title}</b>
					</p>
					<p>{PUBLISH_LEDE}</p>
					{press}
				</section>
			) : (
				<div className="sa-narrow">
					<StateCard
						heading="h1"
						title={confirm ? 'Publish your fundraiser' : 'Open your fundraiser'}
						action={press}
					>
						{confirm ? PUBLISH_LEDE : 'Continue to sign in and manage your fundraisers.'}
					</StateCard>
				</div>
			)}
		</SupporterShell>
	);
}
