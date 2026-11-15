// the employer a donor named, as the match pack and its reminder print it.
//
// it is free text a donor typed, and the write path is a public endpoint, so it may arrive as
// anything a request body can carry. react escapes it in the html arm; what is left to this file is
// its length and its line breaks, decided once so the two mails print one donor's employer the same.

/** the longest employer either mail prints, in characters. */
export const EMPLOYER_MAX = 200;

/**
 * the longest employer a subject line carries, in characters, before it is cut with an ellipsis,
 * so the pack's subject still reads whole in an inbox list.
 */
export const EMPLOYER_SUBJECT_MAX = 60;

/**
 * one line: every run of whitespace or control characters, CR and LF among them, is one space, and
 * the ends are trimmed.
 *
 * applied to a whole subject as well as to the employer in it: a line break in a subject is a
 * header the message was never meant to carry.
 */
export function singleLine(value: string): string {
	return value.replaceAll(/[\s\p{Cc}]+/gu, ' ').trim();
}

/** the employer on one line, at most `max` characters, cut with an ellipsis where it was longer. */
export function employerName(employer: string, max: number = EMPLOYER_MAX): string {
	// by code point, so a cut never splits a surrogate pair into a character nobody typed.
	const chars = Array.from(singleLine(employer));
	return chars.length <= max
		? chars.join('')
		: `${chars
				.slice(0, max - 1)
				.join('')
				.trimEnd()}…`;
}
