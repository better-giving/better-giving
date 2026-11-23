import { pledgeTold } from '@better-giving/emails';
import { sharesText } from '../../donations/shares';
import {
	alert,
	mailOperator,
	SEND_THIS_TO_WHOEVER_SET_IT_UP,
	TEST_THE_SMTP_SETTINGS
} from '../email/alert';
import type { MailDeps } from './delivery';
import type { ToldPledge } from './pledges';

// the organisation's "a pledge is on its way", sent once, after the answer, for the press that
// claimed the pledge's `told_at` (`markPledgeTold` in ./pledges.ts). a press that claimed nothing
// sends nothing, so the stamp is the whole of "once".
//
// it goes to the notification address in Settings, as every operator mail does (`mailOperator` in
// ../email/alert.ts). every failure is reported to an operator through `alert`, which logs the
// facts before it tries the same address, and none of them is raised: the donor's answer was
// decided by the stamp, and the pledge is on Gifts either way.

const HEADLINE = 'The organisation wasn’t told about a pledge on its way';

/** sends the message, and never throws. */
export async function sendPledgeTold(deps: MailDeps, told: ToldPledge): Promise<void> {
	const facts = [
		{ label: 'Reference', value: told.reference },
		{ label: 'Donor', value: told.donorName }
	];
	try {
		const sent = await mailOperator(deps, pledgeTold.template(toldData(told)));
		if (sent === 'no_address') {
			await alert(deps, {
				headline: HEADLINE,
				body:
					'A donor said they asked their broker or custodian to send a pledged gift, and no ' +
					'notification address is saved to tell. The pledge is on Gifts under Waiting to arrive.',
				facts,
				action: 'In Settings, save a notification address.'
			});
			return;
		}
		if (!sent.ok) {
			await alert(deps, {
				headline: HEADLINE,
				body:
					'A donor said they asked their broker or custodian to send a pledged gift, and the ' +
					'email telling you failed to send. The pledge is on Gifts under Waiting to arrive.',
				facts: [
					...facts,
					{ label: 'What went wrong', value: sent.detail },
					{ label: 'May have been delivered anyway', value: sent.indeterminate ? 'yes' : 'no' },
					{ label: 'Error code', value: sent.reason }
				],
				action: TEST_THE_SMTP_SETTINGS
			});
		}
	} catch (error) {
		try {
			await alert(deps, {
				headline: HEADLINE,
				body:
					'A donor said they asked their broker or custodian to send a pledged gift, and the ' +
					'email telling you failed with an unexpected error. The pledge is on Gifts under ' +
					'Waiting to arrive.',
				facts: [
					...facts,
					{ label: 'Reason', value: error instanceof Error ? error.message : String(error) }
				],
				action: `${TEST_THE_SMTP_SETTINGS}${SEND_THIS_TO_WHOEVER_SET_IT_UP}`
			});
		} catch {
			// the alert rides the transport that may be what faulted. nothing on this path may throw.
		}
	}
}

function toldData(told: ToldPledge): Parameters<typeof pledgeTold.template>[0] {
	const { pledged } = told;
	return {
		donorName: told.donorName,
		donorEmail: told.donorEmail,
		reference: told.reference,
		pledged:
			pledged.method === 'stock'
				? { method: 'stock', ticker: pledged.ticker, shares: sharesText(pledged.sharesMillionths) }
				: {
						method: 'ira_qcd',
						amountMinor: pledged.amountMinor,
						currency: pledged.currency,
						custodian: pledged.custodian
					}
	};
}
