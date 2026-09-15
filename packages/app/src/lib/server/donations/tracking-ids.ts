import type { Processors } from '../payments/factory';
import type { DonationListRow } from './queries';

// the id an organisation marks a donor-advised-fund grant received by, in Chariot's own dashboard:
// the fund pays out later and the payment names the grant's tracking id, not this app's. the id is
// not stored — the processor holds it for as long as it holds the grant (`Settlement.reference` in
// ../payments/provider.ts) — so a list of gifts reads it live, and only for the rows that need it.
//
// a read that decorates a page and never gates one: a refusal, a throw or a slow answer leaves the
// row without its id, and the page draws on time either way.

/** how long the whole page waits on Chariot, across every grant it asks about. */
export const TRACKING_ID_BUDGET_MS = 2_000;

/** a grant still on its way, which is the only gift whose tracking id anybody has to type. */
function awaitsGrant(row: DonationListRow): row is DonationListRow & { providerTxnId: string } {
	return (
		row.status === 'pending' &&
		row.rail?.method === 'daf' &&
		row.rail.provider === 'chariot' &&
		row.providerTxnId !== null
	);
}

/**
 * the tracking id of every pending grant on the page, keyed by gift id, as far as Chariot answered
 * within the budget.
 *
 * `processors` is a thunk so a page holding no pending grant builds no provider at all.
 */
export async function readTrackingIds(
	rows: readonly DonationListRow[],
	processors: () => Processors
): Promise<ReadonlyMap<string, string>> {
	const found = new Map<string, string>();
	const pending = rows.filter(awaitsGrant);
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
