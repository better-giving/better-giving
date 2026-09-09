import type { OrgProfileField } from '@better-giving/operator/console/org';
import { ORG_PROFILE_FIELD_RULES } from '@better-giving/operator/console/org-rules';
import { z } from 'zod';
import type { OrgWrite } from '../api/types';
import { orgBoxes, type OrgBoxes } from './org-fields';
import type { StatedForm } from './use-console-form';

// what the two folds that edit the profile do with what the deployment reported: what each seeds
// its boxes from, which of a refusal's sentences belongs to which fold, and which rules each of
// them runs in front of the person typing. every value here, so ./org-form.spec.ts looks at all of
// it with no dom.
//
// **every box arrives holding exactly what the deployment holds.** nothing is offered into an empty
// one, so a box differing from what it was drawn with and a box differing from what is stored are
// the same reading — which is why {@link seedFor} below is the whole of what either button is armed
// against, and why neither fold has to tell its button that it arrived with something to send.
//
// **it states no rule about what may be stored and mounts the ones both surfaces read.** what a
// profile field may hold is `ORG_PROFILE_FIELD_RULES` in
// `@better-giving/operator/console/org-rules`, and the two forms below are the nine of them split
// the way the folds are — {@link ORG_FORM}'s eight and {@link NOTIFICATIONS_FORM}'s one — each
// handed whole to ./use-console-form.ts. the rules are in one module because two surfaces apply
// them to the same values: a copy here would be the cheaper answer and is exactly how the two come
// to disagree — one end taking eight digits for an EIN and the other
// refusing the save is an operator told a value is fine and then told it is not, with nothing on
// either screen saying which half was right.
//
// **the deployment stays the authority.** `/console/org` is reachable by anything holding a console
// session, so the worker parses every profile it is sent whatever asked it to; the console reading
// first is a courtesy to the operator, exactly as `@better-giving/operator/origins`'s second
// paragraph puts it for the site list.

/**
 * what one of the two folds seeds its boxes with, cut out of the profile by the form it mounts.
 *
 * **the seed is what the button is armed against** — the form layer compares its own values to it
 * (./use-console-form.ts) — so it holds exactly the boxes that form states and no others: a key for
 * a box the form does not state is a form that reads as changed forever, and a box with no key is
 * one an operator can edit under a button that never arms.
 *
 * the keys come off the schema's own shape rather than being written out again, which is what keeps
 * the two in step: a box added to a form is seeded by that addition alone.
 */
export const seedFor = <S extends z.ZodObject>(
	form: StatedForm<S>,
	stored: OrgBoxes
): Record<string, string> =>
	Object.fromEntries(
		Object.keys(form.schema.shape).map((box) => [box, stored[box as OrgProfileField] ?? ''])
	);

/**
 * the profile the boxes are seeded from: the one a press stored, or the reading the page holds.
 *
 * **the answer's own profile wins from the moment a press stores one.** the page re-reads the
 * deployment after every press, but that reading commits a render later than the answer does — and
 * a landed write puts the boxes back to whatever they were seeded with at that moment (the reset in
 * `@better-giving/operator/saved-form-state.react`). seeded from the reading alone, a saved address
 * is put back to the one the press replaced, and nothing seeds the box again. the site list is read
 * off its own write for the same reason (./sites-fold.tsx).
 *
 * **only a press that stored a profile is read, and only where it carried one.** a refusal leaves
 * the boxes holding what was typed, so there is something to fix; and a deployment older than this
 * console answers a save with a report naming no profile at all, which seeded from would be a save
 * that landed wiping every box on the screen.
 */
export const storedOrg = (reading: OrgBoxes, write: OrgWrite | null): OrgBoxes =>
	write?.kind === 'saved' && isProfile(write.org) ? orgBoxes(write.org) : reading;

