import type { DeployValueName } from '@better-giving/operator/deploy-split';

// the values as the screen groups them, and the names its boxes post under.
//
// **this and ./deploy-vars.ts hold the vocabulary a screen and its reader share.** the screen draws
// the groups and the boxes, and ./secret-edits.ts reads what they hold into the names to set and
// the names to remove — so the two ends need the same vocabulary, and what is here is the half both
// of them need and nothing that touches a network or a credential.
//
// **a group is a group of boxes and says nothing about how a value is stored.** all seventeen are
// plain vars (`DEPLOY_VARS` in packages/operator/src/deploy-split.ts); a name here calls a value a
// secret only where Stripe or a mail host calls it one.
//
// **nothing here is a contract with anybody outside this repository, which is the opposite of
// CLAUDE.md's packages/form rule.** a group's id travels between one form and one request to the
// binary on this machine, and every name in it may change the day the enumeration does.

/**
 * a group of values that is saved together, and the name the screen calls it.
 *
 * one save is one request (`packages/console/internal/deployment/write.go`), so a group is the
 * unit an operator commits — which is why the grouping is what a deployment *does* with the values
 * rather than which product issued them: an operator turning on card payments sets a pair, and
 * holding the pair to one press is what keeps a deployment from spending a save on half of it.
 *
 * the mail group is where that axis is load-bearing rather than tidy. two of its five are
 * credentials and three are not — a host, a port and the address a receipt is sent from — and
 * grouping by what issued them would put those three on a different press from the username and
 * password they are useless without. a deployment can send mail or it cannot, and the five are one
 * press or none.
 */
export type SecretGroup = {
	/** what the press posts as its intent, and what an outcome is reported against. */
	readonly id: string;
	readonly label: string;
	readonly names: readonly DeployValueName[];
};

/**
 * the five groups.
 *
 * the order is `DEPLOY_VARS`'s own, so a name added to the enumeration lands in a group here
 * without the screen and the split having an order each to drift from the other. four of the
 * seventeen are in no group and ./deploy-vars.ts names them: they are the values no group's press
 * sets, and that is where each is argued.
 *
 * two of the grouped names belong to no fold's own errand, and they are the first group:
 * `ADMIN_PASSWORD` is the credential that opens the dashboard for the operator who set the
 * deployment up (colleagues invited from the dashboard set their own), and `BETTER_AUTH_SECRET` is
 * what signs the session they get back — so what they have in common is who may reach /admin, which is
 * what the group is called. neither is a feature to turn on, which is why neither is filed under
 * one.
 *
 * ./secret-groups.spec.ts holds the covering: a name added to `DEPLOY_VARS` with no group here and
 * no entry on that list is a case that fails rather than a box nobody notices is missing.
 */
export const SECRET_GROUPS: readonly SecretGroup[] = [
	{ id: 'sign-in', label: 'Signing in to /admin', names: ['ADMIN_PASSWORD', 'BETTER_AUTH_SECRET'] },
	{
		id: 'email',
		label: 'Sending email',
		names: ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USERNAME', 'SMTP_PASSWORD', 'MAIL_FROM']
	},
	{ id: 'spam', label: 'Spam protection', names: ['TURNSTILE_SECRET_KEY'] },
	{
		id: 'payments',
		label: 'Taking card payments',
		names: ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET']
	},
	/* the second processor's own credentials, and a group of its own rather than three names added
	   to the one above: the two processors are alternatives, so a deployment set up on one holds
	   none of the other's and a single press over both would ask an operator to commit values they
	   will never have. the three are one press because an operator holds all three off one PayPal
	   app — the pair that authenticates every call, and the id of the listener it hears settlements
	   on.

	   `PAYPAL_CHARITY_RATE_APPROVED` is deliberately not among them. it is an answer about the
	   organisation rather than a credential, it is set months after the keys are, and it is drawn as
	   a switch rather than a box (./paypal-charity.ts) — so it carries a press of its own and is
	   filed with the values no group's press sets (./deploy-vars.ts). */
	{
		id: 'paypal',
		label: 'Taking PayPal and Venmo',
		names: ['PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET', 'PAYPAL_WEBHOOK_ID']
	}
];

