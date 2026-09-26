import sample from '../samples/gift_refunded.json' with { type: 'json' };
import { hookTrigger } from './hook.js';

export default hookTrigger({
	key: 'gift_refunded',
	noun: 'Refund',
	label: 'Gift Refunded',
	description:
		'Triggers when money from a gift goes back to the donor: a refund the organisation made (source "refund"), or a dispute the organisation lost or a payment the donor’s bank returned (source "dispute"). For a dispute, occurred_at is when it opened, which can be weeks before this event arrives. A refund can, rarely, fail after it was sent here, and no event follows to say so. This event can arrive before the same gift’s New Gift event; the gift it came out of is included whole. More sources may be added, so branch on the ones you know and let others pass; a source’s meaning never narrows.',
	sample
});
