import type { ReactElement } from 'react';

// the one shape every template in this package exports, so a caller that can send one can send
// all of them.
//
// a value rather than a function taking a transport: a template decides what a message says and
// nothing else — no recipient, no headers, no send. ./render.ts turns one into strings and the
// app's email port turns those into a message with somewhere to go.

export interface EmailTemplate {
	readonly subject: string;
	/** the html arm, as jsx. rendered by ./render.ts, never by a template itself. */
	readonly node: ReactElement;
	/**
	 * the plain-text arm, where a template has decided how it reads.
	 *
	 * optional, and the option is the point: most messages say the same thing in text that a
	 * stripper would produce from their markup, and one whose text layout is deliberate — a ruled
	 * block, labels padded into a column — does not. a template that hands one is claiming the
	 * second case; ./render.ts strips the node for every template that does not.
	 */
	readonly text?: string;
}
