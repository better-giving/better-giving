import { Form } from 'react-router';
import { StateCard } from './cards';
import { INTENT, INTENTS } from './forms';
import { SupporterShell, type SupporterOrg } from './shell';

// the screen a mailed link opens on. the link is spent by its press, never by the visit: a mail
// scanner fetching the address publishes nothing and signs nobody in.

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
	return (
		<SupporterShell org={org}>
			<div className="sa-narrow">
				<StateCard
					heading="h1"
					title={confirm ? 'Publish your fundraiser' : 'Open your fundraiser'}
					action={
						<Form method="post">
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