/**
 * the group the page's first fold draws, named here so that the fold picking it out of the
 * enumeration and the folds drawing the rest are not two spellings of one id.
 *
 * it is the one group that is not a job a gift needs, and that is what decides where its fold
 * stands rather than whether it has one: who may reach /admin is how the operator gets into the
 * dashboard at all, so it opens the ledger in front of the four rather than taking a position among
 * them (./home-sections.ts). ./password-fold.tsx is the fold.
 */
export const SIGN_IN_GROUP = 'sign-in';

/** the group the mail fold draws, named here for {@link SIGN_IN_GROUP}'s reason. */
export const MAIL_GROUP = 'email';

/** the group the sites fold draws, named here for {@link SIGN_IN_GROUP}'s reason. */
export const SPAM_GROUP = 'spam';

/** the group the payments fold draws, named here for {@link SIGN_IN_GROUP}'s reason. */
export const PAYMENTS_GROUP = 'payments';

/**
 * the group the same fold's PayPal section draws, named here for {@link SIGN_IN_GROUP}'s reason.
 *
 * the three credentials alone. what the same section draws beside them and this group does not hold
 * is the charity-rate switch, which carries a press of its own (./paypal-charity.ts).
 */
export const PAYPAL_GROUP = 'paypal';

/** what a press posts to save `group`, which is the submitting button's own value. */
export const groupIntent = (group: SecretGroup): string => `secrets:${group.id}`;

/** the group a posted intent names, or `null` where it names none of them. */
export const groupPosted = (intent: unknown): SecretGroup | null =>
	SECRET_GROUPS.find((group) => groupIntent(group) === intent) ?? null;

/**
 * the values no operator ever types a value for, because a press mints one.
 *
 * `BETTER_AUTH_SECRET` signs the session a staff member gets back: `packages/console/internal/first`
 * generates it on the one press that makes the deployment and argues why a box for it would be
 * worse than none — its only correct answer is a random string, so an operator filling one in would
 * reach for a word they could remember. its group draws no row for it either: the sign-in group
 * passes `rows={false}` (./password-fold.tsx), because a name the operator never types and never
 * sets is the console's own workings rather than a fact to act on.
 *
 * `STRIPE_WEBHOOK_SECRET` is Stripe's, handed over once in the answer that registers the webhook
 * endpoint and readable from no call afterwards — so the press that registers is the only moment
 * one exists to store, and it stores it (`packages/console/internal/stripe`). a box for it would be a box
 * nobody can correctly fill. it does keep a row: ./payments-fold.tsx states whether the deployment
 * is holding one, because an operator reading that fold is deciding whether payments are set up.
 *
 * it is a list here rather than a literal where it is drawn so that each name is written once.
 * spelled again at the call site it would be a second copy to keep level, and the way that fails is
 * a box appearing under a renamed value with nothing saying so.
 */
export const MINTED_BY_CONSOLE: readonly string[] = ['BETTER_AUTH_SECRET', 'STRIPE_WEBHOOK_SECRET'];

/**
 * the names in a group an operator types a value for, which is the group less whatever the console
 * mints for itself.
 *
 * it is here rather than inside whatever draws a group because it is what every count and every
 * label there is about — one typed name beside one minted one is a single decision, and a plural
 * read off the group would say `Change these` over one box. ./secret-group-form.tsx's `generated` is
 * what carries the second list in.
 *
 * a group with every name minted has no act in it, and this answers with an empty list rather than
 * pretending otherwise: the rows are drawn and no control, because a control that opened no box
 * would be one an operator could press and get nothing from.
 */
export const typedNames = (
	group: SecretGroup,
	generated: readonly string[] = []
): readonly string[] => group.names.filter((name) => !generated.includes(name));

