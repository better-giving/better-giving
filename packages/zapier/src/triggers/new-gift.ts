import sample from '../samples/new_gift.json' with { type: 'json' };
import { hookTrigger } from './hook.js';

export default hookTrigger({
	key: 'new_gift',
	noun: 'Gift',
	label: 'New Gift',
	description: 'Triggers when a gift settles, each charge of a recurring gift included.',
	sample
});
