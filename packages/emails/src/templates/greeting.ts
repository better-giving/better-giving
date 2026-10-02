// the line every mail to a donor opens with, so the receipt and the mails about the same gift
// cannot greet one donor two ways.

/**
 * the opening line: the donor's first name, or a neutral greeting where there is no name.
 * `null` prints "Hello," rather than "Dear null,".
 */
export function greetingFor(donorName: string | null): string {
	return donorName === null ? 'Hello,' : `Dear ${firstName(donorName)},`;
}

/**
 * how the greeting addresses somebody, from a name that has no parts.
 *
 * `donorName` is one string a donor typed or a form derived, which the caller only proves is not
 * blank — it may arrive untrimmed and it carries no first-or-family structure to read. so the
 * first whitespace-delimited token is the whole heuristic, and it is wrong in the ways an
 * unstructured name is wrong: a name written family-name-first is greeted by the family name, and
 * one carrying a particle is greeted by the particle.
 *
 * that is a greeting and not the record. the full name is on the receipt's `Donor` row, which is
 * the line the document is read from.
 */
function firstName(donorName: string): string {
	const trimmed = donorName.trim();
	const space = trimmed.search(/\s/);
	return space === -1 ? trimmed : trimmed.slice(0, space);
}
