import { type CSSProperties, type JSX, useSyncExternalStore } from 'react';
import { calendarDay } from './calendar-day';

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

function dayIn(at: string, zone: string): string {
	return calendarDay(new Date(at), zone);
}

function clientDay(at: string, zone: string | undefined): string {
	return dayIn(at, zone ?? viewerZone());
}

function servedDay(at: string, zone: string | undefined): string {
	if (zone !== undefined) return dayIn(at, zone);
	// the loader does not know the browser zone. this snapshot is what hydrates, and the viewer's
	// day replaces it. a day here would be the wrong one until that happens.
	return '';
}

// an empty inline box collapses, so the omitted zone holds the line the day will occupy.
// `YYYY-MM-DD` is always ten characters. `1lh` is the element's own line, a relative unit.
const reservedDay: CSSProperties = {
	display: 'inline-block',
	blockSize: '1lh', // raw-length-ok: the element's own line, a relative unit no token names
	inlineSize: '10ch' // raw-length-ok: YYYY-MM-DD is always ten characters; no token is a date width
};

export function CalendarDay(props: {
	/** an ISO 8601 instant */
	at: string;
	/**
	 * when set, format in this zone.
	 * callers pass `UTC` for a day an operator chose, which `readAccountingDate`
	 * in packages/app/src/lib/ledger/input-schema.ts stores as UTC midnight.
	 * when omitted, the server markup is empty and the viewer's zone is used after hydration.
	 */
	timeZone?: string;
}): JSX.Element {
	const day = useSyncExternalStore(
		subscribe,
		() => clientDay(props.at, props.timeZone),
		() => servedDay(props.at, props.timeZone)
	);
	return (
		<time
			dateTime={day === '' ? undefined : day}
			style={props.timeZone === undefined ? reservedDay : undefined}
		>
			{day === '' ? null : day}
		</time>
	);
}
