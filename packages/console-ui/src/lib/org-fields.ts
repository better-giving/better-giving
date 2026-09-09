import { IDENTITY_FOLD, NOTIFICATIONS_FOLD } from '@better-giving/operator/setup-folds';
import { ORG_PROFILE_FIELDS, type OrgProfileField } from '@better-giving/operator/console/org';

// what each box of the organisation's legal identity is called on a console screen, and what a
// press posts.
//
// **the boxes and the reading of what they held are one module, and nothing about a credential is
// in it.** the screen draws the boxes, {@link orgEdits} reads them off the submitted form, and the
// binary posts them to the deployment over the session it holds
// (`packages/console/internal/deployment/org.go`) — so the field names are stated once, on the side
// a component can import, and the token they travel under is somewhere no page can reach.
//
// **it is copy and never a rule.** which boxes may be left empty, how long a value may be, what an
// email has to look like and what an EIN has to look like are stated once, in
// `ORG_PROFILE_FIELD_RULES` (`@better-giving/operator/console/org-rules`), and both surfaces read
// them there: the deployment parses every profile it is sent, and the two folds that draw the boxes
// run the same rules in front of the person typing (./org-form.ts's `ORG_FORM` and
// `NOTIFICATIONS_FORM`). a copy in this module would be a second opinion about
// whether a receipt may be printed, and the half that drifts is the one nothing reports. an
// `(optional)` marker never claims more than those rules allow: a marked box is one the save takes
// empty, so a marker over a box the save refuses blank is a screen calling a required box optional.
//
// **it is the narrower question that decides the marker, and one field answers the two
// differently.** the save stores a profile holding no notification address and a deployment left
// that way is still unfinished: alerts nobody addressed reach the logs and no person. so that box
// carries no marker, {@link orgRequired} reads it as wanted, and the save refuses nothing. a box
// is marked where blank is a finished answer and nowhere else.
//
// **a placeholder demonstrates the shape and never states the rule.** what a box may hold is those
// same rules', so an example here is one they would take and nothing more — the EIN's is written in
// the spelling the deployment stores (`einAsPrinted` in
// `@better-giving/operator/console/org-rules`), because an example a save would refuse is a screen
// demonstrating a value nobody can enter. it is bound the way the `(optional)` marker is and for
// the same reason.
//
// **the examples are better.giving's own name and addresses, and the street is nobody's.** the
// name is README.md's steward and the two mailboxes are at the domain the foot links under
// (./product-foot.tsx), which is the one place a form on this console says whose product it is. the
// street, the city and the postcode are plainly sample: a placeholder that turned out to be some
// real organisation's registered address would be worse than a generic one.
//
// **these words are where the box names are decided, and one list follows them.**
// `IDENTITY_FIELDS` in `packages/app/src/lib/server/org/identity.ts` — the deployment's own list of
// the boxes no donation form is served without, and not {@link IDENTITY_BOXES} below — names them
// in these same words, because the sentence it writes sends an operator to this screen to find
// them: a sentence naming "Tax ID" against a box labelled "EIN" is a scavenger hunt. so a label
// changed here changes what that sentence has to say. the schema's own names — `legal_name`,
// `tax_id` — reach neither screen (CLAUDE.md).

/**
 * what each of the two presses posts, which is the submitting button's own value.
 *
 * two rather than one, although both store the same row: the answer is drawn under the button that
 * was pressed, and one word for both would put a refusal from the identity fold under the
 * Notifications button as well.
 */
export const ORG_INTENT = 'org:save';
export const NOTIFICATIONS_INTENT = 'notifications:save';