/**
 * the names whose value the deployment decides, which a form states rather than takes one for.
 *
 * `SMTP_PORT` is the whole of it and 465 is the value. the deployment dials implicit TLS on 465
 * and refuses every other port, 587 included, as a security decision, and it reads an absent one
 * as 465 — `parseSmtpEndpoint` in `packages/app/src/lib/server/email/smtp-config.ts` is where that
 * is argued and refused. so there is nothing for an operator to decide and no second value a box
 * could correctly hold.
 *
 * **it is here rather than in the fold that draws it because the reading it changes is the
 * action's.** a name arriving with no value behind it is an emptied box and so a removal
 * (./secret-edits.ts) — so a box that states its value and posts nothing would delete the
 * deployment's port on every mail save, silently, with the confirm saying nothing about it. both
 * ends filter through {@link pressedNames} instead.
 */
export const STATED_VALUES: readonly string[] = ['SMTP_PORT'];

/**
 * the names in `group` a press carries a value for, which is the names a form draws a box for.
 *
 * **it is the two absences together, and a press reading either one back is the same collapse.** a
 * form draws a box for {@link typedNames} and states {@link STATED_VALUES}, so both of the rest
 * arrive at the press with no box behind them — and the reading takes a name that came back empty
 * over a stored value as an emptied box and so as a removal (./secret-edits.ts). so a press reading
 * the whole group deletes what the operator was never shown: the mail port on every mail save, and
 * `BETTER_AUTH_SECRET` on every dashboard-password change, which signs every live staff session out
 * (`resolveAuthSecret` in packages/app/src/lib/server/auth/signing-key.ts).
 */
export const pressedNames = (group: SecretGroup): readonly string[] =>
	typedNames(group, MINTED_BY_CONSOLE).filter((name) => !STATED_VALUES.includes(name));

/**
 * the names whose box arrives holding its value as dots, with a press that shows it.
 *
 * every box on this console is seeded with the value the deployment is holding (./held-values.ts),
 * which is what lets an operator check a stored credential against the page they copied it from —
 * and four of the seventeen are values that reading over their shoulder is enough to take. the
 * dashboard password opens /admin, the mail password sends as the organisation, and the Stripe
 * secret key and the PayPal client secret move money. so those four are drawn masked and the press
 * is how they are read, rather than standing legible through a screen share for as long as the fold
 * is open. `masked` in packages/operator/src/components/forms/Field.jsx is what draws it.
 *
 * **`STRIPE_PUBLISHABLE_KEY` is deliberately not one of them.** it ships inside the donation form
 * on every page the snippet is pasted into, so a box that hid it would be hiding a value already
 * printed in the page source of every site the organisation runs.
 *
 * **`PAYPAL_CLIENT_ID` is not one of them on that same argument and never on the word in its name.**
 * it is the half of PayPal's pair that starts the SDK in a donor's browser
 * (`PaypalCredentials.clientId` in packages/app/src/lib/server/payments/paypal.ts), so it is not a
 * secret and nothing can be done with it read off this screen. `PAYPAL_WEBHOOK_ID` is the same kind
 * of value: it names a listener and authorises nothing. what is masked beside them is the client
 * secret, which authenticates every server call this deployment makes to PayPal.
 *
 * the rest are values that identify rather than authorise — a mail host, a username, the address
 * receipts leave under — and a box that made an operator press to read their own sending address
 * would be ceremony over nothing.
 *
 * the four are drawn by three different folds — ./password-fold.tsx through
 * ./secret-group-form.tsx, ./smtp-fold.tsx, and ./payments-fold.tsx with ./paypal-section.tsx — and
 * each takes its answer from here, so a fifth credential is decided once and not at whichever fold
 * draws it.
 */
export const MASKED_VALUES: readonly string[] = [
	'ADMIN_PASSWORD',
	'SMTP_PASSWORD',
	'STRIPE_SECRET_KEY',
	'PAYPAL_CLIENT_SECRET'
];

/** whether the box for `name` is drawn masked ({@link MASKED_VALUES}). */
export const isMasked = (name: string): boolean => MASKED_VALUES.includes(name);

/** the box one name's value is typed in. */
export const VALUE_FIELD = (name: string): string => `value:${name}`;
