import type { MailFromFault } from '@better-giving/operator/console/mail-from';
import { mailFromFault } from '@better-giving/operator/console/mail-from';
import { EMAIL, MAX_EMAIL } from '@better-giving/operator/console/org-rules';
import type { SavedFormState } from '@better-giving/operator/saved-form-state.react';
import { z } from 'zod';
import type { SecretGroup } from './secret-groups';
import { VALUE_FIELD, pressedNames } from './secret-groups';
import type { StatedForm } from './use-console-form';

// what closes a control on ./smtp-fold.tsx and what its press draws, as values rather than as
// expressions inside the fold — ../../vite.config.ts pins one node pool and no dom, so a rule about
// that fold is holdable here and nowhere else in this package.
//
// **a block is closed by its own press and by no other.** the fold has two, and they write in two
// places over two doors: the credentials go into cloudflare
// (`packages/console/internal/deployment/write.go`) and the test send goes to the deployment over
// its own mail transport (../api/client.ts's `sendTestEmail`). neither reads what the other left,
// so neither has anything to wait for. one reading of "the page is writing" across both greys five
// credential boxes while a message is on its way to somebody's inbox, which is a fold that stops
// taking edits for a press that cannot touch them.
//
// nothing is lost by decoupling them: `useSavedFormState`
// (packages/operator/src/saved-form-state.react.ts) empties a form only when that form's own write
// landed, so a press in the other block never takes away what the operator typed.
//
// what is also here is each form's own rules, as the schema its press runs first — the five
// credential boxes' ({@link mailForm}) and the destination's ({@link testSendForm}). they are
// readings of the same boxes the readings above are about, and they are the same shape: pure
// functions of what the boxes hold and what they were drawn with, with nothing about a network or
// an element in them.

/**
 * whether the press in flight is this block's own, which is the whole of what closes a block.
 *
 * it is what a box states `disabled` on (../closed-while-writing.spec.ts is the gate that every box
 * states one), and it is both of the flags the credentials form hands the seam
 * (./use-console-form.ts) — the save-state half underneath it reads a press through `busy` and
 * `pending` and nothing else (packages/operator/src/saved-form-state.react.ts), so handing it this
 * twice is what leaves its button drawing off its own boxes while the other block is writing.
 */
export const ownPress = (pending: string | null, intent: string): boolean => pending === intent;

/**
 * whether the deployment holds nothing for a message to leave through.
 *
 * read off the same seeds the boxes above the press are drawn from, which is what keeps the press
 * and the boxes saying one thing: a name with no seed is a name nothing is stored under, and a
 * press drawn off anything else would stand open under an empty box.
 *
 * **any one of the four, not all four.** the deployment cannot send without each of them
 * (`parseSmtpEndpoint` and `parseMailFrom` in `packages/app/src/lib/server/email/smtp-config.ts`,
 * and `MAIL_SMTP_VARS` is the same list its own set-up reading takes), so a name missing is a press
 * that can only fail.
 *
 * **`null` closes nothing**: it is a deployment this console could not read off cloudflare, so what
 * is unknown is whether mail is set up at all — and a read that did not land gates nothing
 * (CLAUDE.md).
 *
 * a name the deployment holds in a form nothing can read back has no seed and reads here as unset,
 * which is the press closed over a deployment that can in fact send. the fold draws that state at
 * the box it is about and the way out of it is the same press either way (./withheld-values.tsx).
 */
export const mailUnconfigured = (names: readonly string[], seeds: MailSeeds | null): boolean =>
	seeds !== null && names.some((name) => mailSeed(seeds, name) === '');

/**
 * the five boxes in the order they are filled, which is not the order they are enumerated in.
 *
 * ./secret-groups.ts keeps the group in `DEPLOY_VARS` order so that a name added to the
 * enumeration lands in a group without two lists drifting, and that order is the split's rather
 * than anybody's reading order. an operator arrives holding a page from their mail provider: the
 * credential it issued them first, then where to dial it, then who the mail says it is from.
 *
 * a name in the group with no place here draws last rather than not at all, so a credential added
 * to the mail group is a box out of order rather than a box nobody notices is missing.
 *
 * it is the order the boxes are drawn in and the order {@link mailForm} names them in, which are
 * one order rather than two: conform moves the operator to the first box it holds an issue for by
 * walking the form's own elements (./use-console-form.ts), so a schema naming them in any other
 * order would put the first sentence somewhere other than where focus lands.
 */
