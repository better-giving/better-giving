import type { OrgProfileField } from '@better-giving/operator/console/org';
import type { MarkName } from '@better-giving/operator/components/status/Mark';
import type { DeployValueName } from '@better-giving/operator/deploy-split';
import type { SetupFoldId, SetupJobId, SetupJobState } from '@better-giving/operator/setup-folds';
import { FOLD_LABELS, JOB_NOTES, JOB_WORDS } from '@better-giving/operator/setup-folds';
import type { HomeReading, VarsRead } from '../api/types';
import type { OrgBoxes } from './org-fields';
import { IDENTITY_BOXES, NOTIFICATION_BOXES, orgBoxes, orgRequired } from './org-fields';
import { CHARGE_PAIRS } from './processor-links';

// what each of the six folds says, decided once, here.
//
// **which face is on screen is the binary's and what a fold says is this side's**, and the seam is
// the words. the binary reads the account and the deployment and answers with a face and the values
// it was decided against (`packages/console/internal/deployment`); every label, status word and
// sentence a fold carries is `@better-giving/operator/setup-folds`'s, because the deployment draws
// the jobs among them as a reading of its own. a reading made on the other side of the wire would
// be those words spelled a second time, in a language nothing holds them level in.
//
// **five of the six folds are jobs and `sites` is not, which is what {@link sitesRow} is.** the
// dashboard is not served until every one of `SETUP_JOBS` is done, and that list does not hold the
// site list: a deployment with no website of its own gives its forms on the donation page it
// serves at its own address (CLAUDE.md → Product surface). so the fold stays — an operator who has a website
// still needs somewhere to type it — and its row carries no `Configured`/`Incomplete`, because a
// job word over something that can never be outstanding is work reported against nobody. it states
// what the list holds instead, which is what somebody deciding whether to open it wants.
//
// **there is no ordered path and no separate reading of it.** a fold already reports where its job
// stands, so a ledger of the same reports beside them is the page read twice. what is left is the
// six folds: the dashboard password, and then five more in the order of what has to be true before
// the next thing can be — who the receipt is from, what takes the money, where else the form is
// allowed to run, what carries the mail out, and where the mail this deployment sends *you*
// lands. that last one is last because it is the only row worth nothing on its own: an address is
// where alerts arrive, and nothing arrives until something carries them.
//
// **the label and the word are the whole of an ordinary row, and a sentence is what a row adds when
// its label cannot say what the job is for.** a row reading `Configured` with a consequence beside
// it is a job reported as outstanding by the only line on the page that could say otherwise, and
// one reading `Incomplete` over a sentence saying so is that word spelled twice. which rows carry
// one is `@better-giving/operator/setup-folds`'s.
//
// **a fold held up by another fold says nothing about it on its row.** the deployment stores the
// organisation's profile whole, so there is no press that saves a notification address onto a
// deployment holding no identity — and the row still reads `Incomplete` over the sentence saying
// what the fold is for, because that is what stands there whichever fold the operator opens
// first. the press is what names the other fold, at the moment it is refused over that fold's
// boxes (./org-write.tsx).
//
// **the password is not one of the five, and that is what puts it in front of them.** the five are
// steps towards a donation; that one is how the operator gets into the dashboard at all and answers
// to nothing in the run. read in front of it, it is the credential the page opens with; read at any
// position inside it, it would say a gift was waiting on it.
//
// **the console derives no capability, and there is nothing sent it could derive one from.** every
// reading below is the console's own fact — a credential slot filled, a profile stored, a site
// listed — read off what the binary answered. the deployment's report carries rows and mail values
// and no reading of any of them.
//
// `BETTER_AUTH_URL` has no fold and no box. the app falls back to the origin a request arrived on
// when nothing is pinned (`packages/app/src/lib/server/auth/index.ts`), so a box would only create a
// way to be wrong and a press would be a full deploy of this repository for it; pinning one is the
// escape hatch DEPLOY.md documents.
//
// every input is a value and nothing here reaches a network, so ./home-sections.spec.ts looks at
// all of it without a cloudflare account or a deployment.

/**
 * one of the six things the page folds, in the order they are drawn.
 *
 * the set is `@better-giving/operator/setup-folds`'s, because the deployment reads the jobs among
 * them under the same names. under this name here, because each id also names its own module on
 * this surface:
 * ./password-fold.tsx, ./org-fold.tsx, ./processor-rows.tsx, ./sites-fold.tsx, ./smtp-fold.tsx,
 * ./notifications-fold.tsx. a run whose ids and modules stop matching is a page nobody can read the
 * order off.
 */
export type SectionId = SetupFoldId;

