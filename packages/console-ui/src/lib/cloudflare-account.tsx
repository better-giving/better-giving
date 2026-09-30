import { Modal } from '@better-giving/operator/behaviour/Dialog';
import type { AccountLinkProps } from '@better-giving/operator/components/shell/AccountRow';
import { AccountBand, AccountRow } from '@better-giving/operator/components/shell/AccountRow';
import { StatedValue } from '@better-giving/operator/components/forms/StatedValue';
import type { Feed } from '@better-giving/operator/delivery-pace';
import type { ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import type { FeedsInUse } from '../api/types';
import { pacedFeeds } from './cloudflare-plan';
import type { CloudflarePlanProps } from './cloudflare-plan-block';
import { CloudflarePlan } from './cloudflare-plan-block';
import type { HeldValues } from './held-values';

// the Cloudflare account this deployment runs on, as the rail's foot and the narrow band draw it,
// and the panel either opens: where the paid-plan answer is given.
//
// **the plan is asked here because it is a fact about the account and about nothing else.** no call
// the console's sign-in makes reports it, so the operator says it, and the place they say it is the
// account it is about.
//
// **the account is marked only where the answer costs something now** (`pacedFeeds` in
// ./cloudflare-plan.ts), read once here for both faces from what the deployment holds and which
// feeds it says are in use, and the panel names the same feeds off the same reading. the mark is the
// attention tone's own pair (`attention` in packages/operator/src/components/status/Banner.jsx), and
// its word is read with the name, inside the control that opens the panel explaining it — both faces
// are packages/operator/src/components/shell/AccountRow.jsx.
//
// **the panel opens off a parameter on the address** (`ACCOUNT_PARAM` in ./dialog-params.ts), the
// way ./close-confirm.tsx's confirm does, so its way out is a link and Escape and the browser's
// back button answer it alike.

/** what the account's mark is read out as, after its name. */
export const PACED_WORD = 'Deliveries paced for the Free plan';

export type CloudflareAccountProps = {
	/** the account's name, as cloudflare holds it. */
	name: string;
	/** what the deployment is holding (./held-values.ts), or `null` where it was not read. */
	values: HeldValues | null;
	/** which feeds the deployment says are in use, or `null` where it did not say. */
	feedsInUse: FeedsInUse | null;
	/** the address that opens the account panel. */
	openHref: string;
	/** the press that ends this console, drawn at the row's far end as it is handed. */
	closeControl: ReactNode;
};

/** the panel's opener, moving within the page it was opened over rather than to the top of it. */
function PanelLink({ href, ...rest }: AccountLinkProps): ReactNode {
	return <Link to={href} preventScrollReset {...rest} />;
}

/**
 * the account as the rail's foot draws it (`row`, holding the close) and as the band draws it at
 * phone width (`band`, which stands beside the close). the shell draws only one of the two at any
 * width; they are settled here together so the two cannot disagree about the mark.
 */
export function cloudflareAccount({
	name,
	values,
	feedsInUse,
	openHref,
	closeControl
}: CloudflareAccountProps): { row: ReactNode; band: ReactNode } {
	const account = {
		name,
		brand: 'cloudflare',
		whose: 'Cloudflare account',
		concern: values !== null && pacedFeeds(values, feedsInUse).length > 0 ? PACED_WORD : null,
		href: openHref,
		link: PanelLink
	} as const;
	return {
		row: <AccountRow {...account} out={closeControl} />,
		band: <AccountBand {...account} />
	};
}

export type CloudflareAccountPanelProps = CloudflarePlanProps & {
	/** the account's name, which heads the panel. */
	name: string;
	/** the account's id, which is what cloudflare resolves the name by: the name is not unique. */
	accountId: string;
	/** which feeds are in use, which is what says why the row is marked, or `null` where unsaid. */
	feedsInUse: FeedsInUse | null;
	/** the address the panel was opened over, without the parameter that opened it. */
	back: string;
};

/** each feed as the sentence naming it says it, in the order the plan's note lists them. */
const FEED_NAMES: Readonly<Record<Feed, string>> = {
	zapier: 'Zapier',
	webhooks: 'webhook destinations',
	books: 'QuickBooks'
};

const listed = new Intl.ListFormat('en-GB', { type: 'conjunction' });

export function CloudflareAccountPanel({
	name,
	accountId,
	feedsInUse,
	back,
	...plan
}: CloudflareAccountPanelProps): ReactNode {
	const navigate = useNavigate();
	const paced = pacedFeeds(plan.values, feedsInUse);
	return (
		<Modal
			title={name}
			onDismiss={() => navigate(back, { preventScrollReset: true })}
			// the secondary rank: the switch's own save is the card's one primary press.
			exitProps={{ as: Link, to: back, preventScrollReset: true, variant: 'default' }}
		>
			{/* the id is stated here and on neither opener, where a hint would be read out on every
			    focus of the control. */}
			<StatedValue label="Account ID" value={accountId} code />
			{paced.length === 0 ? null : (
				<p className="adm-prose">
					This deployment delivers to {listed.format(paced.map((feed) => FEED_NAMES[feed]))} at the
					Free plan’s pace.
				</p>
			)}
			<CloudflarePlan {...plan} />
		</Modal>
	);
}
