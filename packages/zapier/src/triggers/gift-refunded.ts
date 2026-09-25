import sample from '../samples/gift_refunded.json' with { type: 'json' };
import { hookTrigger } from './hook.js';

export default hookTrigger({
	key: 'gift_refunded',
	noun: 'Refund',
	label: 'Gift Refunded',
	description:
		'Triggers when money from a gift goes back to the donor: a refund (source "refund") or a dispute the organisation lost (source "dispute"). More sources may be added, so branch on the ones you know and let others pass; a source’s meaning never narrows.',
	sample
});
