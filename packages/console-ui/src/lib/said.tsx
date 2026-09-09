import { MarkedText } from '@better-giving/operator/marked-text.react';
import type { ReactNode } from 'react';

// what a machine said about a failure, quoted rather than retold.
//
// one renderer for all three of them — the deployment, cloudflare's tools, Stripe — because what is
// being decided is not whose words they are but that they are somebody else's: a screen that
// retold them would be this console's account of a failure it did not have, and three copies of
// the decision are three places for it to drift.
//
// **the detail is printed and never marked.** it is a machine's own words, so a backtick in it is
// a character that machine wrote rather than a mark asking for a value to be drawn as code —
// running it through `MarkedText` would silently eat characters out of the one thing on screen an
// operator is meant to read exactly.
//
// **the way out is marked, because it is a sentence written for a reader.** a deployment marks the
// variable name and the command in it with paired backticks, and
// printed raw it shows an operator the marks. it stands under the quotation because it is what to
// do about it, which is the order ../routes/organisation.tsx draws a refusal's two sentences in.
//
// it stays in this package rather than moving to packages/operator: one operator surface draws
// these, and a module arrives in that package by a second surface needing it (CLAUDE.md).

/**
 * what was said, verbatim, under the sentence saying who said it.
 *
 * `fix` is optional rather than absent-or-null, so an answer with no way out — every cloudflare
 * answer and every Stripe refusal — is handed over whole rather than picked apart at the call.
 */
export function Said({ answer }: { answer: { detail: string; fix?: string | null } }): ReactNode {
	return (
		<>
			<div className="adm-cmd adm-cmd--oneline">
				<code>{answer.detail}</code>
			</div>
			{answer.fix ? (
				<p className="adm-prose">
					<MarkedText text={answer.fix} />
				</p>
			) : null}
		</>
	);
}