/**
 * what the console found out about one job.
 *
 * there is no third member. a read that did not land is not a job found undone, and it blocks the
 * page rather than reaching a fold at all (`Blocked` in ../api/types.ts).
 */
export type SectionState = SetupJobState;

/**
 * the tones a fold's row takes, which is the closed set the shared ledger draws.
 *
 * `note` is the one a job never takes: it is what the sites row reads under, because that row
 * states a fact rather than reporting an outcome, and nothing about it is owed. what shape it wears
 * is a separate question from what ink it is in ({@link sitesRow}).
 */
export type SectionTone = 'done' | 'attention' | 'note';

/**
 * one fold's whole row: the label, the mark's tone, the word beside it and the consequence.
 *
 * `state` is `null` on the one fold that is no job, and the word beside it is a statement about
 * what the fold holds rather than a state at all — or `null`, where the fold's own first row says
 * the whole of it ({@link sitesRow}). every job row carries one.
 *
 * `mark` is the shape where the tone's own would say the wrong thing, and it is set on that same
 * one row. every other row leaves it unset and reads the shape its tone chooses.
 *
 * `note` is `null` wherever the label and the word say the whole of it — every fold that is
 * `ready`, and the unfinished ones whose label already names what the job is for.
 */
export type HomeSection = {
	readonly id: SectionId;
	readonly state: SectionState | null;
	readonly label: string;
	readonly tone: SectionTone;
	readonly mark?: MarkName;
	readonly word: string | null;
	readonly note: string | null;
};

/**
 * what each fold is called, re-exported from where both operator surfaces read them.
 *
 * DEPLOY.md sends an operator to four of these names and ../every-fold-named.spec.ts holds those
 * two spellings together, reading the labels off the record rather than off any file's text.
 */
export { FOLD_LABELS };

/** the ordinary tone each job state takes. */
const TONES: Record<SectionState, SectionTone> = {
	ready: 'done',
	todo: 'attention'
};

/**
 * the one row that is a way in rather than a job, so it says what is behind the fold instead of how
 * it stands.
 *
 * a count and not the addresses: the fold itself renders every one of them, and a row repeating the
 * list is the fold drawn twice on a page where five other rows are one line each. `Incomplete` is
 * not one of the words because nothing is owed — a deployment that has typed no site gives on the
 * donation page it serves at its own address, which is a state to leave alone as often as it is one
 * to change.
 *
 * **the ink says nothing is owed and the shape says nothing is finished.** the ledger has two
 * shapes — a tick and an unfilled outline — and a third notation here would be one a reader has to
 * learn before the word beside it tells them the same thing, so the row wears the outline the
 * unfinished rows wear and keeps the `note` ink that says it is a statement rather than a job. it
 * wears that outline whether or not a site is listed: the fold is a way in and there is always
 * another address an operator could add, so a tick over `3 listed` would report a job finished that
 * was never open.
 *
 * **the count is the typed list and the donation page is not in it.** the fold draws that page as
 * its first row, locked (./sites-fold.tsx), and the count is still the addresses an operator typed:
 * the page is on no site row and on no form's allowed origins (CLAUDE.md → Product surface), so a
 * count including it would report the deployment as holding one site more than it holds. where
 * nothing is typed the row carries no word at all: `None listed` over a fold that draws that page
 * is the row contradicting the fold it is a way into, and a word naming the page is the fold's
 * first row read out on the way in. `None listed` is still the word where there is no such page
 * to draw.
 *
 * the stored list is the whole of it and the spam widget behind it is not read: no fold sets that
 * widget — it is made by the first deploy and levelled by the save — so a row counting it would
 * report trouble the page offers no way to see or repair.
 */
function sitesRow(sites: readonly string[], donatePage: string): HomeSection {
	const word =
		sites.length > 0 ? `${sites.length} listed` : donatePage === '' ? 'None listed' : null;
	return {
		id: 'sites',
		state: null,
		label: FOLD_LABELS.sites,
		tone: 'note',
		mark: 'circle-dashed',
		word,
		note: null
	};
}

/**
 * every name the deployment holds a value under, and none over a read that did not land.
 *
 * a name held in a form nothing can read back is a name that is set: its value cannot be drawn
 * in a box, which is the one thing `withheld` says and the one thing this reading does not need.
 * the payments fold's rows read the same set (./processor-links.ts), so its row word and the
 * `Not set up` beside each processor cannot disagree.
 */
export function heldNames(read: VarsRead): ReadonlySet<string> {
	const vars = read.kind === 'read' ? read.vars : [];
	return new Set(vars.filter((row) => row.kind !== 'absent').map((row) => row.name));
}

