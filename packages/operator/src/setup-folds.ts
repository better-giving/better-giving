/**
 * the folds both operator surfaces name, and the five of them a deployment's set-up is read as.
 *
 * it is here rather than in either surface because two of them say these words. the console draws
 * a fold per id with the control that finishes it
 * (packages/console-ui/src/lib/home-sections.ts); the deployment draws the jobs among them as a
 * reading and offers no control at all (packages/app/src/lib/server/config/readiness.ts). a second
 * spelling is how the two would come to disagree about what a job is called while both were right
 * about its state.
 *
 * **the folds and the jobs are two lists, and {@link SETUP_JOBS} is the shorter one.** a fold is
 * somewhere an operator opens and edits; a job is something the dashboard is not served until it is
 * done. `sites` is a fold and no job: a deployment with no website of its own still takes gifts, on
 * the donation page it serves at its own address (CLAUDE.md → Product surface), and the spam widget
 * is registered against the deployment's own host by a first deploy that asks for no site at all
 * (packages/console/internal/first). so an empty list is a list nobody has added to rather
 * than set-up left unfinished, and a gate waiting on one would hold a working deployment's
 * dashboard shut for as long as the organisation has no website. reaching for the six where the
 * five are meant is exactly that gate.
 *
 * what is not here is how either surface finds a job's state out. the console reads cloudflare over
 * a credential on the operator's own machine; the deployment reads the values it was started with
 * and its own rows. the two answer the same question from different facts, and neither reading is
 * the other's to borrow — which is why this module holds the vocabulary and no logic.
 */

/**
 * one of the six folds, in the order the console draws them.
 *
 * an id is a slot in that order rather than a label. the console names its own module per id
 * (packages/console-ui/src/lib/home-sections.ts); the deployment draws one row for each of
 * {@link SETUP_JOBS} and names none.
 */
export type SetupFoldId =
	| 'password'
	| 'organisation'
	| 'payments'
	| 'sites'
	| 'smtp'
	| 'notifications';

/**
 * the jobs the dashboard is not served until every one of them is done, in the order both surfaces
 * read them.
 *
 * a list rather than a subtraction from {@link SetupFoldId}, because the order is what the
 * deployment draws its rows in and a union carries none. `satisfies` is what holds the two lists
 * level: a job that is no fold has no label to be drawn under, and fails here.
 */
export const SETUP_JOBS = [
	'password',
	'organisation',
	'payments',
	'smtp',
	'notifications'
] as const satisfies readonly SetupFoldId[];

/** one of the five, which is every fold but `sites`. */
export type SetupJobId = (typeof SETUP_JOBS)[number];

/**
 * what a surface found out about one job.
 *
 * there is no third member on either side. a read that did not land is not a job found undone: the
 * console blocks its whole page on one, and the deployment reads nothing that can fail to answer.
 */
export type SetupJobState = 'ready' | 'todo';

/**
 * the ledger row an operator opens to find one of the organisation profile's boxes, in the words
 * that row carries.
 *
 * two names rather than two entries in the record below, because a refusal on a profile box names
 * the row to go and open — packages/console-ui/src/lib/org-fields.ts's `boxFold` — and a row called
 * one thing on the ledger and another in the sentence sending somebody to it is a scavenger hunt.
 */
export const IDENTITY_FOLD = 'Organisation';
export const NOTIFICATIONS_FOLD = 'Notifications';

/**
 * what each fold is called wherever it is drawn.
 *
 * all six, because the console draws all six — the deployment reads its rows off
 * {@link SETUP_JOBS} and takes each label from here.
 *
 * DEPLOY.md sends an operator to four of these names, and
 * packages/console-ui/src/every-fold-named.spec.ts holds those two spellings together — reading the
 * labels off this record rather than off any file's text.
 */
export const FOLD_LABELS: Record<SetupFoldId, string> = {
	password: 'Dashboard password',
	organisation: IDENTITY_FOLD,
	payments: 'Donation processor',
	sites: 'Which sites your forms go on',
	// spelled here rather than beside the two above: those two name rows a refused profile box
	// sends an operator to, and this job draws none of them. `SMTP` is a protocol and names no job,
	// which is why the note below is the one that has to say which jobs wait on it.
	smtp: 'SMTP',
	notifications: NOTIFICATIONS_FOLD
};

/**
 * the sentence a row carries where its label cannot say what the job is for, and there are two.
 *
 * a note is drawn only beside `Incomplete`, so a sentence saying that the job is unfinished is the
 * word beside it spelled a second time. three labels above name what their job is for and stand
 * on their own. `SMTP` names a protocol, so the mail an operator is being asked to set up is the
 * one fact that row cannot carry by itself; `Notifications` names a kind of message and not who
 * it reaches, and the address behind the fold is the operator's own rather than a donor's.
 *
 * keyed by job rather than by fold: the sites row is never `Incomplete`, so a sentence stated
 * against it would be one nothing could draw.
 */
export const JOB_NOTES: Partial<Record<SetupJobId, string>> = {
	smtp: 'So this deployment can send email on your behalf: receipts to donors, and notice to you.',
	notifications:
		'Where this deployment reaches you about the donations it takes and anything that goes wrong.'
};

/**
 * the word one job's state is read under: two words for two states, and not a word per job.
 *
 * **a status word has to read standing on its own.** on the console the row is a shut fold and on
 * the deployment it is one line of a list, and an operator lands on either without the other four
 * in front of them. `Not yet` and `None yet` only say anything while a reader is scanning top to
 * bottom and can see they are the odd ones out; alone beside a label, they are a word to work out
 * rather than a state to act on. `Configured` and `Incomplete` each say the whole thing on their
 * own line, and being the same two words on both surfaces is what lets an operator who has met one
 * of them read the other without learning it twice.
 */
export const JOB_WORDS: Record<SetupJobState, string> = {
	ready: 'Configured',
	todo: 'Incomplete'
};
