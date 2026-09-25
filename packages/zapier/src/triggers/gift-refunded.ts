import sample from '../samples/gift_refunded.json' with { type: 'json' };
import { hookTrigger } from './hook.js';

export default hookTrigger({
	key: 'gift_refunded',
	noun: 'Refund',
	label: 'Gift Refunded',
	description:
		'Triggers when money from a gift goes back to the donor: a refund, or a dispute the organisation lost.',
	sample
});
