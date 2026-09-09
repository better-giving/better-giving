// the page's state, in the address bar.
//
// so that a card worth showing somebody is a link rather than a list of controls to reset by hand,
// and so that a reload lands back on the one being looked at. `replaceState` rather than `pushState`:
// dragging a colour picker mints a value per frame, and each of those as a history entry would make
// Back a way of stepping through a gesture.
//
// nothing here validates a value. the controls in ./main.ts do, each against what it can accept —
// the fixture against the picker's own options, a colour against the six hex digits an
// `<input type="color">` takes — because a value's only judge is the control that has to wear it.

const params = new URLSearchParams(location.search);

/** what the address bar carries for `key`, unread and unchecked. */
export function remembered(key: string): string | null {
	return params.get(key);
}

/** `key` set to `value`, or dropped from the address entirely where the value is nothing. */
export function remember(key: string, value: string | null): void {
	if (value === null) params.delete(key);
	else params.set(key, value);
	const query = params.toString();
	history.replaceState(null, '', query.length === 0 ? location.pathname : `?${query}`);
}
