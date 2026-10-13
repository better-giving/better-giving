import { hostOf, readOriginRows } from '@better-giving/operator/origins';

// the website the IRS list holds for the organisation the Organisation details fold last found, kept for
// the console's run so the Sites fold (./sites-fold.tsx) can offer it as the first site.
//
// **it is a memory of this process and nothing stores it.** the two folds are on different pages
// and share no reading, and the website is a suggestion rather than a fact about the deployment, so
// it lives here and is gone when the console closes — the list is asked again on the next run only
// if the operator looks a number up again.
//
// **every found organisation replaces it, a found one with no website included**, so the site
// offered is always the organisation the boxes were last filled from.
//
// **only a website the site list would take is kept.** a filing's website line is free text and
// commonly `N/A` or `NONE`, which read as an address name the one-letter host `n`; so what is kept
// is what the Sites fold's own rule (`readOriginRows` in `@better-giving/operator/origins`) takes as
// a row, with a dot in its host — anything else is no website at all.

let host = '';

/** the website a found organisation lists, as the list wrote it: with or without its scheme. */
export function rememberWebsite(website: string): void {
	const address = website.trim();
	const named = hostOf(address.includes('://') ? address : `https://${address}`) ?? '';
	const taken = readOriginRows([address]).rows[0] === null;
	host = taken && named.includes('.') ? named : '';
}

/** the host of the website last found, `''` where none was. */
export const foundSite = (): string => host;
