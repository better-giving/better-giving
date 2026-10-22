// the calendar day an instant falls on in a named zone, zero-padded `YYYY-MM-DD`.
//
// the parts are joined year, month, day, so the locale's own order never decides the string.
// `en-CA` pins latin digits. a sliced `format()` would follow that locale's order.

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
