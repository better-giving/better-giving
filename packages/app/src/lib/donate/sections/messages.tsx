import { useEffect, useId, useRef, useState } from 'react';
import type { DonorMessage, DonorMessages as DonorMessagesPage } from '../messages';
import { messageAge } from '../message-age';

// "Messages from donors" on /donate: the notes donors asked to show, six at a time, newest first,
// in a plane that clips a list, with a band under it counting what is shown and asking for six more.
// with no message the section is not drawn at all: nothing stands where it would.
//
// the route owns the request. a press hands `onShowMore` the cursor the last page ended on, and the
// route's answer arrives as `arrived` (the fetcher's data) while `status` says how the request is
// going. the list keeps what it has shown and adds an answer only while a press is waiting on one,
// so the same answer handed back again — a revalidation — adds nothing twice.
//
// while a press is out the button holds its focus, busy, and says "Loading"; the count line is the
// live region that says the new count, and the button and a refusal's alert stand outside it, so
// neither is read out again with it. when an answer is the last page the band and its button go, and
// focus moves to the first message the answer added, which takes focus for that alone.

export type ShowMoreStatus = 'idle' | 'loading' | 'error';

/** what the route wires a page's messages section with. */
export type DonorMessagesWiring = {
	/** when the page was read, ISO 8601: every message's age is counted from it, server and browser alike. */
	readonly now: string;
	readonly status: ShowMoreStatus;
	/** the latest page a press of Show more was answered with; null before any. */
	readonly arrived: DonorMessagesPage | null;
	/** asks for the six after `after`, the `next` the list ends on. */
	readonly onShowMore: (after: string) => void;
};

export type DonorMessagesProps = DonorMessagesWiring & {
	/** the newest six, read with the page. */
	readonly initial: DonorMessagesPage;
	/** the page's locale, which the ages and the count are written in. */
	readonly locale: string;
};

type Shown = {
	readonly messages: readonly DonorMessage[];
	readonly total: number;
	readonly next: string | null;
	/** where the last answer's messages start in `messages`; null before any. */
	readonly from: number | null;
};

export function DonorMessages({
	initial,
	locale,
	now,
	status,
	arrived,
	onShowMore
}: DonorMessagesProps) {
	const headingId = useId();
	const list = useRef<HTMLUListElement>(null);
	const [shown, setShown] = useState<Shown>({
		messages: initial.messages,
		total: initial.total,
		next: initial.next,
		from: null
	});
	// the answer standing when the press went out, so the one after it is told from it.
	const [waiting, setWaiting] = useState<{ readonly before: DonorMessagesPage | null } | null>(
		null
	);
	if (waiting !== null && arrived !== null && arrived !== waiting.before) {
		setShown({
			messages: [...shown.messages, ...arrived.messages],
			total: arrived.total,
			next: arrived.next,
			from: shown.messages.length
		});
		setWaiting(null);
	}

	// keyed on the answer that emptied the list's last page, which is what unmounts the button: focus
	// was on it and would otherwise fall to the document. a reader who moved on meanwhile is left be.
	useEffect(() => {
		if (shown.from === null || shown.next !== null) return;
		const active = document.activeElement;
		if (active !== null && active !== document.body) return;
		const first = list.current?.children[shown.from];
		if (first instanceof HTMLElement) first.focus();
	}, [shown]);

	if (shown.total <= 0 || shown.messages.length === 0) return null;
	const loading = status === 'loading';
	const count = new Intl.NumberFormat(locale);
	return (
		<section aria-labelledby={headingId} data-area="messages">
			<h2 className="page-messages-heading" id={headingId}>
				Messages from donors
			</h2>
			<div className="page-messages-plane">
				<ul className="page-messages-list" ref={list}>
					{shown.messages.map((message, at) => (
						<li
							// keyed by position: a message carries no id to the page, and the list only grows at its end.
							key={at}
							className="page-messages-row"
							tabIndex={at === shown.from && shown.next === null ? -1 : undefined}
						>
							<div className="page-messages-by">
								<span className="page-messages-name">{message.name}</span>
								<time className="page-messages-time" dateTime={message.receivedAt}>
									{messageAge(message.receivedAt, now, locale)}
								</time>
							</div>
							<p className="page-messages-note">{message.note}</p>
						</li>
					))}
				</ul>
				{shown.next === null ? null : (
					<div className="page-messages-foot">
						<p className="page-messages-count" role="status">
							Showing {count.format(shown.messages.length)} of {count.format(shown.total)} messages
						</p>
						{/* the design draws no failed Show more (design-spec.md, Messages from donors): this
						    sentence is the least that says so, and the button stays to try again. */}
						{status === 'error' ? (
							<p className="page-messages-refused" role="alert">
								Couldn’t load more messages. Try again.
							</p>
						) : null}
						<button
							type="button"
							className="ds-btn ds-btn-secondary ds-btn-sm page-messages-more"
							aria-busy={loading || undefined}
							onClick={() => {
								const after = shown.next;
								if (loading || after === null) return;
								setWaiting({ before: arrived });
								onShowMore(after);
							}}
						>
							{loading ? (
								<>
									<span className="page-spinner" aria-hidden="true" />
									Loading
								</>
							) : (
								'Show more messages'
							)}
						</button>
					</div>
				)}
			</div>
		</section>
	);
}
