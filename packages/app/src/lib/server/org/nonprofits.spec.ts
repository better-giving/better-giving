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
		['SOCIETY OF ST VINCENT', 'Society of St Vincent'],
		['YMCA OF THE USA', 'YMCA of the USA']
	])('titles %s on a lookup and titles the street', async (sent, titled) => {
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
				address_line1: '431 18th St NW',
				city: 'Washington',
				region: 'DC',
				postal_code: '20006'
			}
		});
	});

	it.each([
		['431 18TH ST NW', '431 18th St NW'],
		['601 E ST NW', '601 E St NW'],
		['12 3RD ST NW', '12 3rd St NW'],
		['PO BOX 1018', 'PO Box 1018']
	])('titles the street %s', async (sent, titled) => {
		serviceAnswers({
			...organisation(null),
			address: { street: sent, city: 'WASHINGTON', state: 'DC', zip: '20006' }
		});

		const answer = await lookUpNonprofit('53-0196605', undefined);

		expect(answer).toMatchObject({ outcome: 'found', fields: { address_line1: titled } });
	});

	it.each([
		['COLORADO SPGS', 'Colorado Spgs'],
		['BLMNG PRAIRIE', 'Blmng Prairie']
	])('titles the city %s', async (sent, titled) => {
		serviceAnswers({
			...organisation(null),
			address: { street: '1 MAIN ST', city: sent, state: 'CO', zip: '80903' }
		});

		const answer = await lookUpNonprofit('53-0196605', undefined);

		expect(answer).toMatchObject({ outcome: 'found', fields: { city: titled } });
	});

	it('titles the street and leaves the region and the postal code', async () => {
		serviceAnswers({
			...organisation(null),
			name: 'YMCA OF THE USA',
			address: { street: '431 18TH STREET NW', city: 'WASHINGTON', state: 'DC', zip: '20006' }
		});

		const answer = await lookUpNonprofit('53-0196605', undefined);

		expect(answer).toMatchObject({
			outcome: 'found',
			fields: {
				legal_name: 'YMCA of the USA',
				address_line1: '431 18th Street NW',
				city: 'Washington',
				region: 'DC',
				postal_code: '20006'
			}
		});
	});

	it.each([
		['VARIETY BOYS AND GIRLS CLUB LOS ANGELES', 'Variety Boys and Girls Club Los Angeles'],
		['MONTGOMERY HABITAT FOR HUMANITY INC', 'Montgomery Habitat for Humanity Inc'],
		['YMCA YORK, PA', 'YMCA York, PA'],
		['BOYS AND GIRLS CLUB, IN INDIANAPOLIS', 'Boys and Girls Club, IN Indianapolis'],
		['MCGAW YMCA', 'McGaw YMCA'],
		['METROWEST YMCA', 'Metrowest YMCA'],
		["O'BRIEN", "O'Brien"],
		['MACDONALD', 'MacDonald'],
		['MACHINE', 'Machine'],
		['WINSTON-SALEM FOUNDATION', 'Winston-Salem Foundation'],
		['GREATER MACEDONIA', 'Greater Macedonia'],
		['MACEDONIA CDC', 'Macedonia CDC'],
		['E&K TRITES TRUST FBO', 'E&K Trites Trust FBO'],
		['VFW POST 4884', 'VFW Post 4884'],
		['LANCASTER SPCA', 'Lancaster SPCA'],
		['SOUTHSIDE PTO', 'Southside PTO'],
		['WESLEY AME ZION CHURCH', 'Wesley AME Zion Church'],
		['AARP FOUNDATION', 'AARP Foundation'],
		['CHRIST THE KING LUTHERAN SCHOOL LLC', 'Christ the King Lutheran School LLC'],
		['HENRY FORD II FUND', 'Henry Ford II Fund'],
		['EUGENE EDGE III CHARITABLE TRUST', 'Eugene Edge III Charitable Trust'],
		['AUGUST A BUSCH III CHARITABLE TRUST', 'August A Busch III Charitable Trust'],
		['ST MARYS CHURCH', 'St Marys Church'],
		['COMMUNITY HOUSING CORP', 'Community Housing Corp'],
		['MOUNT ZION BAPTIST', 'Mount Zion Baptist'],
		['MIAMI, FL', 'Miami, FL'],
		['SPRINGFIELD, CT', 'Springfield, CT'],
		['BANDON COMMUNITY HEALTH CTR', 'Bandon Community Health Ctr'],
		['METHODIST HOSPITAL FDN', 'Methodist Hospital Fdn'],
		['BROMLEY CHARITABLE TR', 'Bromley Charitable Tr'],
		['WALNUT RIDGE LAND TRUST III LTD', 'Walnut Ridge Land Trust III Ltd'],
		['ARIZOU DBA BASTA', 'Arizou DBA Basta'],
		['KEESLER AFB', 'Keesler AFB'],
		['GULF MS CHAPTER', 'Gulf MS Chapter']
	])('titles %s on a lookup', async (sent, titled) => {
		serviceAnswers({ ...organisation(null), name: sent });

		const answer = await lookUpNonprofit('53-0196605', undefined);

		expect(answer).toMatchObject({ outcome: 'found', fields: { legal_name: titled } });
	});

	it.each([
		['AMERICAN NATIONAL RED CROSS', 'American National Red Cross'],
		['SOCIETY OF ST VINCENT', 'Society of St Vincent'],
		['YMCA OF THE USA', 'YMCA of the USA'],
		['YMCA YORK, PA', 'YMCA York, PA']
	])('titles %s on a search match and titles the city', async (sent, titled) => {
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
			matches: [{ name: titled, city: 'Washington', state: 'DC' }]
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
