import { StatedValue } from '@better-giving/operator/components/forms/StatedValue';

/*
 * a fact the operator reads and cannot change, in each of the shapes its props make.
 *
 * the label-less one is the one to check: the block is a grid, and a row nothing is placed in is a
 * gap a reader has to account for — so no label row is drawn at all, and what says which value it
 * is has to be the heading above it, which this preview does not have.
 *
 * `code` sets the value in the mono chip, for a stored literal rather than a figure, and `display`
 * sets it at the top of the type scale for the one figure a screen is read for. the two are never
 * worn together and the typedef refuses the pair, so there is no specimen of it here to look at.
 * `num` stands a figure's digits on one stem and rides beside either rung; it is on both figures
 * below, which is what lets the two be read across.
 *
 * the last two are the length cases: a value long enough to wrap, and a value that is empty, which
 * draws a label over nothing.
 */
export default function FormsStatedValuePreview() {
	return (
		<div className="adm-stack">
			<StatedValue label="Currency" value="GBP" />
			<StatedValue label="Payment rail" value="Card, via Stripe">
				Set on the console when the Stripe keys were entered.
			</StatedValue>
			<StatedValue value="No label: named by the heading above it" />
			<StatedValue label="Raised in September" value="$12,480.00" num display />
			<StatedValue label="Gifts in September" value="84" num />
			<StatedValue label="Worker name" value="riverside-shelter-give" code />
			<StatedValue
				label="Webhook endpoint"
				value="https://give.riverside-shelter.org/api/v1/stripe/webhook"
				code
			>
				Stripe posts every settled charge here. It is registered from the console.
			</StatedValue>
			<StatedValue label="Registered address" value="" />
		</div>
	);
}
