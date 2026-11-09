// the name a public note is signed with: the donor's first name and the first letter of their last
// name, "Maya R.", or "Anonymous" where they asked for it or gave no first name. a surname is never
// printed whole and nothing else about the donor is: the form's consent box promises the donor
// exactly this (packages/form/src/views.ts).

const ANONYMOUS = 'Anonymous';

const letters = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** `contact.first_name` and `contact.last_name` as stored, either null. */
export type NameParts = { readonly firstName: string | null; readonly lastName: string | null };

export function shownName({ firstName, lastName }: NameParts, anonymous: boolean): string {
	const first = firstName?.trim() ?? '';
	if (anonymous || first === '') return ANONYMOUS;
	// a grapheme rather than `[0]`, so an accented or astral letter is not cut in half.
	const [initial] = Array.from(letters.segment(lastName?.trim() ?? ''), (s) => s.segment);
	return initial === undefined ? first : `${first} ${initial.toLocaleUpperCase()}.`;
}
