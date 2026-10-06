import { EIN, einAsTyped } from '@better-giving/operator/console/org-rules';
import type { NonprofitLookup, NonprofitOrganisation } from '../api/types';
import type { IdentityField } from './org-form';

// when the Organisation details fold asks the IRS list about the number in its EIN box, and what it says
// and fills when the answer lands. ./org-fold.tsx hands this the box's text at every change, and
// the number the finder (./org-finder.tsx) locked in with the answer it was given, and draws what
// comes back; nothing here touches a document, so ./ein-lookup.spec.ts reads all of it.
//
// **the list's limits are the reason for every rule about when it is asked.** the API is for set-up
// and is not generous, so a number is asked about once it is whole, and only where it is not the
// one the deployment already holds or the one asked about last — never on the screen being drawn,
// never per keystroke. the binary remembers its answers for the run as well
// (`packages/console/internal/nonprofits`); this is what keeps the fold from asking it at all.
//
// **an answer never saves itself and never holds the save.** a found organisation's values go into
// the boxes for the operator to read and store with the fold's own Save, and every note below is
// said beside a box that still saves: a number the list does not know, or knows as revoked, is the
// operator's to store anyway.
//
// **a list that does not answer is a note and nothing more, and is remembered by nobody.** set-up
// never waits on the API, so a lookup that throws reads exactly as one that answered `unavailable`,
// and the same number typed again asks again — the binary forgets such an answer for the same
// reason.
//
// **a lookup never writes over the operator.** an answer fills a box only while it is empty, or
// still holds exactly what an earlier fill put there — a mission or an address typed before the
// number, or after it, stays as typed whatever the list says. the record of what the fills wrote is
// the watch's own, one per fold on the page, and nothing on the screen draws it. the one exception
// is a number locked in from the finder, which is the operator choosing an organisation: its name,
// city and state replace the ones standing, and every other box keeps this rule.
//
// **an answer landing while a profile save is out waits for the save.** the save's answer puts the
// boxes back at the profile it stored, which would take a fill made under it away unseen, and the
// number in the box is then the stored one, which is never asked about again. so the answer is held,
// note and fill, and lands by the same rule once the fold says the save is over and its boxes reset.

/** what a number not listed as eligible for tax-deductible gifts says under the box. */
export const NOT_DEDUCTIBLE = 'Not listed as eligible for tax-deductible gifts.';

/** what a number the list does not hold says under the box. */
export const NOT_LISTED = 'Not on the IRS list.';

/**
 * what a fill says to a reader, in the same region as the note: six boxes changing under a cursor
 * that did not move is otherwise news to nobody using one. drawn for a reader alone — a lock-in and a
 * found number fill the boxes with no words on the screen about it.
 */
export const FILLED = 'Filled from the IRS list.';

/** what the box says when the list could not be asked. */
export const LOOKUP_UNANSWERED = "Couldn't look this up. Fill in the details yourself.";

/** a day the binary hands over as `YYYY-MM-DD`, said in utc, where the day was written. */
const DAY_WORDS = new Intl.DateTimeFormat('en-US', {
	month: 'long',
	day: 'numeric',
	year: 'numeric',
	timeZone: 'UTC'
});

/** what a revoked and not reinstated organisation says under the box: `… revoked May 15, 2023.` */
export const revokedNote = (on: string): string =>
	`Tax-exempt status revoked ${DAY_WORDS.format(new Date(on))}.`;

/** an answer as the fold uses it: the one note it says, and the organisation where one was found. */
export type EinRead = { readonly note: string; readonly found: NonprofitOrganisation | null };

const UNANSWERED: EinRead = { note: LOOKUP_UNANSWERED, found: null };

/**
 * the one note an answer says. revoked outranks not deductible, because a revocation is why an
 * organisation drops off the deductible list and the date is the fact worth having.
 */
function read(answer: NonprofitLookup): EinRead {
	if (answer.state === 'unavailable') return UNANSWERED;
	if (answer.state === 'not_found') return { note: NOT_LISTED, found: null };
	const organisation = answer.organisation;
	const note =
		organisation.revokedOn !== ''
			? revokedNote(organisation.revokedOn)
			: organisation.deductible
				? ''
				: NOT_DEDUCTIBLE;
	return { note, found: organisation };
}

const digitsOf = (value: string): string => value.replace(/\D/g, '');

/** boxes holding a value, with every box the list holds nothing for left out. */
type Filled = Partial<Record<IdentityField, string>>;

const filled = (boxes: Filled): Filled =>
	Object.fromEntries(Object.entries(boxes).filter(([, value]) => value !== ''));

