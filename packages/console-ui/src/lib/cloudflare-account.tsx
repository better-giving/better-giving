import { Modal } from '@better-giving/operator/behaviour/Dialog';
import type { Feed } from '@better-giving/operator/delivery-pace';
import { Brand } from '@better-giving/operator/components/status/Brand';
import { Mark } from '@better-giving/operator/components/status/Mark';
import type { ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import type { FeedsInUse } from './cloudflare-plan';
import { planConcern } from './cloudflare-plan';
import type { CloudflarePlanProps } from './cloudflare-plan-block';
import { CloudflarePlan } from './cloudflare-plan-block';

// the Cloudflare account this deployment runs on, as the foot of the rail draws it, and the panel
// its name opens: where the paid-plan answer is given.
//
// **the plan is asked here because it is a fact about the account and about nothing else.** no call
// the console's sign-in makes reports it, so the operator says it, and the place they say it is the
// row naming the account it is about.
//
// **the row is marked only where the answer costs something now** (`planConcern` in
// ./cloudflare-plan.ts). the mark is the attention tone's own pair (`attention` in
// packages/operator/src/components/status/Banner.jsx), and its word is read with the name, inside
// the control that opens the panel explaining it, the way a rail cell's status is
// (packages/operator/src/components/shell/DestinationCell.jsx).
//
// **the panel opens off a parameter on the address** (`ACCOUNT_PARAM` in ./dialog-params.ts), the
// way ./close-confirm.tsx's confirm does, so its way out is a link and Escape and the browser's
// back button answer it alike.

/** what the row's mark is read out as, after the account's name. */
export const PACED_WORD = 'Deliveries paced for the Free plan';

export type CloudflareAccountProps = {
	/** the account's name, as cloudflare holds it. */
	name: string;
	/** the account's id, which is what cloudflare resolves the name by: the name is not unique. */
	accountId: string;
	/** whether the plan is worth the operator's look (`planConcern` in ./cloudflare-plan.ts). */
	concern: boolean;
	/** the address that opens the account panel. */
	openHref: string;
	/** the press that ends this console, drawn at the row's far end as it is handed. */
	closeControl: ReactNode;
};

export function CloudflareAccount({
	name,
	accountId,
	concern,
	openHref,
	closeControl
}: CloudflareAccountProps): ReactNode {
	return (
		<div className="adm-footaccount">
			<span className="adm-rail__lead">
				<Brand name="cloudflare" label="Cloudflare" />
			</span>
			<Link className="adm-footaccount__open" to={openHref} preventScrollReset title={accountId}>
				<span className="adm-footaccount__name">{name}</span>
				{concern ? (
					<>
						<span className="adm-footaccount__status">
							<Mark name="triangle-alert" />
						</span>
						<span className="adm-vh">, {PACED_WORD}</span>
					</>
				) : null}
			</Link>
			<span className="adm-footaccount__out">{closeControl}</span>
		</div>
	);
}

export type CloudflareAccountPanelProps = CloudflarePlanProps & {
	/** the account's name, which heads the panel. */
	name: string;
	/** which feeds are in use, which is what says why the row is marked. */
	feedsInUse: FeedsInUse;
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
	feedsInUse,
	back,
	...plan
}: CloudflareAccountPanelProps): ReactNode {
	const navigate = useNavigate();
	const paced = planConcern(plan.values, feedsInUse)
		? (Object.keys(FEED_NAMES) as Feed[]).filter((feed) => feedsInUse[feed] === true)
		: [];
	return (
		<Modal
			title={name}
			onDismiss={() => navigate(back, { preventScrollReset: true })}
			// the secondary rank: the switch's own save is the card's one primary press.
			exitProps={{ as: Link, to: back, preventScrollReset: true, variant: 'default' }}
		>
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
