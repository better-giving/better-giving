import { z } from 'zod';

// the words a refusal names a closed set's off-list value in, for the page rule (./catalog.ts), a
// chat reply's `set` (./accept-reply.ts) and what the model is told of a set
// ($lib/server/pages/draft.ts), so each says it the same way.
//
// pure and not under `$lib/server/**`, beside the rules that read it.

/** a name from `names`, refused as `"x" is not <what>; <offered> a, b or c`. */
export function oneOf<const T extends readonly [string, ...string[]]>(
	names: T,
	what: string,
	offered: string
) {
	return z.enum(names, {
		error: (issue) => `${shown(issue.input)} is not ${what}; ${offered} ${listed(names, 'or')}`
	});
}

/** `a, b and c`, or `a, b or c`. */
export function listed(names: readonly string[], joiner: 'and' | 'or' = 'and') {
	return names.length < 2
		? names.join('')
		: `${names.slice(0, -1).join(', ')} ${joiner} ${names.at(-1)}`;
}

function shown(input: unknown) {
	return input === undefined ? 'nothing' : JSON.stringify(input);
}