/**
 * what an empty Country box takes for an organisation the IRS list holds: the list is of US
 * organisations alone, and this is the spelling the box's own example writes (`ORG_FIELDS.country`
 * in ./org-fields.ts). the column is free text, so nothing else reads it.
 */
export const US_COUNTRY = 'United States';

/** the identity boxes as they stand, by name. */
export type HeldBoxes = Readonly<Partial<Record<IdentityField, string>>>;

/**
 * the boxes a found organisation puts a value in: its name, the address the list holds, the
 * country, and the mission its latest filing states. `wrote` is what earlier fills put in the boxes
 * and `now` the boxes as they stand as the answer lands: a box is filled only while it is empty or
 * still holds what a fill wrote there, so anything the operator typed is kept. the Country box is
 * filled only while it is empty. a field the list holds nothing for is left out, and the suite and
 * the EIN that was looked up are never a lookup's to write.
 */
export function foundBoxes(
	organisation: NonprofitOrganisation,
	wrote: HeldBoxes,
	now: HeldBoxes
): Filled {
	const offered: Filled = filled({
		legal_name: organisation.name,
		address_line1: organisation.address_line1,
		city: organisation.city,
		region: organisation.region,
		postal_code: organisation.postal_code,
		country: US_COUNTRY,
		mission: organisation.mission
	});
	const open = (field: IdentityField): boolean => {
		const standing = now[field] ?? '';
		return standing === '' || (field !== 'country' && standing === wrote[field]);
	};
	return Object.fromEntries(
		Object.entries(offered).filter(([field]) => open(field as IdentityField))
	);
}

/**
 * the boxes a lock-in takes whatever they hold: the finder's answer is a choice of organisation, so
 * its name and where it is listed replace the ones standing, and every other box is filled by
 * {@link foundBoxes}'s own rule.
 */
const CHOSEN: readonly IdentityField[] = ['legal_name', 'city', 'region'];

/** after as many digits as stood before `caret` in `typed`, as a place in `shown`. */
function caretAfter(typed: string, caret: number, shown: string): number {
	const before = digitsOf(typed.slice(0, caret)).length;
	if (before === 0) return 0;
	let seen = 0;
	for (let at = 0; at < shown.length; at += 1) {
		if (/\d/.test(shown.charAt(at))) seen += 1;
		if (seen === before) return at + 1;
	}
	return shown.length;
}

/**
 * the EIN box's text re-spelled as it is typed, and where the caret goes in it.
 *
 * the caret stands after as many digits as stood before it, so an edit in the middle of the number
 * stays where it was made. a deletion that took the dash alone — Delete just before it, Backspace
 * just after — takes the digit beyond the dash instead: the dash is put back by the spelling, so a
 * key that only removed it would be a key that never gets past it.
 */
export function einEdit(
	typed: string,
	caret: number,
	deleting: 'forward' | 'backward' | null
): { readonly shown: string; readonly caret: number } {
	const digits = digitsOf(typed);
	const tookTheDash = deleting !== null && caret === 2 && digits === typed && digits.length > 2;
	if (tookTheDash) {
		const gone = deleting === 'forward' ? 2 : 1;
		return { shown: einAsTyped(digits.slice(0, gone) + digits.slice(gone + 1)), caret: gone };
	}
	const shown = einAsTyped(typed);
	return { shown, caret: caretAfter(typed, caret, shown) };
}

/** what the region under the box holds: the note on the screen, and what a reader alone is told. */
export type EinNote = { readonly shown: string; readonly said: string };

/** the region with nothing in it. */
export const SILENT_NOTE: EinNote = { shown: '', said: '' };

/** what the fold hands the watch, once. */
export type EinWatchOptions = {
	readonly lookUp: (ein: string, signal: AbortSignal) => Promise<NonprofitLookup>;
	/** the identity boxes as they stand, read as an answer lands. */
	readonly held: () => HeldBoxes;
	/** the region under the box. said at every change of the box. */
	readonly onNote: (note: EinNote) => void;
	/**
	 * an organisation the list holds, with what earlier fills wrote: the fold puts
	 * `foundBoxes(organisation, wrote, held())`, which is the fill the watch records. answers whether
	 * any box took a value, which is what decides whether the fill is said.
	 */
	readonly onFound: (organisation: NonprofitOrganisation, wrote: HeldBoxes) => boolean;
};