/**
 * the six rows, from the reading the binary answered with.
 *
 * **a door that did not answer never reaches here.** the seventeen values come off the account in
 * one read that is scoped to no fold, so a console that could not take it draws no fold at all —
 * the face is `blocked` and this is not called. `heldNames`'s empty fallback is what that arm would
 * read as, and it is stated rather than asserted because an assertion is a way for this to throw
 * inside a render.
 */
export function readSections(read: HomeReading): readonly HomeSection[] {
	const held = heldNames(read.values.vars);
	const configured = (...names: readonly DeployValueName[]): SectionState =>
		names.every((name) => held.has(name)) ? 'ready' : 'todo';

	/** the first of several alternatives being met, which is what the payments row is read as. */
	const either = (...alternatives: readonly SectionState[]): SectionState =>
		alternatives.includes('ready') ? 'ready' : 'todo';

	// the profile as the deployment holds it, which is what the two folds that edit it are read
	// against. an empty box is the whole reading — what a value may be is the deployment's, in one
	// parse inside the worker.
	const boxes: OrgBoxes = orgBoxes(read.org);

	/** every box one fold draws that the deployment refuses blank is holding something. */
	const stated = (fields: readonly OrgProfileField[]): SectionState =>
		fields.every((field) => !orgRequired(field) || boxes[field] !== '') ? 'ready' : 'todo';

	const identity = stated(IDENTITY_BOXES);

	const states: Record<SetupJobId, SectionState> = {
		// the credential of the pair an operator types: the one that opens the dashboard for the
		// operator who set the deployment up. colleagues are invited from the dashboard's members
		// screen and set their own, and none of those is a job here. `BETTER_AUTH_SECRET` is in the
		// same group and is not read here: it is minted on the first deploy and typed by nobody
		// (./secret-groups.ts), so a row that waited on it would report this console's own machinery
		// as a job an operator had left undone.
		password: configured('ADMIN_PASSWORD'),
		organisation: identity,
		// the pair one processor charges on, and a deployment holding either pair can take a gift.
		// **it is the same reading the deployment makes** (`CHARGE_PAIRS` in
		// packages/app/src/lib/server/config/readiness.ts), because the two sides report one job: a
		// console holding a longer list is a screen saying `Incomplete` over a deployment that has
		// already served the gate aside and is taking gifts.
		//
		// **neither webhook value is on a pair.** without one a settled charge is never heard about,
		// which is what stops a repeating gift being written down — but a one-off gift is still
		// charged, and this row answers whether one can be. the payments fold is where the difference
		// between the two is drawn and acted on (./stripe-section.tsx, ./paypal-section.tsx).
		payments: either(configured(...CHARGE_PAIRS.stripe), configured(...CHARGE_PAIRS.paypal)),
		// `SMTP_PORT` is deliberately not here. 465 is the only port the deployment dials and an
		// absent one means 465, so there is nothing an operator sets — the fold states the value
		// rather than asking for it (./smtp-fold.tsx), and a row waiting on the name would report a
		// deployment that sends mail perfectly well as a job left undone.
		// cloudflare's own answer and nothing else, which is the same answer the fold seeds its four
		// boxes from: two readings of one row are two answers able to disagree about whether mail is
		// set up.
		smtp: configured('SMTP_USERNAME', 'SMTP_PASSWORD', 'SMTP_HOST', 'MAIL_FROM'),
		// blank is not a preference here: alerts nobody addressed reach the logs and no person, so
		// the address is wanted (./org-fields.ts's `orgRequired`) while the save still takes it
		// empty. it waits on the identity because the profile is stored whole, so this press cannot
		// land on a deployment holding none.
		notifications: identity === 'ready' ? stated(NOTIFICATION_BOXES) : 'todo'
	};

	// the record's own order, which is the order the page draws and the one both surfaces list the
	// jobs in.
	return (Object.keys(FOLD_LABELS) as SectionId[]).map((id) =>
		id === 'sites'
			? sitesRow(read.sites, read.donatePage)
			: {
					id,
					state: states[id],
					label: FOLD_LABELS[id],
					tone: TONES[states[id]],
					word: JOB_WORDS[states[id]],
					note: note(id, states[id])
				}
	);
}

/**
 * what one job's row says under its label, or nothing where the label and the word are the whole of
 * it.
 *
 * a fold that is done draws none: a sentence beside `Configured` would be a job reported as
 * outstanding by the only line able to say otherwise. an unfinished one draws the one sentence its
 * label cannot say for itself, where `@better-giving/operator/setup-folds` states one.
 */
function note(id: SetupJobId, state: SectionState): string | null {
	if (state === 'ready') return null;
	return JOB_NOTES[id] ?? null;
}
