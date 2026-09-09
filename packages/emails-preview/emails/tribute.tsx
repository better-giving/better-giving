import { tribute } from '@better-giving/emails';

// the notice the person a donor asked us to tell gets about a gift given in someone's memory. the
// organisation's registered name arrives proven — a deployment that has none writes no notice at
// all, and that refusal is the app's rather than the template's.
export default function Tribute() {
	return tribute.template({
		legalName: 'Hope Foundation',
		notifyName: 'Margaret Chen',
		donorName: 'Ada Lovelace',
		tribute: { label: 'In memory of', honoree: 'Grace Hopper' }
	}).node;
}