export type EinWatch = {
	/** the box now holds `value`, and the deployment holds `stored`. */
	readonly typed: (value: string, stored: string) => void;
	/**
	 * the list's answer about `value`, asked with the finder's `signal`: the one this watch already
	 * holds for that number, or the list's. a lookup that throws reads as unanswered. it lands
	 * nothing — the fold locks the number in with it once the boxes are on the page.
	 */
	readonly ask: (value: string, signal: AbortSignal) => Promise<EinRead>;
	/**
	 * the finder locked `value` in with `answer`, or with none where this console cannot ask the
	 * list: said and filled as a choice of organisation ({@link CHOSEN}), and the box holding that
	 * number is one nothing asks about again until it changes.
	 */
	readonly lockIn: (value: string, answer: EinRead | null) => void;
	/** a profile save went out: an answer landing from now waits for {@link EinWatch.afterSave}. */
	readonly saving: () => void;
	/**
	 * the save is answered, and where it landed the boxes are reset to what it stored: an answer that
	 * waited lands now, against the boxes as they stand.
	 */
	readonly afterSave: () => void;
	/** gives up a lookup in flight, for a fold taken off the page. */
	readonly stop: () => void;
};

export function watchEin({ lookUp, held, onNote, onFound }: EinWatchOptions): EinWatch {
	let asking: { readonly digits: string; readonly control: AbortController } | null = null;
	let last: { readonly digits: string; readonly read: EinRead } | null = null;
	/** the whole number the box was last said to hold, so a call saying it again changes nothing. */
	let holding: string | null = null;
	/** what the fills so far put in the boxes, box by box. */
	let wrote: Filled = {};
	let saveOut = false;
	/** an answer that landed while a save was out. */
	let waiting: { readonly answer: EinRead; readonly chosen: boolean } | null = null;

	/**
	 * a found organisation put into the boxes, and the record kept of it. a choice of organisation
	 * reads {@link CHOSEN} as an earlier fill's, so the found values replace whatever stands there.
	 */
	const fill = (found: NonprofitOrganisation, chosen: boolean): boolean => {
		const now = held();
		const before: Filled = chosen
			? { ...wrote, ...Object.fromEntries(CHOSEN.map((field) => [field, now[field] ?? ''])) }
			: wrote;
		const boxes = foundBoxes(found, before, now);
		const took = onFound(found, before);
		if (took) wrote = { ...wrote, ...boxes };
		return took;
	};

	/** the note an answer says, and the fill it is said beside where one was made. */
	const land = (answer: EinRead, chosen: boolean) => {
		if (saveOut) {
			waiting = { answer, chosen };
			return;
		}
		const filledAny = answer.found !== null && fill(answer.found, chosen);
		onNote({ shown: answer.note, said: filledAny ? FILLED : '' });
	};

	const typed = (value: string, stored: string) => {
		const digits = EIN.test(value) ? digitsOf(value) : null;
		const unchanged = digits !== null && digits === holding;
		holding = digits;
		if (unchanged) return;
		// an answer about a number the box no longer holds is one nothing would be told about.
		if (asking !== null && asking.digits !== digits) {
			asking.control.abort();
			asking = null;
		}
		if (digits === null || digits === digitsOf(stored)) {
			onNote(SILENT_NOTE);
			return;
		}
		if (asking !== null) return;
		if (last?.digits === digits) {
			onNote({ shown: last.read.note, said: '' });
			return;
		}
		onNote(SILENT_NOTE);
		const control = new AbortController();
		asking = { digits, control };
		lookUp(value, control.signal)
			.then(read, () => UNANSWERED)
			.then((answer) => {
				if (control.signal.aborted) return;
				asking = null;
				if (answer !== UNANSWERED) last = { digits, read: answer };
				land(answer, false);
			});
	};

	const ask = (value: string, signal: AbortSignal): Promise<EinRead> =>
		last?.digits === digitsOf(value)
			? Promise.resolve(last.read)
			: lookUp(value, signal).then(read, () => UNANSWERED);

	const lockIn = (value: string, answer: EinRead | null) => {
		asking?.control.abort();
		asking = null;
		const digits = digitsOf(value);
		holding = digits;
		if (answer === null) {
			onNote(SILENT_NOTE);
			return;
		}
		if (answer !== UNANSWERED) last = { digits, read: answer };
		land(answer, true);
	};

	return {
		typed,
		ask,
		lockIn,
		saving: () => {
			saveOut = true;
		},
		afterSave: () => {
			saveOut = false;
			const landed = waiting;
			waiting = null;
			if (landed !== null) land(landed.answer, landed.chosen);
		},
		stop: () => {
			asking?.control.abort();
			asking = null;
		}
	};
}
