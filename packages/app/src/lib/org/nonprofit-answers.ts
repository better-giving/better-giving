// what Settings' finder is answered with by its two reads,
// ../../routes/_app.admin.settings_.nonprofits.ts and ../../routes/_app.admin.settings_.nonprofits_.$ein.ts,
// which ask Better Giving's nonprofit lookup from the server ($lib/server/org/nonprofits.ts).
//
// not under `$lib/server/**`, so the screen that draws the answers may name these types. it holds
// no words: what each outcome says is the screen's.
//
// **the service's refusals are answers, each a 200 with an `outcome`.** the finder never
// holds the organisation form, which saves without it, so a lookup that could not be made is a
// state to draw beside the boxes rather than an error for a boundary.

/** the Settings boxes a found organisation fills, by the details form's own names. */
export type NonprofitFields = {
	readonly legal_name: string;
	/** the EIN as it is stored, `XX-XXXXXXX`. */
	readonly tax_id: string;
	readonly address_line1: string;
	readonly city: string;
	readonly region: string;
	readonly postal_code: string;
	/** `United States` for every organisation found: the IRS files list US organisations alone. */
	readonly country: string;
};

/**
 * what the IRS files say of an organisation's standing.
 *
 * `deductible` is `true` where IRS Publication 78 lists it, `false` where that list is imported
 * and does not, and `null` where it is not known. `revoked` is whether its tax exemption is revoked
 * and not reinstated since, `null` where that is not known. `revocationDate` is `YYYY-MM-DD`, or
 * `null` where the revocation list holds no date; an organisation reinstated since still carries
 * it beside a `revoked` of `false`.
 */
export type NonprofitStanding = {
	readonly deductible: boolean | null;
	readonly revoked: boolean | null;
	readonly revocationDate: string | null;
};

/**
 * the service turned the call away for its rate limit, and is asked again after `retryAfter`
 * seconds: a minute keyless, or until UTC midnight once the day's allowance is spent.
 */
export type NonprofitsRateLimited = {
	readonly outcome: 'rate_limited';
	readonly retryAfter: number;
};

/** the service did not answer, refused for any reason but those above, or answered unreadably. */
export type NonprofitsUnavailable = { readonly outcome: 'unavailable' };

/** one organisation, looked up by EIN. */
export type NonprofitLookupAnswer = { readonly kind: 'lookup' } & (
	| ({ readonly outcome: 'found'; readonly fields: NonprofitFields } & NonprofitStanding)
	/** no organisation with that EIN in the IRS files. */
	| { readonly outcome: 'not_found' }
	| NonprofitsRateLimited
	| NonprofitsUnavailable
);

/** one organisation a name search listed; `ein` is in the stored spelling, `XX-XXXXXXX`. */
export type NonprofitMatch = {
	readonly ein: string;
	readonly name: string;
	readonly city: string;
	readonly state: string;
} & NonprofitStanding;

/** a name search: the service's matches, best first, which may be none. */
export type NonprofitSearchAnswer = { readonly kind: 'search' } & (
	| { readonly outcome: 'found'; readonly matches: readonly NonprofitMatch[] }
	| NonprofitsRateLimited
	| NonprofitsUnavailable
);
