/**
 * `work` over every item, never more than `limit` at once. a lane that throws stops that lane only;
 * the rest finish before the first fault is rethrown, so one item's fault does not end the
 * invocation under work still in flight.
 */
export async function eachAtMost<T>(
	limit: number,
	items: readonly T[],
	work: (item: T) => Promise<void>
): Promise<void> {
	let next = 0;
	const lane = async () => {
		while (next < items.length) {
			const item = items[next];
			next += 1;
			if (item !== undefined) await work(item);
		}
	};
	const lanes = await Promise.allSettled(
		Array.from({ length: Math.min(limit, items.length) }, lane)
	);
	const fault = lanes.find((l) => l.status === 'rejected');
	if (fault !== undefined) throw fault.reason;
}
