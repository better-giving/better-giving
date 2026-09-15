import { useCallback, useState } from 'react';

// what a processor page's last press sent, kept for as long as this tab holds the console rather
// than for as long as the page is mounted.
//
// **a stop before the store usually names a fix on another page** — the EIN in Organisation, a
// domain on the deployment — and the page's own state goes the moment the operator follows it. the
// run itself is the binary's memory and comes back with the page (`chariotRun` in ../api/client.ts);
// kept here, what was sent comes back beside it, so the press is made again without retyping
// (`boxesStanding` in ./chariot-setup.ts). a reload drops it, and the boxes are seeded from what the
// deployment holds again.
//
// the module's memory and never a `Storage`, for ./processor-cache.ts's reason: nothing about a
// deployment belongs on disk after the console closes, and a key is part of what is kept.

const kept = new Map<string, unknown>();

/**
 * a page's own state for what its press sent, read from and written through to this tab's memory.
 *
 * `page` names the press; two presses on one page keep under two names.
 */
export function useKeptPress<T>(page: string): readonly [T | null, (sent: T | null) => void] {
	const [sent, setSent] = useState<T | null>(() => (kept.get(page) as T | undefined) ?? null);
	const keep = useCallback(
		(next: T | null) => {
			if (next === null) kept.delete(page);
			else kept.set(page, next);
			setSent(next);
		},
		[page]
	);
	return [sent, keep];
}
