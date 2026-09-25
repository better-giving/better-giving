import { Button } from '@better-giving/operator/components/controls/Button';
import { FieldMessage } from '@better-giving/operator/components/forms/FieldMessage';
import { Banner } from '@better-giving/operator/components/status/Banner';
import { StatusLedger, StatusLine } from '@better-giving/operator/components/status/StatusLine';
import { MarkedText } from '@better-giving/operator/marked-text.react';
import type { ReactNode } from 'react';
import { useEffect, useId, useRef } from 'react';
import type {
	WebhookRepaired,
	WebhookSecretReading,
	WebhookSubscriptionReading
} from '../api/types';
import { noticesNote, noticesStanding, repairLanded } from './notices-standing';
import { noAnswer } from './processor-screen';

// whether Stripe is telling this deployment that a gift was paid, and the one press that puts it
// right where it can be put right in place — drawn among the readings at the head of the Stripe
// screen (./stripe-section.tsx). what each standing is and which of them the press is for is
// ./notices-standing.ts.
//
// **the press is held with `aria-disabled` and turned away in its own handler**, for
// ./quickbooks-section.tsx's reason: a natively closed button drops the focus standing on it, and
// the answer lands while the page is still being read again over it.
//
// **a repair that landed moves the reader to the row.** the re-read after it says `Working`, which
// takes the press away with the standing that drew it, so the reader left on it would be on the
// document; the row's label is described by its word and its sentence, which is what says the
// repair took. a repair that did not land leaves the press standing and the reader on it, with the
// answer under it. either way a reader who has moved on elsewhere is left where they are.

export type PaymentNoticesProps = {
	/** whether the stored signing secret is the one the endpoint signs with. */
	webhook: WebhookSecretReading;
	/** whether the endpoint at this deployment's address is switched on and subscribed. */
	subscription: WebhookSubscriptionReading;
	/** how the last repair press went, or `null`: none made, or its answer is being read over. */
	answer: WebhookRepaired | null;
	/** another press on the page is writing, or a run is going. */
	closed: boolean;
	/** this press is in flight. */
	repairing: boolean;
	onRepair: () => void;
};

/**
 * the row, or `null` where the readings leave it nothing to say.
 *
 * a standing with nothing to say is a read that could not be made, and that is said once above for
 * every reading it spoils, so the press's own answer goes with the row: nothing on the screen then
 * names what it is about.
 */
export function PaymentNotices({
	webhook,
	subscription,
	answer,
	closed,
	repairing,
	onRepair
}: PaymentNoticesProps): ReactNode {
	const row = `${useId()}-payment-notices`;
	const block = useRef<HTMLDivElement>(null);
	const landed = repairLanded(answer);
	useEffect(() => {
		if (!landed) return;
		const active = document.activeElement;
		const dropped =
			active === null || active === document.body || (block.current?.contains(active) ?? false);
		if (dropped) document.getElementById(row)?.focus();
	}, [landed, row]);

	const standing = noticesStanding(webhook, subscription);
	if (standing === null) return null;
	const working = standing.kind === 'working';
	return (
		<div className="adm-named" ref={block}>
			<StatusLedger>
				<StatusLine
					id={row}
					labelAs="h3"
					label="Payment notices"
					word={working ? 'Working' : 'Not working'}
					// working says so with the tick, which the word names for a reader who cannot see it.
					wordOnMark={working}
					tone={working ? 'done' : 'blocker'}
					note={noticesNote(standing)}
				>
					{standing.kind === 'incomplete' ? (
						<div className="adm-status__attach">
							<div className="adm-actions">
								<Button
									type="button"
									variant="primary"
									onClick={() => {
										if (closed) return;
										onRepair();
									}}
									aria-disabled={closed || undefined}
									aria-busy={repairing || undefined}
								>
									Repair
								</Button>
							</div>
						</div>
					) : null}
					{answer === null ? null : <div className="adm-status__attach">{repaired(answer)}</div>}
				</StatusLine>
			</StatusLedger>
		</div>
	);
}

/** what the last repair press did, at the press that made it. */
function repaired(answer: WebhookRepaired): ReactNode {
	if (answer.kind === 'unanswered') return noAnswer(answer.read, 'nothing was repaired');
	if (answer.report.outcome === 'repaired') {
		return (
			<Banner tone="done" word="Repaired">
				Stripe tells this deployment each time a gift is paid from now on.
			</Banner>
		);
	}
	// the deployment's own sentence names what to do, an endpoint deleted since this page was drawn
	// included, and marks the value it names (`@better-giving/operator/code-spans`).
	return (
		<>
			<FieldMessage>This deployment couldn’t repair it, so nothing was changed.</FieldMessage>
			{answer.report.detail === null ? null : (
				<p className="adm-prose">
					<MarkedText text={answer.report.detail} />
				</p>
			)}
		</>
	);
}
