// the batch after a cursor, read from a resource route that answers `{ kind, …, total, next }` under
// its own status, as ../routes/fundraise.pages.$id.gifts.ts and
// ../routes/_app.admin.supporter-pages.more.ts do. a plain `fetch` rather than a fetcher, for
// ./donate/show-more.ts's reason: a fetcher's load that fails to reach the server is drawn by the
// screen's error boundary in place of the whole screen, and react router re-runs a fetcher's load
// after every action, asking again for a batch the screen already holds.

/**
 * the batch `from` answers past `after`, or null where the read was refused (a cursor it could not
 * take, a page no longer the reader's, a read that failed), answered as something other than
 * `kind`, or never reached the server.
 */
export async function readNextBatch<B extends { readonly kind: string; readonly total: number }>(
	from: string,
	after: string,
	kind: B['kind']
): Promise<B | null> {
	try {
		const response = await fetch(`${from}?${new URLSearchParams({ after })}`, {
			headers: { accept: 'application/json' }
		});
		if (!response.ok) return null;
		const body: unknown = await response.json();
		return isBatch<B>(body, kind) ? body : null;
	} catch {
		return null;
	}
}

function isBatch<B extends { readonly kind: string }>(body: unknown, kind: string): body is B {
	return (
		typeof body === 'object' &&
		body !== null &&
		'kind' in body &&
		body.kind === kind &&
		'total' in body &&
		typeof body.total === 'number'
	);
}
