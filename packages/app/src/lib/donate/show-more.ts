import { useEffect, useRef, useState } from 'react';
import { href } from 'react-router';
import type { DonorMessages } from './messages';
import type { DonorMessagesWiring, ShowMoreStatus } from './sections/messages';

// Show more messages as /donate and the preview both wire it: a `fetch` of
// ../../routes/donate.messages.ts, which reads only the messages /donate shows, so the preview pages
// through the same list. a plain `fetch` rather than a fetcher: a fetcher's load that fails to reach
// the server is drawn by the page's error boundary in place of the whole page, a gift in progress
// with it, where this one only says error on the section. the route is a resource route, so it
// answers JSON under its own status (`handleResourceRequest` in react-router's server runtime).

/** the section's wiring, ages counted from `now`, the instant the page's loader read it. */
export function useShowMoreMessages(now: string): DonorMessagesWiring {
	const [status, setStatus] = useState<ShowMoreStatus>('idle');
	const [arrived, setArrived] = useState<DonorMessages | null>(null);
	const asking = useRef<AbortController | null>(null);
	useEffect(() => () => asking.current?.abort(), []);

	const onShowMore = async (after: string) => {
		asking.current?.abort();
		const ask = new AbortController();
		asking.current = ask;
		setStatus('loading');
		const answer = await read(after, ask.signal);
		if (ask.signal.aborted) return;
		if (answer === null) {
			setStatus('error');
			return;
		}
		setArrived(answer);
		setStatus('idle');
	};
	return { now, status, arrived, onShowMore };
}

/**
 * the six after `after`, or null where the read was refused — a cursor it could not take, this
 * address over the donor page limit, a read that failed — or never reached the server.
 */
async function read(after: string, signal: AbortSignal): Promise<DonorMessages | null> {
	try {
		const response = await fetch(`${href('/donate/messages')}?${new URLSearchParams({ after })}`, {
			signal,
			headers: { accept: 'application/json' }
		});
		if (!response.ok) return null;
		const body: unknown = await response.json();
		return isPage(body) ? body : null;
	} catch {
		return null;
	}
}

function isPage(body: unknown): body is DonorMessages & { readonly kind: 'messages' } {
	return (
		typeof body === 'object' &&
		body !== null &&
		'kind' in body &&
		body.kind === 'messages' &&
		'messages' in body &&
		Array.isArray(body.messages)
	);
}
