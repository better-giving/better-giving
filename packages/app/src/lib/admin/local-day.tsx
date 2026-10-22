import { type JSX, useSyncExternalStore } from 'react';
import { calendarDay } from './calendar-day.ts';

// a calendar day as the gifts list shows one: `YYYY-MM-DD` inside `<time>`.
//
// with no zone, `useSyncExternalStore` hydrates on the server snapshot and then renders the
// viewer's zone, so the settled text is the browser's day.

// the zone does not change during the visit, so nothing is subscribed.
function subscribe(): () => void {
	return () => {};
}

// the zone name only. the day is formatted in `calendarDay`, which always receives a zone.
function viewerZone(): string {
	return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

function clientZone(chosen: string | undefined): string {
	if (chosen !== undefined) return chosen;
	return viewerZone();
}

function servedZone(chosen: string | undefined): string {
	if (chosen !== undefined) return chosen;
	// the loader does not know the browser zone, and a day formatted in the process zone hydrates
	// as a different string.
	return 'UTC';
}

export function CalendarDay(props: {
	/** an ISO 8601 instant */
	at: string;
	/**
	 * when set, format in this zone.
	 * callers pass `UTC` for a day an operator chose, which `readAccountingDate`
	 * in packages/app/src/lib/ledger/input-schema.ts stores as UTC midnight.
	 * when omitted, format in the viewer's zone.
	 */
	timeZone?: string;
}): JSX.Element {
	const zone = useSyncExternalStore(
		subscribe,
		() => clientZone(props.timeZone),
		() => servedZone(props.timeZone)
	);
	const day = calendarDay(new Date(props.at), zone);
	return <time dateTime={day}>{day}</time>;
}
