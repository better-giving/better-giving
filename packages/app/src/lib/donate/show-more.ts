import { href, useFetcher } from 'react-router';
import type { loader as showMoreLoader } from '../../routes/donate.messages';
import type { DonorMessagesWiring, ShowMoreStatus } from './sections/messages';

// Show more messages as /donate and the preview both wire it: one fetcher asking
// ../../routes/donate.messages.ts, which reads only the messages /donate shows, so the preview pages
// through the same list. the loader is imported as a type alone: the route imports the server read.

/**
 * how Show more messages is going: busy while the read is out, and error where it was answered
 * with a refusal — a cursor the read could not take, or this address over the donor page limit.
 */
function showMoreStatus(fetcher: {
	state: string;
	data?: { kind: string } | undefined;
}): ShowMoreStatus {
	if (fetcher.state !== 'idle') return 'loading';
	return fetcher.data?.kind === 'refused' ? 'error' : 'idle';
}

/** the section's wiring, ages counted from `now`, the instant the page's loader read it. */
export function useShowMoreMessages(now: string): DonorMessagesWiring {
	const showMore = useFetcher<typeof showMoreLoader>();
	return {
		now,
		status: showMoreStatus(showMore),
		// the fetcher's own object, never a copy: the section tells a new answer from the one it
		// already added by identity.
		arrived: showMore.data?.kind === 'messages' ? showMore.data : null,
		onShowMore: (after) =>
			showMore.load(`${href('/donate/messages')}?${new URLSearchParams({ after })}`)
	};
}
