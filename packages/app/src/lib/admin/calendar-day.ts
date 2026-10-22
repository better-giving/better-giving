// the calendar day an instant falls on in a named zone, zero-padded `YYYY-MM-DD`.
//
// `en-CA` is the locale because its digits are 0-9. year, month, and day are taken from the
// parts and joined, because one formatted string would follow the locale's own order.

export function calendarDay(at: Date, timeZone: string): string {
	const parts = new Intl.DateTimeFormat('en-CA', {
		timeZone,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit'
	}).formatToParts(at);
	const value = (type: 'year' | 'month' | 'day'): string => {
		const found = parts.find((one) => one.type === type);
		if (found === undefined) throw new Error(`calendar day has no ${type}`);
		return found.value;
	};
	return `${value('year')}-${value('month')}-${value('day')}`;
}
