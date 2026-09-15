import { LedgerSkeleton } from '@better-giving/operator/components/status/LedgerSkeleton';
import { StatusLedger, StatusLine } from '@better-giving/operator/components/status/StatusLine';

/*
 * the placeholder a processor page draws while its readings are asked for, beside the reading it
 * stands in for — so a change to either shows whether the two still take the same room.
 *
 * the status words are visually hidden and nothing about them is drawn; what is on the page is the
 * shape alone.
 */
export default function StatusLedgerSkeletonPreview() {
	return (
		<div className="adm-stack">
			<LedgerSkeleton label="Asking this deployment…" blocks={[2, 2]} />
			<div className="adm-stack">
				<div className="adm-named">
					<h3>Donation methods</h3>
					<StatusLedger aligned>
						<StatusLine
							labelAs="span"
							label="PayPal"
							word="Approved"
							wordOnMark
							tone="done"
							note="Your keys work, so donors can choose PayPal."
						/>
						<StatusLine
							labelAs="span"
							label="Venmo"
							word="Approved"
							wordOnMark
							tone="done"
							note="Your keys work, so donors in the US can choose Venmo."
						/>
					</StatusLedger>
				</div>
				<div className="adm-named">
					<h3>Recurring donations</h3>
					<StatusLedger>
						<StatusLine labelAs="span" label="Monthly" word="Set up" wordOnMark tone="done" />
						<StatusLine labelAs="span" label="Yearly" word="Set up" wordOnMark tone="done" />
					</StatusLedger>
				</div>
			</div>
		</div>
	);
}