/** how one box is drawn and what it says under its own label. */
export type OrgFieldCopy = {
	readonly label: string;
	/**
	 * what the box stands on while it is empty, which the header argues the bounds of.
	 *
	 * stated for every field rather than optional: a box drawn without one is the only box on the
	 * fold demonstrating nothing, and a field added to the wire should be a compile error here
	 * rather than that.
	 *
	 * it is never a value. nothing draws it as one — {@link orgEdits} reads what was typed, and a
	 * box nobody typed in is read as the empty string it holds.
	 */
	readonly placeholder: string;
	/**
	 * what a browser may fill this box from.
	 *
	 * stated only where the token is about the organisation. the EIN has none, and the
	 * notification address has none on purpose: it is where operational mail goes rather than the
	 * operator's own address, and `email` would offer to fill it with theirs.
	 */
	readonly autoComplete?: string;
	/**
	 * blank is a finished answer here, which is what the marker on the label says out loud.
	 *
	 * narrower than what the save takes: two boxes the save stores empty carry no marker, because a
	 * deployment left that way is unfinished rather than set up a different way — the header names
	 * them and {@link orgRequired} reads them as wanted.
	 */
	readonly optional?: true;
	/** a paragraph rather than a line, so a textarea. */
	readonly prose?: true;
	/** read digit by digit against the document it was copied from, so the tabular face. */
	readonly figures?: true;
};

/** the nine boxes, keyed by the field the wire and the refusal both name. */
export const ORG_FIELDS: Record<OrgProfileField, OrgFieldCopy> = {
	legal_name: {
		label: 'Registered name',
		placeholder: 'Better Giving',
		autoComplete: 'organization'
	},
	tax_id: {
		label: 'EIN',
		// the stored spelling, which is what a receipt prints: nine digits with the dash the IRS
		// puts between the second and the third.
		placeholder: '12-3456789',
		figures: true
	},
	address_line1: {
		label: 'Street address',
		placeholder: '123 Example Street',
		autoComplete: 'address-line1'
	},
	address_line2: {
		label: 'Suite, floor or unit',
		placeholder: 'Suite 400',
		optional: true,
		autoComplete: 'address-line2'
	},
	city: { label: 'City', placeholder: 'Anytown', autoComplete: 'address-level2' },
	region: {
		label: 'State, province or county',
		placeholder: 'California',
		optional: true,
		autoComplete: 'address-level1'
	},
	postal_code: {
		label: 'Postal code',
		placeholder: '12345',
		optional: true,
		figures: true,
		autoComplete: 'postal-code'
	},
	country: { label: 'Country', placeholder: 'United States', autoComplete: 'country-name' },
	notification_email: {
		label: 'Notification email',
		// it stays a text box and never `type="email"`: the deployment's rule is deliberately weaker
		// than the browser's, so a value the browser blocks and the deployment would take is a
		// refusal with no message attached to it. no hint under it: the fold's own row says what
		// the address is for (`JOB_NOTES` in `@better-giving/operator/setup-folds`), and a box
		// with a paragraph over it is the row read a second time on the way to the box.
		placeholder: 'alerts@better.giving'
	}
};

/**
 * the box the Notifications fold draws, which is where this deployment reaches the operator.
 *
 * a list rather than a flag on the copy above, because it is the fold's contents rather than a
 * property of the field: ./home-sections.ts reads which fold a blank belongs to off these two, a
 * refusal is drawn under the fold whose list names it (./org-form.ts), and a fold's own module
 * draws the run. the two partition the profile and ./org-form.spec.ts holds that — a field on
 * neither is a box nobody draws and a refusal nobody can be sent to.
 *
 * it is on the profile and stored with the identity, and it is drawn on a row of its own rather
 * than beside the organisation's legal name or beside the mail credentials: an address the operator
 * is reached at is neither the identity a gift is asked for under nor the transport that carries a
 * message out.
 */
export const NOTIFICATION_BOXES: readonly OrgProfileField[] = ['notification_email'];

/** the rest, which is the organisation's own identity and what the Organisation fold draws. */
export const IDENTITY_BOXES: readonly OrgProfileField[] = ORG_PROFILE_FIELDS.filter(
	(field) => !NOTIFICATION_BOXES.includes(field)
);

