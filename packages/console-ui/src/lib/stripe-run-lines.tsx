import type { StripeStage } from '../api/types';

// what the payments fold reads one setup press off: four subjects, the six steps that make them,
// and the mapping between the two.
//
// it is a module of its own because the mapping is the one thing about a fold that a suite in this
// package can hold, and ./stripe-run-lines.spec.ts asserts the properties tsc cannot — that each
// line's stages are one unbroken run of the chain, and that every line has stages at all.
//
// **the sentences are the chain's steps in a fundraiser's words rather than a machine's**: a line
// is read by somebody setting a deployment up, and a stage name off the wire is a word about the
// binary's own plumbing.
//
// **every one of these is a step the console genuinely observed**: each is the chain arriving at a
// call it makes itself, which is observed by having made it (`packages/console/internal/stripe`).
// nothing is timed, counted or interpolated to manufacture motion.

/**
 * the four subjects one press is about, in the order the chain reaches them.
 *
 * **they are drawn while the press runs and nowhere before it.** four lines naming four things
 * that may not exist yet, standing over the button that would make them, is a promise read before
 * anybody asked for one — so at rest the fold is two boxes, one reading and the press.
 *
 * **a line's sentence is its subject and never the step it is in.** the steps stand under the line
 * as their own run ({@link STEP}), so a line that swapped its sentence for the working step's would
 * be printing that step twice, six words apart — and a line whose subject is one step draws no
 * steps at all, which is the same duplication read the other way round and is the ledger's own rule
 * rather than this module's (packages/operator/src/components/status/StatusLine.jsx).
 *
 * the first line is the one an operator has to read even when nothing is wrong: naming the account
 * is the only point in the whole product where anybody is told which Stripe account the keys they
 * pasted belong to, and the fold draws that name at its head.
 *
 * **the middle line is everything the press establishes between the two hosts, and it is one line
 * because none of the three steps under it is a thing an operator holds on its own**: the endpoint,
 * the secret that proves a delivery came from it, and the key the donation form is served with
 * either all stand or the press stopped at one of them. its steps carry a sentence each
 * ({@link STEP}), which is what keeps the line and its steps apart.
 *
 * **it names the webhook, which is the one machine's word on the ledger, and its note is what earns
 * that.** it is the word Stripe's own dashboard files this under, so an operator who goes looking
 * for what this press made finds it under the same name — and a line that instead described the
 * errand read as any of the three. the note says what the thing is, which is the one question its
 * steps never answer: they say what is being done to it.
 *
 * **the two lines after the first are both `Setting up`, deliberately.** they are two things this
 * press establishes and the parallel is what tells a reader they are two, rather than one errand
 * described twice in different registers.
 *
 * **the last two lines are the steps the deployment makes and the two in front of them are not**:
 * each is a call the deployment makes with the key stored seconds earlier, so they are the two lines
 * that can fail over an edge that has not caught up
 * (`packages/console/internal/stripe/setup.go`).
 *
 * **wallet buttons are their own line rather than a step under repeating gifts.** they are two
 * different things being established, and a donor meets the absence of each in a different place —
 * one is a cadence a form does not offer, the other is a button that never appears.
 */
export const SUBJECTS = [
	{
		id: 'keys',
		label: 'Checking your keys',
		note: 'The account they belong to is the one this deployment charges on.'
	},
	{
		id: 'telling',
		label: 'Setting up the webhook',
		note: 'How Stripe tells this deployment that a gift has been paid.'
	},
	{
		id: 'repeating',
		label: 'Setting up repeating gifts',
		note: 'Stripe collects a monthly or yearly gift against a single item on your account.'
	},
	{
		id: 'wallets',
		label: 'Setting up wallet buttons',
		note: 'Stripe draws Apple Pay, Google Pay and Link only on sites registered on your account.'
	}
] as const;

