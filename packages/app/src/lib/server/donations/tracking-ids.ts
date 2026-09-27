import type { Processors } from '../payments/factory';
import type { DonationListRow } from './queries';

// the id an organisation marks a donor-advised-fund grant received by, in Chariot's own dashboard:
// the fund pays out later and the payment names the grant's tracking id, not this app's. it is also
// what staff match a gift by when a grant's write fails and its alert names only the tracking id.
//
// the stored value comes first: `payment.provider_reference` (../db/schema.ts), on every Chariot
// gift whatever its state, with no call made. only a pending grant stored without one is read live
// (`Settlement.reference` in ../payments/provider.ts).
//
// the live read decorates a page and never gates one: a refusal, a throw or a slow answer leaves
// the row without its id, and the page draws on time either way.

/** how long the whole page waits on Chariot, across every grant it asks about. */
export const TRACKING_ID_BUDGET_MS = 2_000;

/** a grant still on its way whose tracking id was not stored, the only gift worth asking about. */
function awaitsUnstoredGrant(
	row: DonationListRow
): row is DonationListRow & { providerTxnId: string } {
	return (
		row.status === 'pending' &&
		row.rail?.method === 'daf' &&
		row.rail.provider === 'chariot' &&
		row.providerTxnId !== null &&
		row.providerReference === null
	);
}

/**
 * the tracking id of every Chariot gift on the page, keyed by gift id: the stored one, and for a
 * pending grant stored without one, as far as Chariot answered within the budget.
 *
 * `processors` is a thunk so a page with nothing to ask builds no provider at all.
 */
export async function readTrackingIds(
	rows: readonly DonationListRow[],
	processors: () => Processors
): Promise<ReadonlyMap<string, string>> {
	const found = new Map<string, string>();
	for (const row of rows) {
		if (row.rail?.provider === 'chariot' && row.providerReference !== null) {
			found.set(row.id, row.providerReference);
		}
	}
	const pending = rows.filter(awaitsUnstoredGrant);
	if (pending.length === 0) return found;

	const chariot = processors().for('chariot');
	// the factory's providers are sealed and answer every failure as a refusal, so nothing here throws.
	const reads = pending.map(async (row) => {
		const settlement = await chariot.readSettlement(row.providerTxnId);
		if (settlement.ok && settlement.value.reference !== undefined) {
			found.set(row.id, settlement.value.reference);
		}
	});

	let timer: ReturnType<typeof setTimeout> | undefined;
	const deadline = new Promise<void>((resolve) => {
		timer = setTimeout(resolve, TRACKING_ID_BUDGET_MS);
	});
	await Promise.race([Promise.all(reads), deadline]);
	clearTimeout(timer);
	return found;
}
