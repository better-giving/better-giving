import { describe, expect, it, vi } from 'vitest';
import { lookUpNonprofit, searchNonprofits } from './nonprofits';

// what the lookup makes of a revocation date the service sends, with `fetch` as the seam.
// Settings formats the date it is handed (`standingNote` in $lib/admin/settings/nonprofit-finder.ts),
// so a date it cannot read has to leave here as `null`, the answer that names no day.

/** a `fetch` that answers every request with `payload` as JSON. */
function serviceAnswers(payload: unknown) {
	vi.stubGlobal(
		'fetch',
		vi.fn(
			async () =>
				new Response(JSON.stringify(payload), {
					status: 200,
					headers: { 'content-type': 'application/json' }
				})
		)
	);
}

const REVOKED = { deductible: false, revoked: true };

const organisation = (revocationDate: string | null) => ({
	ein: '530196605',
	name: 'American National Red Cross',
	address: { street: '431 18th St NW', city: 'Washington', state: 'DC', zip: '20006' },
	...REVOKED,
	revocationDate
});

const search = (revocationDate: string | null) => ({
	results: [
		{
			ein: '530196605',
			name: 'American National Red Cross',
			city: 'Washington',
			state: 'DC',
			...REVOKED,
			revocationDate
		}
	]
});

describe('an IRS name stored in capitals', () => {
	it.each([
		['AMERICAN NATIONAL RED CROSS', 'American National Red Cross'],
		['SOCIETY OF ST VINCENT', 'Society of St Vincent']
	])('titles %s on a lookup and leaves the address', async (sent, titled) => {
		serviceAnswers({
			...organisation(null),
			name: sent,
			address: { street: '431 18TH ST NW', city: 'WASHINGTON', state: 'DC', zip: '20006' }
		});

		const answer = await lookUpNonprofit('53-0196605', undefined);

		expect(answer).toMatchObject({
			outcome: 'found',
			fields: {
				legal_name: titled,
				address_line1: '431 18TH ST NW',
				city: 'WASHINGTON',
				region: 'DC'
			}
		});
	});

	it.each([
		['AMERICAN NATIONAL RED CROSS', 'American National Red Cross'],
		['SOCIETY OF ST VINCENT', 'Society of St Vincent']
	])('titles %s on a search match and leaves the city', async (sent, titled) => {
		serviceAnswers({
			results: [
				{
					ein: '530196605',
					name: sent,
					city: 'WASHINGTON',
					state: 'DC',
					...REVOKED,
					revocationDate: null
				}
			]
		});

		const answer = await searchNonprofits('red cross', undefined);

		expect(answer).toMatchObject({
			outcome: 'found',
			matches: [{ name: titled, city: 'WASHINGTON', state: 'DC' }]
		});
	});
});

describe('a revocation date the service sends', () => {
	it.each(['', 'not a date'])('reads %j as no date on a lookup', async (sent) => {
		serviceAnswers(organisation(sent));

		const answer = await lookUpNonprofit('53-0196605', undefined);

		expect(answer).toMatchObject({ outcome: 'found', revoked: true, revocationDate: null });
	});

	it.each(['', 'not a date'])('reads %j as no date on a search match', async (sent) => {
		serviceAnswers(search(sent));

		const answer = await searchNonprofits('red cross', undefined);

		expect(answer).toMatchObject({
			outcome: 'found',
			matches: [{ revoked: true, revocationDate: null }]
		});
	});

	it('keeps a date it can read as sent', async () => {
		serviceAnswers(organisation('2023-05-15'));

		const answer = await lookUpNonprofit('53-0196605', undefined);

		expect(answer).toMatchObject({ outcome: 'found', revocationDate: '2023-05-15' });
	});
});
