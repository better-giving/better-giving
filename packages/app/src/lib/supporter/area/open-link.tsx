import { useRef } from 'react';
import { Form } from 'react-router';
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

export type OpenLinkProps = {
	readonly org: SupporterOrg;
	/** what the link does: `confirm` publishes a page, `sign_in` signs in. */
	readonly purpose: 'confirm' | 'sign_in';
	/** the link's token, posted back with the press. */
	readonly token: string;
	/** while the press is out. */
	readonly opening: boolean;
};

export function OpenLink({ org, purpose, token, opening }: OpenLinkProps) {
	const confirm = purpose === 'confirm';
	const sent = useRef<string | null>(null);
	return (
		<SupporterShell org={org}>
			<div className="sa-narrow">
				<StateCard
					heading="h1"
					title={confirm ? 'Publish your fundraiser' : 'Open your fundraiser'}
					action={
						<Form
							method="post"
							onSubmit={(event) => {
								if (opening || sent.current === token) event.preventDefault();
								else sent.current = token;
							}}
						>
							<input type="hidden" name={INTENT} value={INTENTS.open} />
							<input type="hidden" name="token" value={token} />
							<button
								type="submit"
								className="ds-btn ds-btn-primary"
								aria-busy={opening || undefined}
							>
								{confirm ? 'Publish my page' : 'Continue'}
							</button>
						</Form>
					}
				>
					{confirm
						? 'Your page goes public when you publish it, and you’re signed in to manage it.'
						: 'Continue to sign in and manage your fundraisers.'}
				</StateCard>
			</div>
		</SupporterShell>
	);
}