const isProfile = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * one box of the identity fold as the form layer reads it, which is the one place an empty box is
 * a value.
 *
 * conform hands `undefined` for a box holding nothing — every empty string is dropped before the
 * schema sees it (`parseWithZod` in `@conform-to/zod/v4`) — so a rule mounted on a box answers an
 * emptied one with the string check rather than with its own sentence. three of the eight take a
 * blank and state nothing about one (`address_line2`, `region` and `postal_code` in
 * `@better-giving/operator/console/org-rules`), which is the whole of that arm for them: emptying
 * one and pressing was refused "expected string, received undefined" over a save the deployment
 * would have taken. the other five reach the same arm and say the right word for the wrong reason.
 *
 * so no box carries a rule and {@link ORG_FORM} runs all eight over the empty string a box stood
 * for. putting that string back in front of the rule is not the other way out: the rewrite reaches
 * through a pipe, which {@link NOTIFICATIONS_FORM} states. {@link notificationBox} below is the
 * same reading, and so are ./stripe-keys.ts's `heldKey` and ./smtp-fold-state.ts's `heldValue`.
 */
const identityBox = z.string().optional();

/**
 * the eight boxes the identity fold draws.
 *
 * one field per line rather than the nine filtered down, for `stated` in ./org-fields.ts's reason:
 * the eight are read here rather than derived from what the ninth is not. which rule each of them
 * runs is {@link ORG_FORM}'s walk, and a box named here that the leaf states no rule for is a
 * compile error there; a profile field no box here draws is ./org-form.spec.ts's.
 */
const identityBoxes = z.object({
	legal_name: identityBox,
	tax_id: identityBox,
	address_line1: identityBox,
	address_line2: identityBox,
	city: identityBox,
	region: identityBox,
	postal_code: identityBox,
	country: identityBox
});

/** one of the eight, which is what the fold's own box helper takes. */
export type IdentityField = keyof typeof identityBoxes.shape;

/**
 * the identity fold's form: what its `<Form>` is called, and the rules its press runs first.
 *
 * **the eight boxes it draws and not the profile's nine.** the ninth is carried hidden at exactly
 * what the deployment holds (`carriedBoxes` in ./org-fields.ts), so a sentence raised over it here
 * would be one keyed to a box this form has none of — focus into a panel nobody has open, which is
 * a press answered by nothing moving. `foldErrors` below cuts the deployment's own answer down
 * along the same line, and the notification address is judged by the fold that draws it.
 *
 * **the rules are run over the boxes rather than mounted on them** ({@link identityBox}), and one
 * walk runs all eight: what a box may hold is the leaf's to say for every one of them alike, so a
 * rule that later loses its `.min(1)` is a box that takes a blank rather than a box refused in
 * zod's words.
 *
 * **each of them is `ORG_PROFILE_FIELD_RULES` bare, which is the stage a browser reads.** what
 * wraps them in `.nullable()` is the deployment's clean stage, which has already turned a blank
 * into `null` by the time it parses — so the empty string a box stood for is what the rule is
 * handed here, and the sentence it earns is the one the deployment's own `null` arm carries.
 *
 * **only the issues are read, never what a pass would return.** `tax_id`'s rule ends in a transform
 * that re-spells an EIN into the one spelling a receipt prints, and that rewrite is the
 * deployment's to make — this form asks what is wrong with a box and never what would be stored, so
 * nothing on screen re-spells a value the operator typed. the seam hands the fold `errors` and no
 * parse output at all (./use-console-form.ts).
 *
 * the id is the form's, and every box id on the fold is composed off it by the seam — so `org` is
 * also the prefix a refusal's key is found by.
 */
export const ORG_FORM: StatedForm<typeof identityBoxes> = {
	id: 'org',
	schema: identityBoxes.superRefine((held, ctx) => {
		for (const field of Object.keys(identityBoxes.shape) as IdentityField[]) {
			const read = ORG_PROFILE_FIELD_RULES[field].safeParse(held[field] ?? '');
			if (read.success) continue;
			for (const issue of read.error.issues) {
				ctx.addIssue({ code: 'custom', message: issue.message, path: [field] });
			}
		}
	})
};

