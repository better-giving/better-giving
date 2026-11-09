// the name a public note is signed with: the donor's first name and the first letter of their last
// name, "Maya R.", or "Anonymous" where they asked for it or gave no first name. a surname is never
// printed whole and nothing else about the donor is: the form's consent box promises the donor
// exactly this (packages/form/src/views.ts). the last name is optional on some forms, so a donor may
// type a whole name into the first-name box: only its first word is printed, and where no last name
// was given the rest of that box gives the initial.

const ANONYMOUS = 'Anonymous';

const letters = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** the first and last name a donor typed on one gift's submission, either null. */
export type NameParts = { readonly firstName: string | null; readonly lastName: string | null };

export function shownName({ firstName, lastName }: NameParts, anonymous: boolean): string {
	const [first = '', ...rest] = firstName?.trim().split(/\s+/) ?? [];
	if (anonymous || first === '') return ANONYMOUS;
	const surname = lastName?.trim() || rest.join(' ');
	// a grapheme rather than `[0]`, so an accented or astral letter is not cut in half.
	const [initial] = Array.from(letters.segment(surname), (s) => s.segment);
	return initial === undefined ? first : `${first} ${initial.toLocaleUpperCase()}.`;
}
