// a receiver's `Retry-After`, read for any outbox feed that takes it
// (https://www.rfc-editor.org/rfc/rfc9110#field.retry-after): delay-seconds or an HTTP-date. what
// the feed does with the wait — which statuses it believes it on, and how long it lets one hold a
// row — is the feed's.

/**
 * the wait a `Retry-After` of `value` asks for, from an answer at `answeredAt`: delay-seconds, or
 * the time to an HTTP-date, zero where that date has passed. anything else, or a wait past what a
 * `Date` holds, is no ask.
 */
export function askedWait(value: string | null, answeredAt: number): number | undefined {
	if (value === null) return undefined;
	const trimmed = value.trim();
	// an HTTP-date names its weekday or month, and the date parser would read a bare number as one.
	const until = /^\d+$/.test(trimmed)
		? answeredAt + Number(trimmed) * 1_000
		: /[a-z]/i.test(trimmed)
			? Date.parse(trimmed)
			: Number.NaN;
	if (!Number.isFinite(new Date(until).getTime())) return undefined;
	return Math.max(0, until - answeredAt);
}
