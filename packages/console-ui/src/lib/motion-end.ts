// how long a screen holds on for a transition or an animation it has to see the end of.
//
// **no duration is written here, and none may be.** every one of them is
// packages/operator/src/styles/tokens.css's, spent by the rules in that package's adm.css, and a
// number copied into typescript is a second place to re-point a step — one that no sheet is read
// against and nothing here would notice going stale. what a caller does instead is read the
// duration off the element it is waiting on, through `getComputedStyle`, and hand it here.
//
// the wait is a backstop and not the mechanism: what says a piece of motion ended is the
// `animationend` of `adm-dwell`, the beat a finished bar is seen for, and this is what stops a
// screen hanging where that event cannot arrive — a bar that was never drawn, or a keyframe list a
// browser declined to run.

/**
 * the longest a screen is held for motion nothing can measure.
 *
 * it is spent where the computed duration is unreadable, which is the case where an event that
 * never comes would otherwise hold a face for ever. long enough that no real duration in this
 * system reaches it, short enough that an operator meeting it reads a pause rather than a stall.
 */
export const MOTION_CAP_MS = 2000;

/** a frame or two past the duration, so the wait is a backstop to the event rather than a race. */
const GRACE_MS = 50;

/**
 * the last entry of a computed time list, in milliseconds, or `NaN` where it cannot be read.
 *
 * a computed `animation-duration` or `animation-delay` is a list, one entry per animation name, in
 * the order the shorthand declared them. the last is the one taken: the rules waited on here run
 * their hold last (packages/operator/src/styles/adm.css), so the entry that ends the run is the
 * entry at the end of the list.
 */
function lastMs(list: string): number {
	const parts = list.split(',');
	const time = parts[parts.length - 1]?.trim() ?? '';
	return time.endsWith('ms')
		? Number(time.slice(0, -2))
		: time.endsWith('s')
			? Number(time.slice(0, -1)) * 1000
			: Number.NaN;
}

/**
 * how long to wait on a css animation before giving up on the `animationend` that would end it.
 *
 * `duration` and `delay` are that element's computed `animation-duration` and `animation-delay`,
 * read together so the wait covers the whole run: the hold each caller waits on is delayed by the
 * move in front of it, so the duration alone would be a screen replaced part way through the beat
 * it is holding for.
 */
export function endsWithin(duration: string, delay: string): number {
	const ms = lastMs(duration) + lastMs(delay);
	return Number.isFinite(ms) && ms >= 0 ? ms + GRACE_MS : MOTION_CAP_MS;
}
