import { Modal } from '@better-giving/operator/behaviour/Dialog';
import type { AccountLinkProps } from '@better-giving/operator/components/shell/AccountRow';
import { AccountBand, AccountRow } from '@better-giving/operator/components/shell/AccountRow';
import { StatedValue } from '@better-giving/operator/components/forms/StatedValue';
import type { Feed } from '@better-giving/operator/delivery-pace';
import type { ReactNode } from 'react';
import { useFetcher } from 'react-router';
import type { FeedsInUse } from '../api/types';
import type { PlanAnswer } from './cloudflare-plan';
import { PLAN_FETCHER, pacedFeeds } from './cloudflare-plan';
import type { CloudflarePlanProps } from './cloudflare-plan-block';
import { CloudflarePlan } from './cloudflare-plan-block';
import { DialogLink, useLeaveDialog } from './dialog-params';
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
// way ./close-confirm.tsx's confirm does, so Escape, its way out and the browser's back button
// answer it alike: the opener pushes an entry the way out steps back over (`leaveDialog` in
// ./dialog-params.ts).
//
// **the panel reads its presses' answers itself**, off the fetcher the plan block posts them
// through (`PLAN_FETCHER` in ./cloudflare-plan.ts), in the shape `/` answers them in
// (`PlanAnswer` there): what mounts the panel hands it facts about the account and nothing about a
// press.

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
	return <DialogLink to={href} preventScrollReset {...rest} />;
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

export type CloudflareAccountPanelProps = Omit<
	CloudflarePlanProps,
	'written' | 'freed' | 'busy' | 'pending'
> & {
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

/**
 * the account panel, over whatever page it was opened on.
 *
 * **mounted only while it is open**, which is what its fetcher's life is: an answer drawn and put
 * away is not reported again the next time it opens. so a press still out when the panel is put
 * away is answered to nothing: a refusal it would have drawn at the switch is not drawn, and a
 * write that throws is dropped without a word, where with the panel open it meets the layout's
 * boundary. a binary that has stopped is met by the next navigation's reading instead.
 */
export function CloudflareAccountPanel({
	name,
	accountId,
	feedsInUse,
	back,
	...plan
}: CloudflareAccountPanelProps): ReactNode {
	const leave = useLeaveDialog();
	const press = useFetcher<PlanAnswer>({ key: PLAN_FETCHER });
	const posted = press.formData?.get('intent');
	const pending = typeof posted === 'string' ? posted : null;
	const answer = press.data;
	const paced = pacedFeeds(plan.values, feedsInUse);
	return (
		<Modal
			title={name}
			onDismiss={() => leave(back)}
			// the secondary rank: the switch's own save is the card's one primary press.
			exitProps={{ type: 'button', onClick: () => leave(back), variant: 'default' }}
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
			<CloudflarePlan
				{...plan}
				written={answer !== undefined && 'plan' in answer ? answer.plan : null}
				freed={answer !== undefined && 'freed' in answer ? answer.freed : null}
				busy={pending !== null}
				pending={pending}
			/>
		</Modal>
	);
}