/**
 * the ledger row an operator opens to find one of the profile's boxes, in the words that row
 * carries, re-exported from where both operator surfaces read them.
 *
 * a refusal on a box names the row to go and open, so the sentence and the row it names cannot come
 * apart — and the deployment reads the same rows under the same words, which is why they moved to
 * the leaf both surfaces dress from rather than staying here.
 */
export { IDENTITY_FOLD, NOTIFICATIONS_FOLD };

/** which of the two draws the box for one field. */
export const boxFold = (field: OrgProfileField): string =>
	NOTIFICATION_BOXES.includes(field) ? NOTIFICATIONS_FOLD : IDENTITY_FOLD;

/**
 * what a fold posts hidden, given the boxes it draws: every other field of the profile.
 *
 * the deployment reads a profile whole, so a field left out of a body is one it stores as cleared —
 * and each fold has to carry the other folds' boxes at exactly what the deployment holds. taken
 * from the enumeration rather than named per fold, so a fourth list is one list and not three
 * concatenations to find.
 */
export const carriedBoxes = (drawn: readonly OrgProfileField[]): readonly OrgProfileField[] =>
	ORG_PROFILE_FIELDS.filter((field) => !drawn.includes(field));

/**
 * whether a fold is unfinished while this box is empty.
 *
 * one list rather than two: a row asking whether a fold is finished asks exactly what the label
 * says, so a box is marked `(optional)` where and only where a blank one leaves nothing outstanding.
 * what it is not is a reading of the save — the notification address is stored blank and is still
 * wanted, and the header holds why.
 */
export const orgRequired = (field: OrgProfileField): boolean => ORG_FIELDS[field].optional !== true;

/**
 * every box of the form, stated.
 *
 * a value per field rather than the wire's own shape, which states only what it holds: a box with
 * no seed at all is a box react renders with nothing in it and no way to tell that from a cleared
 * one, and an absent key posted back would be a field the deployment stores as cleared.
 */
export type OrgBoxes = Record<OrgProfileField, string>;

/**
 * the ten, spelled out in the one place this console spells them out.
 *
 * one field per line rather than a walk over the wire's list, for the reason `toFormValues` in
 * `packages/app/src/lib/server/org/form-values.ts` spells its own out: a field added to the wire
 * is then a compile error here rather than a box that quietly never gets drawn. what differs
 * between the two callers is only where a value is read from, which is the argument.
 */
export function stated(value: (field: OrgProfileField) => string): OrgBoxes {
	return {
		legal_name: value('legal_name'),
		tax_id: value('tax_id'),
		address_line1: value('address_line1'),
		address_line2: value('address_line2'),
		city: value('city'),
		region: value('region'),
		postal_code: value('postal_code'),
		country: value('country'),
		notification_email: value('notification_email')
	};
}

/**
 * the profile the deployment reported, as the boxes it seeds.
 *
 * the envelope checked nothing about this member (../api/types.ts's `HomeReading`), so this is where it
 * stops being `unknown` — read one field at a time. a field that is not a string is drawn as an empty
 * box: it is a value no box could have produced, and posting it back is not this console's to do.
 */
export function orgBoxes(org: unknown): OrgBoxes {
	const held = isRecord(org) ? org : {};
	return stated((field) => (typeof held[field] === 'string' ? held[field] : ''));
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * what a press asked for, read off the submitted form.
 *
 * every box goes out with every press, empty ones included, because that is what the endpoint
 * reads: a field absent from the body is stored as cleared. a box the body did not carry at all is
 * an empty one for the same reason — the alternative is a save that silently leaves a field alone
 * on a screen that showed it.
 *
 * nothing is trimmed and nothing is refused here. the rules belong to the deployment, and a console
 * that refused a value the deployment would take is a box nobody can save.
 */
export function orgEdits(posted: FormData): OrgBoxes {
	return stated((field) => {
		const typed = posted.get(field);
		return typeof typed === 'string' ? typed : '';
	});
}
