import sample from '../samples/new_donor.json' with { type: 'json' };
import { hookTrigger } from './hook.js';

export default hookTrigger({
	key: 'new_donor',
	noun: 'Donor',
	label: 'New Donor',
	description: "Triggers when a donor's first gift settles.",
	sample
});