export const MAIL_ORDER: readonly string[] = [
	'SMTP_USERNAME',
	'SMTP_PASSWORD',
	'SMTP_HOST',
	'SMTP_PORT',
	'MAIL_FROM'
];

export const filled = (names: readonly string[]): readonly string[] => {
	const rank = (name: string) => {
		const at = MAIL_ORDER.indexOf(name);
		return at === -1 ? MAIL_ORDER.length : at;
	};
	return [...names].sort((one, other) => rank(one) - rank(other));
};

/**
 * what the boxes of the credentials form were drawn from, which every reading below is against.
 *
 * one value per name, off cloudflare's own answer: each of the five is a plain var and hands its
 * value back (`heldValues` in ./held-values.ts), so a box is drawn holding what the deployment
 * holds and the reading of an emptied one has nothing to derive. a name with no entry, and a name
 * held in a form nothing can read back, are both drawn empty.
 */
export type MailSeeds = Readonly<Record<string, string>>;

/** what a box holds before anybody touches it: the stored value, or nothing at all. */
export const mailSeed = (seeds: MailSeeds, name: string): string => seeds[name] ?? '';

/**
 * what one box's press would do to the value behind it.
 *
 * `Removed` is a word the confirm prints, because a removal has no value to stand in its row. the
 * other two are read rather than printed: the row holds the value instead, and what they decide is
 * whether the sentence about a copy nothing can hand back is drawn.
 */
export type MailBoxAct = 'Set' | 'Replaced' | 'Removed';

/**
 * what one box is asking for, read against the seed it was drawn with.
 *
 * **the seed is the whole comparison and the reading is one for every box.** a box holding what
 * it was drawn with is untouched; an emptied box is a removal where the seed said something was
 * there; and anything else is a value to store. read
 * against emptiness instead, a box seeded from the deployment would offer to save the deployment
 * back to itself the moment the panel opened.
 */
export const mailBoxAct = (seeds: MailSeeds, name: string, value: string): MailBoxAct | null => {
	const was = mailSeed(seeds, name);
	if (value === was) return null;
	if (value === '') return was === '' ? null : 'Removed';
	// a box holding nothing but whitespace asks for neither. the deployment drops such a string
	// and ./secret-edits.ts refuses to store one, so reading it as a value would arm the press
	// and then state an act in the confirm that the press cannot make — and the values are never
	// trimmed on the way through, deliberately and for the reason written down there: a space at
	// either end is a character of a credential. so what is refused here is only the box that is
	// whitespace and nothing else, which is the same box that reading refuses.
	if (value.trim() === '') return null;
	return was === '' ? 'Set' : 'Replaced';
};

/**
 * whether the deployment holds a value under one name once the press lands.
 *
 * **the schema and the confirm read a box through this one function, and that is what keeps them
 * from disagreeing.** the press is held back over what it would leave behind ({@link mailGaps})
 * and the card states what it would do ({@link mailAct}), and a second derivation of what a box is
 * asking for is a card offering an act the press has already been refused for.
 *
 * **a box holding nothing but whitespace is not read here at all.** such a box is refused under
 * itself by {@link mailForm} on any press, so nothing this reads ever reaches a card — and read as
 * leaving nothing behind, four of them at once would be indistinguishable from the four emptied
 * boxes that are a removal.
 */
export const mailHeld = (seeds: MailSeeds, name: string, typed: string): boolean => {
	const which = mailBoxAct(seeds, name, typed);
	return which === null ? mailSeed(seeds, name) !== '' : which !== 'Removed';
};

/** what a press would leave the deployment holding under one of the mail values. */
export type MailAfter = {
	readonly name: string;
	/** the deployment holds a value under this name once the press lands. */
	readonly held: boolean;
};

/**
 * the mail values a press would leave the deployment without, where it leaves it holding others.
 *
 * **the five are one press or none (./secret-groups.ts), and this is what holds that to a press
 * rather than only stating it.** the deployment cannot send with any one of them missing
 * (`parseSmtpEndpoint` and `parseMailFrom` in `packages/app/src/lib/server/email/smtp-config.ts`),
 * so a press leaving four of five set stores credentials that send nothing and leaves the fold
 * reading as though mail were set up — {@link mailUnconfigured} then closes the test send beside
 * it, which is the one control that would have said so.
 *
 * **it reads what the press would leave behind and not what was typed.** a box holding its seed is
 * a value already stored and untouched, and a box emptied over a stored value is a removal — so
 * the reading each box needs is its own act against its own seed, taken by the fold that drew it,
 * and what arrives here is the answer.
 *
 * **every box empty is no gap.** taking mail off a deployment is a press an operator makes on
 * purpose, and refusing it would leave the five stored with no way to clear them.
 */
