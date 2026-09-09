import { readOriginRows } from '@better-giving/operator/origins';
import { z } from 'zod';
import type { StatedForm } from './use-console-form';

// the site list as the panel holds it: the group the boxes stand in, the name each row submits
// under, the rules the fold marks them by, what the press posts as its intent, and the list the
// boxes are seeded from.
//
// **the boxes and the rules they are read against are one module, and nothing about a credential is
// in it.** the panel draws the rows, the schema below marks them, and the binary posts them to the
// deployment over the session it holds (`packages/console/internal/deployment/sites.go`) — so the
// vocabulary is stated once, on the side a component can import.
//
// **one press, and it costs seconds.** saving the list posts to a deployment that is already
// running and levels the turnstile widget behind it (`packages/console/internal/widget`); nothing is
// republished and no one-way door is gone through.
//
// **adding and dropping a row are not that press.** they are the form's own list intents, applied
// in the browser by conform and posted nowhere (./use-console-form.ts) — so the boxes are the
// operator's to arrange, and only Save sites leaves this machine.
//
// **the rules are not stated here and are `@better-giving/operator/origins`'s.** that module is
// where both surfaces read them from and its header argues why a copy is the thing that must not
// happen: one end reading `acme.org` as `https://acme.org` and the other refusing the list is a
// setup run that dies after doing work nobody can take back. what this file adds is the shape
// conform reads them through — which sentence is keyed to which box.
//
// **the deployment's parse stays the authority.** `/console/sites` is reachable by anything holding
// a console session, so the worker parses every list it is sent whatever asked it to; the fold
// marking a box first is a courtesy to the person typing.
//
// **the one rule stated here rather than read from that module is that a box must hold something.**
// every box a form states must arrive (CLAUDE.md → Bans → Forms), and this is that rule over a row:
// a blank is refused under its own box and means nothing else. it is not a rule about what a site
// may be — the deployment drops a blank row rather than reading one, which is why it is stated on
// this form and not in the module both ends share. what empties the list is every row being
// dropped, which posts no box at all.
//
// **the press is read for whether the boxes differ from the seed they were drawn with**, which is
// the form layer's own reading and no rule of this module's (./use-console-form.ts), and every
// answer it may get is the same one: post the boxes. an operator moving domains means to empty the
// list, the worker stores an empty one, and a console refusing it would be turning down a value the
// worker accepts.

/** the list field every row of the boxes belongs to, and the name each row is indexed under. */
export const SITE_FIELD = 'site';

/**
 * the group the rows are drawn in, which is also the form's own id.
 *
 * every box id on the fold is composed off it by the seam (./use-console-form.ts), so `sites` is
 * the prefix a row's box is found by and the name the group's own message is drawn under.
 */
export const SITES_BOX = 'sites';

/** what the press that stores the list posts, which is the submitting button's own value. */
export const SITES_INTENT = 'sites';

/**
 * one box of the list as the form layer reads it, which is the one place an empty box is a value.
 *
 * conform drops every empty string before the schema sees it (`parseWithZod` in
 * `@conform-to/zod/v4`), so a bare `z.string()` would answer a row nobody has typed into with
 * "expected string, received undefined" — a refusal over the box the fold opens on. `.optional()`
 * is what lets that row through to the rule below, which is where a blank is dropped rather than
 * marked. ./org-form.ts's `identityBox` states the same reading for a box that stands alone.
 */
const siteRow = z.string().optional();

/**
 * the sentence a box holding nothing gets, and it is one word: the box it is drawn under is
 * labelled by the group it stands in, so a sentence naming the field again is the label spelled
 * twice under itself.
 */
const REQUIRED = 'required';

const sitesBoxes = z.object({
	/**
	 * the rows read as one list, because two of the things that can be wrong with them are facts
	 * about the list rather than about a row: how many there are, and a site named in a box above. a
	 * rule mounted on the row could see neither.
	 *
	 * every sentence is keyed to the box it is about, which is what a path under this field does:
	 * conform spells `['site', 1]` as `site[1]`, the second row's own input, and the fold draws it
	 * under that box. the one sentence keyed to the bare field is the cap on how many sites there
	 * may be, which is a fact about no one row — and because it is keyed to a name no control on the
	 * form carries, it is the one message conform's submit-time focus move cannot reach, which is
	 * why the fold draws it at the button rather than over the boxes (./sites-fold.tsx).
	 *
	 * **a blank row is marked here and nowhere else.** `readOriginRows` hands one back unmarked —
	 * a blank is not a site, so the module both surfaces read has nothing to say about it — and this
	 * form refuses it, so the row is marked before that reading is taken.
	 */
	[SITE_FIELD]: z.array(siteRow).superRefine((rows, ctx) => {
		// the empty string a blank box stood for, put back for the reader: conform drops every empty
		// string before the schema sees it, and this is the shape `readOriginRows` reads.
		const lines = rows.map((row) => row ?? '');
		lines.forEach((line, at) => {
			if (line.trim().length > 0) return;
			ctx.addIssue({ code: 'custom', message: REQUIRED, path: [at] });
		});

		const read = readOriginRows(lines);
		if (read.problem !== null) {
			ctx.addIssue({ code: 'custom', message: read.problem });
			return;
		}
		read.rows.forEach((problem, at) => {
			if (problem === null) return;
			ctx.addIssue({ code: 'custom', message: problem, path: [at] });
		});
	})
});

/** the sites fold's form: what its `<Form>` is called, and the rules its press runs first. */
export const SITES_FORM: StatedForm<typeof sitesBoxes> = {
	id: SITES_BOX,
	schema: sitesBoxes
};

/**
 * the boxes the fold opens on, which is the list the deployment holds and nothing else.
 *
 * stated here rather than in the fold because the button's reading is taken against it: what counts
 * as an edit is a box differing from the one it was drawn with, and a seed spelled twice is a fold
 * whose button and whose boxes disagree about what the operator has done.
 *
 * **a deployment holding no site opens on no box at all**, because the group is never empty: the
 * locked row is drawn above these and the fold reads as one row and an Add. a blank box seeded over
 * it would be a row nobody added, offering a Remove for nothing and refusing itself the moment the
 * press was reached. the locked row is the fold's and is in no list here: it posts nothing
 * (./sites-fold.tsx).
 */
export function siteSeed(stored: readonly string[]): string[] {
	return [...stored];
}

/** the name one row's box submits under, which is the list field indexed by the row's position. */
const ROW_NAME = new RegExp(`^${SITE_FIELD}\\[\\d+\\]$`);

/**
 * whether a control on this form is one of the list's rows, by the name it submits under.
 *
 * the one spelling of that name, read by the fold off its own boxes and here off what they posted.
 * the locked row is in neither: it carries no name at all
 * (`fixed` in `@better-giving/operator/components/forms/RepeatingRows`).
 */
export const isSiteRow = (name: string): boolean => ROW_NAME.test(name);

/**
 * what the boxes hold, in the order they are on screen.
 *
 * nothing is trimmed, nothing is dropped and nothing is refused. an empty row is kept because it is
 * a box an operator is still typing into, and what a row may hold is answered at the box rather
 * than here.
 *
 * the rows are a list field, so each box submits under its own position — `site[0]`, `site[1]` —
 * rather than every one of them under a bare `site`. the order is the boxes' own: a form's entries
 * arrive in the order the controls stand in the document.
 */
export function siteEdits(posted: FormData): string[] {
	return [...posted]
		.filter(([name]) => isSiteRow(name))
		.map(([, row]) => (typeof row === 'string' ? row : ''));
}
