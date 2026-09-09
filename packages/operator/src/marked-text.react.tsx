import { codeSpans } from './code-spans';
import { InlineCode } from './components/data/CodeSlab.jsx';

// the react binding of ./code-spans.ts: the one piece of markup an operator surface reads out of a
// string, drawn.
//
// ./code-spans.ts is the split and states the whole rule: paired backticks mark a command, a
// variable name or a value a machine would print, and everything else is prose. this is the
// rendering of it, and it is a component rather than a call at each site because every screen that
// prints one of those sentences has to draw the marks the same way — a message printed raw shows an
// operator a pair of backticks, and the strings interpolate values somebody typed, so nothing here
// may reach a screen through an html render.
//
// it is here rather than beside one of its callers because both operator surfaces print those
// sentences. the dashboard draws the parsers' field messages
// (`./origins.ts`, `packages/app/src/lib/forms/input-schema.ts`) and the
// readiness block's consequence lines (`packages/app/src/lib/server/forms/readiness.ts`); the
// console draws the deployment's own refusals off the wire, along with the report a test send
// comes back with.
//
// it is not one of the ports in ./components/**: what this takes is a string only a running
// deployment produces, never the literal jsx a screen composes a port from, so it holds no place
// in a tree of components meant to be assembled that way. the mark it draws is `InlineCode`, which
// is a port and is offered there.
//
// the file is named for what it draws rather than for the split it draws, because ./code-spans.ts
// already holds that name and two modules cannot.

type MarkedTextProps = {
	/** the sentence as its author wrote it, marks and all. */
	readonly text: string;
};

export function MarkedText({ text }: MarkedTextProps) {
	return (
		<>
			{codeSpans(text).map((span, index) =>
				// the segments are a split of one string and carry no identity of their own, so the
				// position is the key: two runs of identical text are two runs.
				span.code ? (
					<InlineCode key={index}>{span.text}</InlineCode>
				) : (
					<span key={index}>{span.text}</span>
				)
			)}
		</>
	);
}