export const mailGaps = (after: readonly MailAfter[]): readonly string[] => {
	const missing = after.filter((value) => !value.held);
	return missing.length === after.length ? [] : missing.map((value) => value.name);
};

/** what a mail press does to this deployment, which is what its confirm is about. */
export type MailAct = 'starting' | 'changing' | 'stopping';

/**
 * which of the three a press is, read off what the deployment holds now and what it would hold
 * after.
 *
 * **there are three and not one because the consequence is three different things.** the values in
 * the boxes are what an operator can already see; what they cannot is what the deployment does
 * differently once the press lands — starts sending on their behalf, sends through somewhere else,
 * or stops sending at all. a confirm that itemised the boxes alone would be the screen read back.
 *
 * it is only ever asked of a press {@link mailGaps} has passed, so what it is handed is all held or
 * none.
 */
export const mailAct = (before: boolean, after: readonly MailAfter[]): MailAct =>
	after.every((value) => value.held) ? (before ? 'changing' : 'starting') : 'stopping';

/**
 * what a box left empty says when the press it was part of was held back.
 *
 * one sentence under each of them rather than one about the group somewhere else: the boxes are
 * what has to change, and a message at the press names none of them.
 *
 * one word, because it stands under every empty box at once. the label above the box names it and
 * the box under the label is empty, so the row already reads as the whole sentence — mail host,
 * nothing, required. what a longer one would add is that the five are one press or none, which is a
 * fact about the group rather than about the box it would be standing under, and an operator held
 * back over three of them would read it three times.
 *
 * it is the word both operator surfaces use for a box a save refuses blank (`REQUIRED` in
 * `@better-giving/operator/console/org-rules`, which the organisation fold's boxes take it straight
 * from), spelled again here because these five are the binary's own boxes and no rule in that
 * module is about them.
 */
export const MAIL_BLANK = 'required';

/**
 * what the From box says about a value that is not an address a message can leave under.
 *
 * **the reading is `mailFromFault`'s and only the words are here.** the deployment refuses the
 * same two values at the send (`parseMailFrom` in
 * `packages/app/src/lib/server/email/smtp-config.ts`) and that module's own sentences name the
 * variable and say where to set it, which is the vocabulary of a deployment log rather than of a
 * box labelled Sender email address. one predicate, two vocabularies — a second predicate is what
 * would let one end store a value the other refuses.
 *
 * neither sentence names the box: the label above it does, and both stand under it. the first
 * names the part to delete rather than restating the whole shape, because what an operator has in
 * front of them is a value they pasted off their mail provider's page with the name still on it.
 */
export const MAIL_FROM_SAID: Readonly<Record<MailFromFault, string>> = {
	'display-name': 'That has a name in front of the address. This box takes the address on its own.',
	'not-an-address': 'That is not an email address.'
};

/**
 * one box as the form layer reads it, which is the one place an empty box is a value.
 *
 * conform hands `undefined` for a box holding nothing — every empty string is dropped before the
 * schema sees it (`parseWithZod` in `@conform-to/zod/v4`) — and an empty box here is an act rather
 * than an absence: a box emptied over a stored value is the removal, and every box emptied at once
 * is mail taken off the deployment. so none of them is refused for being absent, and
 * {@link mailForm}'s rule reads the empty string it stood for.
 */
const heldValue = z.string().optional();

const mailBoxes = (group: SecretGroup) =>
	z.object(Object.fromEntries(pressedNames(group).map((name) => [VALUE_FIELD(name), heldValue])));

