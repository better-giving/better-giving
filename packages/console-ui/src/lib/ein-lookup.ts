import { EIN, einAsPrinted } from '@better-giving/operator/console/org-rules';
import type { NonprofitLookup, NonprofitMatch, NonprofitOrganisation } from '../api/types';
import type { IdentityField } from './org-form';

// when the Legal details fold asks the IRS list about the number in its EIN box, and what it says
// and fills when the answer lands. ./org-fold.tsx hands this the box's text at every change and
// draws what comes back; nothing here touches a document, so ./ein-lookup.spec.ts reads all of it.
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
// **a list that does not answer is a note and nothing more.** set-up never waits on the API, which
// is not built yet and is unavailable on every console today, so a lookup that throws reads exactly
// as one that answered `unavailable`.

/** what a number not listed as eligible for tax-deductible gifts says under the box. */
export const NOT_DEDUCTIBLE = 'Not listed as eligible for tax-deductible gifts.';

/** what a number the list does not hold says under the box. */
export const NOT_LISTED = 'Not on the IRS list.';

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
type Read = { readonly note: string; readonly found: NonprofitOrganisation | null };

const UNANSWERED: Read = { note: LOOKUP_UNANSWERED, found: null };

/**
 * the one note an answer says. revoked outranks not deductible, because a revocation is why an
 * organisation drops off the deductible list and the date is the fact worth having.
 */
function read(answer: NonprofitLookup): Read {
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

/** the country an answer puts in the box: the list's own where the box is empty, else nothing. */
const countryFor = (held: string): Filled => (held === '' ? { country: US_COUNTRY } : {});

/**
 * the boxes a found organisation puts a value in: its name, the address the list holds, and the
 * country where the Country box — `country`, as it stands — is empty. a field the list holds
 * nothing for is left out, so a box the operator already filled keeps what they typed — and the
 * suite and the EIN that was looked up are never a lookup's to write.
 */
export const foundBoxes = (organisation: NonprofitOrganisation, country: string): Filled =>
	filled({
		legal_name: organisation.name,
		address_line1: organisation.address_line1,
		city: organisation.city,
		region: organisation.region,
		postal_code: organisation.postal_code,
		...countryFor(country)
	});

/**
 * the boxes a match taken from the find dialog fills before its whole record is in: its number,
 * its name, the city and state it is listed under, and the country where the Country box is
 * empty. the street and the postal code are not in a match, so the lookup a pick runs is what
 * brings them.
 */
export const matchBoxes = (match: NonprofitMatch, country: string): Filled =>
	filled({
		tax_id: einAsPrinted(match.ein),
		legal_name: match.name,
		city: match.city,
		region: match.state,
		...countryFor(country)
	});

/**
 * where the caret goes once the EIN box's text `typed`, with the caret at `caret`, is re-spelled
 * `shown`: after as many digits as stood before it. the dash and anything dropped move, so the
 * digits are what the operator was typing between.
 */
export function einCaret(typed: string, caret: number, shown: string): number {
	const before = digitsOf(typed.slice(0, caret)).length;
	if (before === 0) return 0;
	let seen = 0;
	for (let at = 0; at < shown.length; at += 1) {
		if (/\d/.test(shown.charAt(at))) seen += 1;
		if (seen === before) return at + 1;
	}
	return shown.length;
}

/** what the fold hands the watch, once. */
export type EinWatchOptions = {
	readonly lookUp: (ein: string, signal: AbortSignal) => Promise<NonprofitLookup>;
	/** the note under the box, `''` where there is none. said at every change of the box. */
	readonly onNote: (note: string) => void;
	/** an organisation the list holds, whose values go into the boxes. */
	readonly onFound: (organisation: NonprofitOrganisation) => void;
};

export type EinWatch = {
	/**
	 * the box now holds `value`, and the deployment holds `stored`. `picked` is a match taken from
	 * the find dialog, which wants the organisation's whole record whatever is stored.
	 */
	readonly typed: (value: string, stored: string, picked?: boolean) => void;
	/** gives up a lookup in flight, for a fold taken off the page. */
	readonly stop: () => void;
};

export function watchEin({ lookUp, onNote, onFound }: EinWatchOptions): EinWatch {
	let asking: { readonly digits: string; readonly control: AbortController } | null = null;
	let last: { readonly digits: string; readonly read: Read } | null = null;

	const typed = (value: string, stored: string, picked = false) => {
		const digits = EIN.test(value) ? digitsOf(value) : null;
		// an answer about a number the box no longer holds is one nothing would be told about.
		if (asking !== null && asking.digits !== digits) {
			asking.control.abort();
			asking = null;
		}
		if (digits === null || (!picked && digits === digitsOf(stored))) {
			onNote('');
			return;
		}
		if (asking !== null) return;
		if (last?.digits === digits) {
			onNote(last.read.note);
			if (picked && last.read.found !== null) onFound(last.read.found);
			return;
		}
		onNote('');
		const control = new AbortController();
		asking = { digits, control };
		lookUp(value, control.signal)
			.then(read, () => UNANSWERED)
			.then((answer) => {
				if (control.signal.aborted) return;
				asking = null;
				last = { digits, read: answer };
				onNote(answer.note);
				if (answer.found !== null) onFound(answer.found);
			});
	};

	return {
		typed,
		stop: () => {
			asking?.control.abort();
			asking = null;
		}
	};
}
