/**
 * the names of the six set-up folds an operator meets, and the five of them a deployment's set-up
 * is read as.
 *
 * one spelling, so the place an operator is sent to and the sentence sending them there call it
 * the same thing: packages/app/src/lib/server/config/readiness.ts reads the five as a reading and
 * offers no control, and the mail and form refusals under packages/app/src/lib/server/ name
 * {@link IDENTITY_FOLD}.
 *
 * **the folds and the jobs are two lists, and {@link SETUP_JOBS} is the shorter one.** a fold is
 * somewhere an operator opens and edits; a job is something a deployment's set-up is read as
 * unfinished without. `sites` is a fold and no job: a deployment with no website of its own still
 * takes gifts, on the donation page it serves at /donate (AGENTS.md → Product surface). so an empty
 * list is a list nobody has added to rather than set-up left unfinished, and reaching for the six
 * where the five are meant reads a working deployment as unfinished for as long as the
 * organisation has no website.
 *
 * what is not here is how a job's state is found out: the deployment reads the values it was
 * started with and its own rows. this module holds the vocabulary and no logic.
 */

/**
 * one of the six folds.
 *
 * an id is a slot rather than a label: the deployment reads one line for each of
 * {@link SETUP_JOBS} and takes each line's label from {@link FOLD_LABELS}.
 */
export type SetupFoldId =
	| 'password'
	| 'organisation'
	| 'payments'
	| 'sites'
	| 'smtp'
	| 'notifications';

/**
 * the five jobs a deployment's set-up is read as, in the order it reads them.
 *
 * a list rather than a subtraction from {@link SetupFoldId}, because the order is what the
 * deployment reads its lines in and a union carries none. `satisfies` is what holds the two lists
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
 * what the deployment found out about one job.
 *
 * there is no third member. a read that did not land is not a job found undone, and the deployment
 * reads nothing that can fail to answer.
 */
export type SetupJobState = 'ready' | 'todo';

/**
 * the fold an operator opens to find one of the organisation profile's boxes, in the words that
 * fold carries.
 *
 * two names rather than two entries in the record below, because a refusal on a profile box names
 * the fold to go and open, and a fold called one thing where it stands and another in the sentence
 * sending somebody to it is a scavenger hunt.
 */
export const IDENTITY_FOLD = 'Organisation details';
export const NOTIFICATIONS_FOLD = 'Notifications';

/**
 * what each fold is called wherever it is drawn.
 *
 * all six, so a fold that is no job still has its one spelling. the deployment reads its lines off
 * {@link SETUP_JOBS} and takes each label from here.
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
 * **a status word has to read standing on its own.** a job's line is read on its own, and an
 * operator lands on it without the other four in front of them. `Not yet` and `None yet` only say
 * anything while a reader is scanning top to bottom and can see they are the odd ones out; alone
 * beside a label, they are a word to work out rather than a state to act on. `Configured` and
 * `Incomplete` each say the whole thing on their own line.
 */
export const JOB_WORDS: Record<SetupJobState, string> = {
	ready: 'Configured',
	todo: 'Incomplete'
};