/**
 * the mail fold's credentials form: what its `<Form>` is called, and the two rules its press runs
 * first.
 *
 * **neither rule is stated here; both are called.** what the five may leave the deployment without
 * is {@link mailGaps} — the five are one press or none (./secret-groups.ts), which is a reading of
 * what the press would leave behind — and what the From box may hold is `mailFromFault`, the same
 * reading the send takes. so what the schema adds is where each sentence is said and in what order,
 * and nothing about what is wrong.
 *
 * **neither of them arms or disarms the press.** both add sentences to a press already made, and
 * what a press would do to the deployment is read where the card is drawn (./smtp-fold.tsx).
 *
 * **it is a factory because the reading is made against the seeds**, which are what the boxes were
 * drawn with rather than anything a body claims: a box holding its seed is one nobody went near,
 * and the same box empty is a value taken away ({@link mailBoxAct}).
 *
 * **the port is in no box here.** it is stated rather than asked for and posts nothing
 * (`STATED_VALUES` in ./secret-groups.ts), so a box for it would be a rule about a value an
 * operator cannot type and the press would then report on.
 *
 * **the boxes are keyed by what they post** (`VALUE_FIELD` in ./secret-groups.ts), which is what
 * ./secret-edits.ts reads the body back by and what the far end's own answer is carried onto
 * (./smtp-fold.tsx) — so the name a sentence is keyed to is the name the box carries.
 *
 * the id is the group's own, which is what the intent is composed from (`groupIntent` in
 * ./secret-groups.ts): every box id on the form is composed off it by the seam
 * (./use-console-form.ts), and a second literal here would be a form id that stops moving with the
 * press it belongs to.
 */
export function mailForm(
	group: SecretGroup,
	seeds: MailSeeds
): StatedForm<ReturnType<typeof mailBoxes>> {
	const pressed = filled(pressedNames(group));
	return {
		id: group.id,
		schema: mailBoxes(group).superRefine((held, ctx) => {
			/* a box holding nothing but whitespace, named under itself whatever the press is. it is a
			   box somebody typed in and the deployment stores nothing from it — ./secret-edits.ts
			   refuses such a string — so the sentence is true of it before what the press does is
			   read at all, which is why it is here rather than in {@link mailHeld}. it is also what
			   keeps four of them from reading as the four emptied boxes that are a removal: the
			   destructive card is the one press on this fold that must never open over rows it cannot
			   name (./smtp-fold.tsx).

			   an empty box is not one of these. that is the removal, and it is the gaps below that
			   answer for it. both walks are in the order the boxes are drawn, because that is where
			   focus goes ({@link MAIL_ORDER}). */
			const spaces = pressed.filter((name) => {
				const value = held[VALUE_FIELD(name)] ?? '';
				return value !== '' && value.trim() === '';
			});
			for (const name of spaces) {
				ctx.addIssue({ code: 'custom', message: MAIL_BLANK, path: [VALUE_FIELD(name)] });
			}

			const after = pressed.map((name) => ({
				name,
				held: mailHeld(seeds, name, held[VALUE_FIELD(name)] ?? '')
			}));
			/* and the boxes a press would leave the deployment without. a box named above is skipped
			   rather than named twice: it is the same word under the same box, and a second copy is a
			   list where the fold draws one sentence. */
			for (const name of mailGaps(after)) {
				if (spaces.includes(name)) continue;
				ctx.addIssue({ code: 'custom', message: MAIL_BLANK, path: [VALUE_FIELD(name)] });
			}

			// the one box here with a rule about what is in it rather than about whether anything is
			// ({@link MAIL_FROM_SAID}). it is read against the seed and not against the box, because
			// the other two states of that box are already owned: the seed coming back is a stored
			// address nobody went near, and an empty box is a removal, which the gaps above answer. so
			// the rule runs on what {@link mailBoxAct} calls a value, which is the only state the
			// operator typed something in.
			const typed = held[VALUE_FIELD('MAIL_FROM')] ?? '';
			const asked = mailBoxAct(seeds, 'MAIL_FROM', typed);
			const fault = asked === 'Set' || asked === 'Replaced' ? mailFromFault(typed) : null;
			if (fault !== null) {
				ctx.addIssue({
					code: 'custom',
					message: MAIL_FROM_SAID[fault],
					path: [VALUE_FIELD('MAIL_FROM')]
				});
			}
		})
	};
}

/**
 * the box the test is sent to, which is the one thing that press carries.
 *
 * it is here rather than in the fold that draws it because the rule below is keyed to it: the seam
 * finds a box by what that box posts (./use-console-form.ts), so the name a sentence is keyed to
 * has to be the name the box carries, and the schema states both or neither.
 */
export const TEST_TO_FIELD = 'test-to';