/**
 * the one line a publish draws, which is none of the three above.
 *
 * a publish is the last step of the chain alone (./stripe-keys.ts): no Stripe call is made and
 * nothing on the account is touched, so the line those steps stand under would name a host this
 * press never reached — and the two steps beside it, both behind the one it runs, would be drawn
 * `Done` under a press that made neither.
 */
export const PUBLISHED = {
	id: 'published',
	label: 'Publishable key',
	note: 'Goes onto your deployment, where the donation form reads it.'
} as const;

/**
 * how far the press has got, as one of the four lines reads it.
 *
 * six stages under four lines, because the lines are the four things being established and the
 * stages are the steps that establish them (`packages/console/internal/stripe`). one line is
 * working for three stages running, and the steps standing under it are what tell them apart
 * ({@link STEP}).
 *
 * **the mapping is contiguous and the order of this literal is the chain's order.** a line lights
 * when the run reaches its first stage and goes out when the run leaves its last, so a line whose
 * stages were not one unbroken run would light twice. ./stripe-run-lines.spec.ts is what holds
 * that, and {@link STAGES} is this literal's key order read back.
 *
 * **the publishable key is filed with the endpoint rather than on a line of its own.** an operator
 * reading the ledger is watching one errand against two hosts, and three of its six steps are
 * things they neither choose nor can be left holding singly — so what the middle line reports is
 * whether that errand stands, and the steps under it are where it got to.
 */
export const REACHED: Record<StripeStage, number> = {
	naming: 0,
	registering: 1,
	storing: 1,
	publishing: 1,
	repeating: 2,
	covering: 3
};

/**
 * the six in the order the chain reaches them, which is the order {@link REACHED} is written in.
 *
 * a javascript object keeps its string keys in insertion order, so the literal above is the one
 * statement of both the mapping and the order and there is no second list to drift from it. what
 * makes that safe rather than clever is the case in ./stripe-run-lines.spec.ts: it asserts this run
 * never goes back to a line it has left.
 */
export const STAGES = Object.keys(REACHED) as StripeStage[];

/**
 * where the ledger stands for a press whose run has not been read yet.
 *
 * the card goes up on the press itself, and the request that starts the chain answers before the
 * reading that says it is going: that reading arrives a revalidation later, so between the two there
 * is a card and nothing to draw it from. the chain reports its first stage before it does anything
 * (`packages/console/internal/stripe`), so what stands in that gap is that stage — the key check
 * working and the two lines after it waiting, which is what the first reading lands on.
 *
 * stated rather than read off {@link STAGES}, which is a list whose first element the type says
 * nothing about; ./stripe-run-lines.spec.ts is what holds the two together.
 */
export const OPENING_STAGE: StripeStage = 'naming';

/**
 * what a step says, one sentence per stage.
 *
 * **an entry per stage, and only the ones under a line with more than one are ever drawn.**
 * `StatusLine` folds a single step into the line above it and never draws it
 * (packages/operator/src/components/status/StatusLine.jsx), because that step is the line's own
 * sentence again one line below it. the sentences it leaves undrawn are held here against a mapping
 * that may file a second stage beside them, and a record thinned to what draws today is one
 * somebody has to write again to make that change.
 *
 * **under the line that has them, this is the whole of what changes while the press runs.** the
 * labels are fixed ({@link SUBJECTS}) and the marks only move three times in minutes, so a run that
 * reported nothing else would leave one line spinning under an unchanging sentence for most of it
 * — which is the reading an operator cannot tell apart from a hung process.
 */
export const STEP: Record<StripeStage, string> = {
	naming: 'Asking Stripe which account these keys belong to.',
	registering: 'Telling Stripe where to send word of a payment.',
	storing: 'Storing what proves those messages came from Stripe.',
	// the key is named rather than pointed at: the line above this step is about the endpoint, so
	// an "it" here would be read as that.
	publishing: 'Setting your publishable key on this deployment.',
	repeating: 'Adding what a monthly or yearly gift is collected against.',
	covering: 'Registering this deployment’s sites for wallet buttons.'
};
