import type { PledgeMethod } from '../db/schema';

// what a donor quotes to their broker or custodian, and what staff match an arrival by:
// `CFCP-AAPL-7Q2D`, `CFCP-IRA-4K9M`. read aloud over the phone and typed into a transfer form, so
// it is short and uppercase, and its random suffix is drawn from characters that cannot be misread
// for one another; the initials and the ticker are spelled as they are.
//
// unique is the database's to hold (`pledge_reference_idx` in ../db/schema.ts): four characters
// from this alphabet are 923,521 references per ticker, and a collision is the saver's retry
// (`savePledge` in ./pledges.ts), never a check made here first.

/** digits and capitals less 0, 1, I, L and O, which read as each other. */
export const REFERENCE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

const SUFFIX_LENGTH = 4;
const MAX_INITIALS = 4;

/** words a legal name carries for the registrar rather than for whoever reads the reference. */
const COMPANY_SUFFIXES = new Set([
	'inc',
	'incorporated',
	'llc',
	'ltd',
	'limited',
	'corp',
	'corporation',
	'co',
	'pbc',
	'plc',
	'nfp'
]);

/**
 * the organisation's initials off its legal name: each word's first letter, accents folded, a
 * company suffix left out, at most four. `GIFT` where no word starts with a letter A to Z.
 */
export function orgInitials(legalName: string): string {
	const words = legalName
		.normalize('NFD')
		.replace(/\p{M}/gu, '')
		.toUpperCase()
		.split(/[^A-Z0-9]+/)
		.filter((word) => word !== '' && !COMPANY_SUFFIXES.has(word.toLowerCase()));
	const initials = words
		.map((word) => word[0] ?? '')
		.filter((letter) => /[A-Z]/.test(letter))
		.join('')
		.slice(0, MAX_INITIALS);
	return initials === '' ? 'GIFT' : initials;
}

/** what the reference names between the initials and the random part. */
export type ReferenceSubject =
	| { readonly method: Extract<PledgeMethod, 'stock'>; readonly ticker: string }
	| { readonly method: Extract<PledgeMethod, 'ira_qcd'> };

/** one fresh reference. each call draws again, which is what a retry after a collision needs. */
export function mintPledgeReference(initials: string, subject: ReferenceSubject): string {
	const middle = subject.method === 'stock' ? subject.ticker : 'IRA';
	return `${initials}-${middle}-${randomSuffix()}`;
}

/**
 * four characters, each uniform over the alphabet: a byte at or past the largest multiple of its
 * length is drawn again, since `byte % 31` would favour the first eight characters.
 */
function randomSuffix(): string {
	const size = REFERENCE_ALPHABET.length;
	const ceiling = 256 - (256 % size);
	let suffix = '';
	while (suffix.length < SUFFIX_LENGTH) {
		for (const byte of crypto.getRandomValues(new Uint8Array(SUFFIX_LENGTH))) {
			if (byte < ceiling && suffix.length < SUFFIX_LENGTH)
				suffix += REFERENCE_ALPHABET[byte % size];
		}
	}
	return suffix;
}