/**
 * what the To box says about a value no message can be sent to.
 *
 * **one sentence for two answers, because both are about the value in that box.** the box states
 * the rule before the press ({@link testSendForm}) and the deployment applies it again to whatever
 * it is sent (`packages/app/src/routes/console.test-email.ts`), which is what a door reachable by
 * anything holding a console session owes — and the two agree by reading `EMAIL` and `MAX_EMAIL`
 * out of `@better-giving/operator/console/org-rules` rather than by each stating a rule of its own.
 *
 * the words are this screen's and not that endpoint's: its refusal names a `to` key and is written
 * for a caller sending JSON, and what the operator has in front of them is a box labelled To.
 * nothing was sent holds for both — a press held back at the box starts nothing, and a press the
 * deployment turned down handed no message to a mail host.
 */
export const TEST_TO_SAID = 'That is not an address this deployment can send to. Nothing was sent.';

/**
 * the destination as the form layer reads it, which is one box and one rule.
 *
 * **the box is optional and the rule is on the object around it.** `parseWithZod` rewrites the
 * schema it is handed so that an empty box arrives as `undefined`, and it reaches through a
 * `.pipe()` to do it — so a box that filled the empty string in ahead of its own rule would pass
 * every reading of the schema and refuse nothing in the browser. {@link mailForm} is the same shape
 * for the same reason.
 */
const testSchema = z.object({ [TEST_TO_FIELD]: z.string().optional() }).superRefine((held, ctx) => {
	// trimmed before it is measured, in the order the deployment measures it: an address arrives
	// pasted, and a space either side of it is not what anybody typed it for.
	const to = (held[TEST_TO_FIELD] ?? '').trim();
	// **nothing at all about an empty box**, which is what this rule is written round. the press
	// beside it is already closed on that emptiness ({@link sendState}), and a sentence here would
	// arrive on first paint over a deployment that has simply never stored a notification address —
	// which is what the box is seeded from (./smtp-fold.tsx). a box holding nothing but spaces is
	// that same box, and the trim above is what makes it one.
	if (to === '') return;
	if (to.length <= MAX_EMAIL && EMAIL.test(to)) return;
	ctx.addIssue({ code: 'custom', message: TEST_TO_SAID, path: [TEST_TO_FIELD] });
});

/**
 * the test send's form: what its `<Form>` is called, and the one rule its press runs first.
 *
 * **the id is the word the press posts, handed in rather than spelled here.** every box id on the
 * form is composed off it by the seam (./use-console-form.ts), and a second literal would be a form
 * id that stops moving with the press it belongs to.
 *
 * **it arms and disarms nothing.** what closes the press is {@link sendState} and nothing here:
 * this rule adds a sentence to a press already made, and the box it is under is one an operator
 * fixes in place.
 */
export const testSendForm = (id: string): StatedForm<typeof testSchema> => ({
	id,
	schema: testSchema
});

/** what the send press is drawn from. */
export type SendFacts = {
	/** which intent the page has in flight, or `null` where none is. */
	readonly pending: string | null;
	/** what this press posts, which is the only one of them that closes it. */
	readonly intent: string;
	/** the last press landed and the message went. */
	readonly sent: boolean;
	/** that confirmation's own seconds have run out, which puts the press back. */
	readonly expired: boolean;
	/** the box holds no address, so there is nowhere to send to. */
	readonly empty: boolean;
	/** the deployment holds no mail settings, so there is nothing to send through. */
	readonly unconfigured: boolean;
};

/**
 * what the send press draws.
 *
 * the four rungs of `useSavedFormState`'s own reading in its own order, because it is the same button in
 * the same states — and a separate reading because the last rung asks a different question. that
 * form is seeded from what is stored and rests when its boxes match the seed; this one has a box
 * that must hold an address and a deployment that must have somewhere to hand a message to, and
 * rests where either is missing.
 *
 * **the last rung carries both of those, and the fold tells them apart.** a press with nothing to
 * send to and a press with nothing to send through are the same closed press, so they are one rung —
 * but only one of them is fixed in the box beside it, and a box closed on this whole reading is one
 * the operator cannot type the address into (./smtp-fold.tsx).
 *
 * the confirmation is a fact handed in rather than a timer read here: what ends it is a screen
 * behaviour, and what it means for the press is this.
 */
export function sendState({
	pending,
	intent,
	sent,
	expired,
	empty,
	unconfigured
}: SendFacts): SavedFormState {
	if (ownPress(pending, intent)) return 'pending';
	if (sent && !expired) return 'done';
	return empty || unconfigured ? 'disabled' : 'idle';
}