/**
 * the one box the notifications fold draws, at the rule stated for it in the leaf.
 *
 * **the rule takes a blank and the label still carries no `(optional)` marker, and the two are not
 * in tension.** the save stores a profile holding no notification address, so nothing here holds a
 * press over an empty box; a deployment left that way is unfinished rather than set up a different
 * way, which is the narrower reading `orgRequired` in ./org-fields.ts makes and what the fold's own
 * row says out loud (./home-sections.ts).
 *
 * **the box is `.optional()` and the rule reads the empty string it stood for.** conform drops
 * every empty box before the schema sees it (`parseWithZod` in `@conform-to/zod/v4`), so a bare
 * string would answer an emptied box with the string check — "expected string, received undefined"
 * — and the rule that takes a blank would never run at all. the payments fold's boxes are
 * `.optional()` for the same reading and ./stripe-keys.ts's `heldKey` states it.
 */
const notificationBox = z.object({ notification_email: z.string().optional() });

/**
 * the notifications fold's form: what its `<Form>` is called, and the rule its press runs first.
 *
 * **the one box it draws and not the profile's nine.** the other eight are carried hidden at
 * exactly what the deployment holds (`carriedBoxes` in ./org-fields.ts), so a sentence raised over
 * one of them here would be keyed to a box this form has none of — focus into a panel nobody has
 * open, which is a press answered by nothing moving. `foldErrors` below cuts the deployment's own
 * answer down along the same line.
 *
 * **the rule is mounted bare**, for {@link ORG_FORM}'s reason: `ORG_PROFILE_FIELD_RULES` is the
 * stage a browser reads, and what wraps it in `.nullable()` is the deployment's clean stage, which
 * has already turned a blank into `null` by the time it parses.
 *
 * **the rule is run over the box rather than mounted on it, and that is conform's coercion rather
 * than a preference.** `parseWithZod` rewrites the schema it is handed so that an empty box reads
 * as `undefined`, and it reaches through a pipe to do it — so a rule piped behind a transform that
 * put the empty string back has that string turned into `undefined` again before its own string
 * check runs, and an emptied box is answered "expected string, received undefined" with nothing
 * sent. a check on the object is not rewritten, which is where ./stripe-keys.ts's `stripeForm`
 * runs its own reading for the same reason.
 *
 * **the sentences are the leaf's and are spelled nowhere here**, for {@link ORG_FORM}'s reason: a
 * second spelling is how the two ends come to disagree about one value.
 *
 * the id is the form's, and every box id on the fold is composed off it by the seam — so
 * `notifications` is also the prefix a refusal's key is found by.
 */
export const NOTIFICATIONS_FORM: StatedForm<typeof notificationBox> = {
	id: 'notifications',
	schema: notificationBox.superRefine((held, ctx) => {
		const read = ORG_PROFILE_FIELD_RULES.notification_email.safeParse(
			held.notification_email ?? ''
		);
		if (read.success) return;
		for (const issue of read.error.issues) {
			ctx.addIssue({ code: 'custom', message: issue.message, path: ['notification_email'] });
		}
	})
};

/**
 * the refusal's sentences for the boxes one fold draws, or `null` where the press was not refused.
 *
 * handed whole to the seam's `refused` on either fold (./use-console-form.ts) — a key for the
 * other fold's box would send focus into a shut panel, which is a press answered by nothing moving.
 * what says where those went is `OrgWriteOutcome`'s `elsewhere` in ./org-write.tsx instead.
 */
export const foldErrors = (
	write: OrgWrite | null,
	drawn: readonly OrgProfileField[]
): Record<string, string> | null => {
	if (write?.kind !== 'refused') return null;
	return Object.fromEntries(
		Object.entries(write.errors).filter(([field]) => drawn.includes(field as OrgProfileField))
	);
};

/** "a, b and c" — a list a person reads. */
export const listed = (words: readonly string[]): string =>
	words.length <= 1 ? (words[0] ?? '') : `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`;
