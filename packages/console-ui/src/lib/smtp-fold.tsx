import { AnchoredNote } from '@better-giving/operator/behaviour/AnchoredCard';
import { Modal } from '@better-giving/operator/behaviour/Dialog';
import { BusyDots } from '@better-giving/operator/components/controls/Button';
import { SaveButton } from '@better-giving/operator/components/controls/SaveButton';
import { InlineCode } from '@better-giving/operator/components/data/CodeSlab';
import { SettingRow } from '@better-giving/operator/components/data/SettingRow';
import { Field } from '@better-giving/operator/components/forms/Field';
import { FieldMessage } from '@better-giving/operator/components/forms/FieldMessage';
import { Section } from '@better-giving/operator/components/shell/Layout';
import { Banner } from '@better-giving/operator/components/status/Banner';
import { Mark } from '@better-giving/operator/components/status/Mark';
import { MarkedText } from '@better-giving/operator/marked-text.react';
import { expireAfter } from '@better-giving/operator/save-state';
import type { ReactNode } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { Form } from 'react-router';
import { Said } from './said';
import { unreadAnswer } from './unread-answer';
import type { MailAct, MailAfter, MailBoxAct, MailSeeds } from './smtp-fold-state';
import {
	TEST_TO_FIELD,
	TEST_TO_SAID,
	filled,
	mailAct,
	mailBoxAct,
	mailForm,
	mailHeld,
	mailSeed,
	mailUnconfigured,
	ownPress,
	sendState,
	testSendForm
} from './smtp-fold-state';
import { useReseeded } from './reseed';
import type { Box as BoundBox } from './use-console-form';
import { useConsoleForm } from './use-console-form';
import type { GroupReport } from './secret-group-form';
import { secretBox } from './secret-group-form';
import { heldValues, withheldInGroup } from './held-values';
import { refusalIn, secretTrouble } from './secret-trouble';
import { FREE_INTENT, WithheldValues } from './withheld-values';
import type { SecretGroup } from './secret-groups';
import {
	MAIL_GROUP,
	SECRET_GROUPS,
	VALUE_FIELD,
	groupIntent,
	isMasked,
	pressedNames
} from './secret-groups';
import type { AddressRead, NoReport, ValuesRefusal, VarsWritten } from '../api/types';
import type { OrgBoxes } from './org-fields';
import type { DeployedValues } from '../api/types';
import type { TestSend } from '../api/types';

// everything a deployment needs before it can send mail at all — the receipt that proves a donor's
// gift, the word to a donor whose gift could not be collected, and the notice to whoever runs the
// deployment — and the one control that says whether any of it leaves, read and set inside one
// fold of the one page.
//
// **it is one fold because it is one errand, and the credentials are one press because they are one
// act.** four of the five come off one screen at the operator's mail provider and none of them does
// anything without the others, so that section is those four boxes and a save. nothing an operator
// does to them is finished until a message lands in an inbox, which is the last section and the
// whole reason it is in this panel rather than a fold of its own.
//
// **the address the deployment reaches the operator at is not here, and is a fold of its own.**
// ./notifications-fold.tsx draws it: a column of the organisation's profile stored on the
// deployment's own database over the console session (../api/client.ts's `saveOrgProfile`), while
// these four credentials are written into cloudflare over its own API
// (`packages/console/internal/deployment/write.go`) — two stores, two write paths, and one panel
// holding both would put a row about where mail is *sent* under the row about what carries it.
// what is left in this fold is the transport and the one press that proves it.
//
// **the fifth is the port, and it is stated rather than asked for.** 465 is the only value this
// deployment dials and every other one is refused (`parseSmtpEndpoint` in
// `packages/app/src/lib/server/email/smtp-config.ts`), so there is nothing for an operator to
// decide — ../secret-groups.ts's `STATED_VALUES` is what holds it out of every reading of what a
// press would do.
//
// **it is a component and not a screen.** every read it draws was taken by ../routes/_index.tsx's
// `loader` and every press it makes is answered by that page's `action`; what this holds is the
// boxes, the presses and the sentences each answer is said in. which fold this is — its label, its
// tone, the word beside it and what stands between it and its job — is decided in ./home-sections.ts
// with the others.
//
// **a credential is stored from here, and never through the browser.** what a box posts reaches
// the binary on the loopback address, and the value goes from there into the body of one request
// to cloudflare — `packages/console/internal/deployment/write.go` is the whole of it, the address
// the value is deliberately absent from included. one press is one call, so the five land whole or
// not at all.
//
// **the box's content is the state, so nothing here says Not set.** a box over a name the
// deployment is holding is seeded from it and a box over one it is not is empty, which is a reading
// and a control in one place instead of a row above every box saying what the box could have said.
// no row and no second label: emptying a box is the removal, and it is read as one because the
// form was seeded from what is stored (./secret-edits.ts).
//
// **all four boxes hold the value the deployment is holding**, the password among them — masked
// until a press shows it, and holding the value either way (./secret-groups.ts). every one
// of them is a plain var and the account hands its value back (`DEPLOY_VARS` in
// packages/operator/src/deploy-split.ts), so an operator reads what their deployment is actually
// addressed from and can check a paste against the page they copied it from — which is the one
// thing they opened the fold to do. **a box drawn empty over a value that is there would read as
// nothing stored, and the next press would remove it**, so the boxes are drawn from the one read
// that answers for all seventeen and no box is drawn at all where that read did not land.
//
// **a name held in a form nothing can read back is the one box that cannot be typed.** it seeds
// empty over a value that is there, no save may set it, and the way out is the press that takes it
// off first (./withheld-values.tsx).
//
// **the whole explanation is in the confirm rather than on the page.** what a press will do is
// stated against the operator's own boxes, one line per value they touched, at the moment it
// changes whether they press. above the boxes it was five paragraphs read once and skipped
// afterwards, and none of it named what this press in particular would do.
//
// **and the card opens with the consequence rather than with those lines.** the boxes are on the
// screen behind it, so an operator reading a card that itemises them is reading back what they
// just typed — what they cannot see is what this deployment does differently afterwards, which is
// one of three things and is what the title and the sentence under it say ({@link MAIL_ASKS}). the
// rows stay underneath, because checking that the value in the box is the value they meant is the
// other thing the card is for.
//
// **the press is refused where it would leave the five half-set.** the group is one press or none
// (./secret-groups.ts) and nothing but this held it to that: a save carrying a username alone
// stores a credential that sends nothing, reads back as mail being set up, and closes the test send
// that would have said otherwise. what happens instead is the empty boxes marked and the operator
// put in the first of them, with no card drawn over the boxes they have to reach
// (`mailGaps` in ./smtp-fold-state.ts). emptying all of them is not that state and is never
// refused — taking mail off a deployment is a press somebody means.
//
// **the confirm cuts a typed value to its lead and the boxes cut nothing.** a box holds the value
// whole, because checking a paste character for character is what it is for; the card beside it
// itemises what the press touches, and a row there is a recognition rather than a check — a key is
// known by the prefix its provider issued, and the characters after it are ones nobody reads. a
// lead and never a tail, and no count of characters anywhere on this console.
//
// **no state about a sign-in.** a console whose cloudflare sign-in has gone draws a face of its own
// and never the folds (`blocked` in ../api/types.ts's `HomeFace`) — so a fold restating it
// would be a sentence about something the operator cannot be looking at.

/**
 * what the press that is neither a read nor a store posts.
 *
 * a literal of this fold's own rather than a member of ./deploy-vars.ts's pair, because only this
 * fold and the `action` answering it need the word: what the endpoint it reaches takes is the
 * destination and nothing else, so there is no third end to keep a vocabulary with.
 */
export const TEST_EMAIL_INTENT = 'test-email';

/**
 * the send's form, stated once: the word its press posts is the form's own id, which every box id
 * on it is composed off (./use-console-form.ts). the box and the rule under it are
 * ./smtp-fold-state.ts's.
 */
const TEST_SEND = testSendForm(TEST_EMAIL_INTENT);

/** where the cloudflare dashboard's Workers list is, for the one state repaired over there. */
const DASHBOARD = 'https://dash.cloudflare.com';

/** the one of the four this fold stores, taken out of the enumeration rather than named again. */
const MAIL_CREDENTIALS = SECRET_GROUPS.filter((group) => group.id === MAIL_GROUP);

/**
 * the four names a press carries a value for, which is the group less the port it states.
 *
 * read here rather than inside the block that draws the boxes, because the send beside that block
 * is closed off the same four ({@link mailUnconfigured}): a deployment cannot send with any one of
 * them missing, and two lists would be two answers able to disagree about whether it can.
 */
const MAIL_PRESSED = MAIL_CREDENTIALS.flatMap(pressedNames);

/**
 * what each of the five boxes in this fold is called, where the variable name is not it.
 *
 * a box's label is its whole accessible name and is reached with nothing else around it, so it has
 * to say which value it is for on its own — and on this fold that is a value the operator is holding
 * from their mail provider, under the provider's word for it, rather than under a name they typed
 * anywhere. no box on this console is labelled with a variable name — ./secret-group-form.tsx's
 * `boxLabel` is where that is argued for the blocks drawn out of the enumeration.
 *
 * the same words name the rows in the confirm, so a reader meets one vocabulary from the box to the
 * question about it.
 *
 * a name with no entry falls back to itself, which is the label every other caller gets.
 */
const MAIL_LABELS: Readonly<Record<string, string>> = {
	SMTP_USERNAME: 'Username',
	SMTP_PASSWORD: 'Password',
	SMTP_HOST: 'Mail host',
	SMTP_PORT: 'Port',
	MAIL_FROM: 'Sender email address'
};

const mailLabel = (name: string): string => MAIL_LABELS[name] ?? name;

/**
 * an example of the value each box takes, standing in the box while it is empty.
 *
 * **one provider's page rather than one shape each, and it is the provider DEPLOY.md's Email table
 * already works through.** a username, a host and a key that come off the same screen read as one
 * page of credentials; four examples from four products read as four unrelated facts. the spellings
 * here and the spellings in that table are the same values said twice, so the two are changed
 * together.
 *
 * the key is elided rather than shaped, in the idiom ./stripe-section.tsx's two use: what an
 * operator compares is the prefix their provider issued, and the rest of a key is characters nobody
 * reads.
 *
 * the port is not among them, because it is not a box anybody types in ({@link MailPort}).
 *
 * **a placeholder is an example and never a value.** nothing here is posted and nothing here is
 * seeded: a box standing on its placeholder is an empty box, which is how this form asks for a
 * stored value to be removed.
 */
const MAIL_PLACEHOLDERS: Readonly<Record<string, string>> = {
	SMTP_USERNAME: 'resend',
	SMTP_PASSWORD: 're_…',
	SMTP_HOST: 'smtp.resend.com',
	MAIL_FROM: 'donations@better.giving'
};

/**
 * the one name this fold states a value for instead of asking the operator for one.
 *
 * spelled here as well as in ../secret-groups.ts's `STATED_VALUES` because the two answer different
 * questions: that list decides what a press reads, and this decides what is drawn where the order
 * puts it. a name on that list with no block here would draw a box the press then ignores, which is
 * a value an operator types and nothing stores.
 */
const STATED_PORT = 'SMTP_PORT';

/**
 * the one name whose box carries a note.
 *
 * two boxes in this fold hold an address and neither label can say which is which on its own: this
 * one is what every message leaves under, and the notification address on the Notifications row is
 * where the deployment reaches the operator. what the note carries is that difference and the list
 * of what goes out — see {@link SenderAddress}.
 */
const SENDER = 'MAIL_FROM';

/** one line of the confirm: a value the press touches, what it does to it, and what is in the box. */
type Edit = {
	readonly name: string;
	readonly act: MailBoxAct;
	/** what the operator typed, and nothing on a removal. */
	readonly typed: string;
};

/**
 * how much of a typed value the confirm prints, counted from the front.
 *
 * long enough that the three values here that are not credentials arrive whole — a mail host, a
 * username, and a sender address on the operator's own domain — so the one value it cuts is the
 * password, which is the only one long enough to have a tail worth withholding. what a lead is for
 * is recognising the value: a key is known by the prefix its provider issued, and the characters
 * after it are ones nobody checks against anything.
 */
const CONFIRM_LEAD = 24;

/**
 * a value cut to its lead, with an ellipsis where anything was dropped.
 *
 * nothing from the tail and no count of what went: both are facts about a credential nobody asked
 * for, and a cut taken from both ends says how long the value is.
 */
const cut = (value: string): string =>
	value.length <= CONFIRM_LEAD ? value : `${value.slice(0, CONFIRM_LEAD)}…`;

/**
 * what the confirm asks, the word on the control that answers it, and the one thing the rows under
 * it cannot say — one set per act.
 *
 * **the title names the press, and the consequence names what the deployment does differently
 * afterwards.** a first setting and a switch are each a save: the press writes these values onto
 * the deployment, which takes them up at once with no build and no upload
 * (`packages/console/internal/deployment/write.go` says what that path costs), and "deploy" on
 * the title is that landing — the build-and-upload errand the same word names elsewhere is the
 * `better-giving start` command, and nothing here starts it.
 * stopping is the one act whose press is its outcome: nothing is saved, so its title names the
 * stop. a save titled only by its outcome ("start sending email") reads as the sending itself
 * happening on the press, and an operator is left asking which mail. what the boxes cannot say is
 * the consequence: this deployment begins sending on their behalf, sends through somewhere else,
 * or stops sending — and the last of those is a donor's receipt not arriving.
 *
 * **the word on the control names the save and what the save does.** a first setting replaces
 * nothing and stops nothing, so its word is the save and its landing on the deployment. switching
 * hosts and stopping altogether are each a press an operator can make without meaning to, and the
 * word is the last thing standing between them and it, so each names its errand — and a word
 * naming an errand nobody pressed is one an operator has to work out before agreeing to it.
 *
 * the words are the ones the ledger row for this job uses (`JOB_NOTES` in
 * `@better-giving/operator/setup-folds`), because it is the same errand named twice on one page.
 */
const MAIL_ASKS: Record<MailAct, { title: string; press: string; consequence: string }> = {
	starting: {
		title: 'Save and deploy these mail settings?',
		press: 'Save and deploy',
		consequence:
			'They are written to your deployment and take effect at once. It then sends email on your behalf through this host: receipts to donors, and notice to you.'
	},
	changing: {
		title: 'Save and deploy these mail settings instead?',
		press: 'Save and switch',
		consequence:
			'They replace the host in use and take effect at once. Every message this deployment sends from now on goes through these: receipts to donors, and notice to you.'
	},
	stopping: {
		title: 'Stop sending email from this deployment?',
		press: 'Stop sending',
		consequence:
			'This deployment will send no email at all: a donor gets no receipt for their gift, and nothing reaches you about the donations it takes or anything that goes wrong.'
	}
};

export type SmtpFoldProps = {
	/** the seventeen as cloudflare answered for them, which is what the five boxes are seeded from. */
	values: DeployedValues;
	workerName: string;
	/** the cloudflare account both reads are scoped to, named in every sentence about a refusal. */
	accountName: string;
	/**
	 * the organisation's profile as the deployment holds it.
	 *
	 * this fold writes none of it and reads one column: the test send is seeded from the address
	 * ./notifications-fold.tsx stores rather than from a value of its own, so the send an operator
	 * makes to check their mail host starts at the address their alerts already go to.
	 */
	stored: OrgBoxes;
	/** how the last credentials press went, or `null` where none has been made. */
	secrets: GroupReport | null;
	/** how the last press that frees a value held in a form nothing can read back went, or `null`. */
	freed: VarsWritten | null;
	/** how the last test send went, or `null`. */
	test: TestSend | null;
	/**
	 * which intent is in flight, or `null` where none is.
	 *
	 * the whole of what closes anything in this fold, and each of its two blocks reads it for its own
	 * press alone — ./smtp-fold-state.ts argues why a press in one of them leaves the other open.
	 */
	pending: string | null;
};

export function SmtpFold({
	values,
	workerName,
	accountName,
	stored,
	secrets,
	freed,
	test,
	pending
}: SmtpFoldProps): ReactNode {
	/**
	 * the test send's own press in flight, which is what holds the answer to the last one back: an
	 * outcome drawn while the next send is going is the previous send's, reported over a press
	 * already saying it is working.
	 */
	const sending = ownPress(pending, TEST_EMAIL_INTENT);

	/**
	 * what this deployment holds under each of the seventeen, or `null` where that read did not land.
	 *
	 * the send below is closed off the four mail values and the block above draws its boxes from the
	 * same four, so the two are one reading: a press drawn off anything else would stand open under
	 * an empty box (`mailUnconfigured` in ./smtp-fold-state.ts).
	 */
	const seeds = values.vars.kind === 'read' ? heldValues(values.vars.vars).seeds : null;

	/**
	 * why there was nowhere to store a credential, in the address read's own terms.
	 *
	 * the read already tells a worker that has never been deployed from an account that refused
	 * this sign-in from a cloudflare nothing could reach, and each of those has a different way
	 * out — so this carries that answer rather than translating it into one sentence about storing.
	 *
	 * every refusal this fold draws stands on its own rather than under a box, this one first: what
	 * came back is about a press, and `Field` draws its rows only under the box it labels — the
	 * control here is a submit button and there is no box to hang one off. the row itself is
	 * `@better-giving/operator/components/forms/FieldMessage`, which is what announces it; a
	 * paragraph nothing announces leaves the operator with a button that did nothing they were told
	 * about.
	 */
	const nowhere = (address: AddressRead) =>
		address.kind === 'not-deployed' ? (
			// the same race the block below meets on its own read, met by a press instead: the Worker
			// answered this console a moment ago and is not in the account now.
			<FieldMessage>
				No Worker called {workerName} is in {accountName} any more, so there was nowhere to write
				this. Nothing was stored. Reload this page.
			</FieldMessage>
		) : address.kind === 'deployed' ? (
			<FieldMessage>
				This deployment answers on no address at all, so there's nowhere to reach it. Turn its{' '}
				<InlineCode>workers.dev</InlineCode> address back on, or attach a domain, at{' '}
				<a href={DASHBOARD} target="_blank" rel="noreferrer">
					dash.cloudflare.com
				</a>{' '}
				&rarr; Compute (Workers), then try again.
			</FieldMessage>
		) : (
			<>
				<FieldMessage>
					{address.kind === 'no-credential'
						? "This machine isn't signed in to Cloudflare any more, so the console can't work out where this deployment answers. Reload this page to sign in again."
						: address.kind === 'refused'
							? `Cloudflare won't tell this sign-in about the Workers in ${accountName}.`
							: "Cloudflare didn't answer about this Worker, so the console can't say where to reach it."}{' '}
					Nothing was written.
				</FieldMessage>
				<Said answer={address} />
			</>
		);

	/**
	 * what the credentials write said, in this fold's words for it.
	 *
	 * `nowhere` is handed to the same reader every other refused write uses: the write is refused by
	 * the same three states of the same address read, and each of those has its own way out.
	 *
	 * announced at the control that was pressed — see {@link nowhere} for why the region is written
	 * here rather than taken from the shared `Field`.
	 */
	const wrote = secretTrouble({ workerName, accountName, nowhere });

	/**
	 * a press the deployment answered no report to.
	 *
	 * the session states say to reload rather than offering a press: this fold is drawn on the one
	 * face that already holds a session, so a session refused between the page load and the press is
	 * a page whose next reading draws the connect press itself (../routes/_index.tsx). the two that
	 * are neither say the one thing this console genuinely does not know — the deployment may have
	 * sent the message anyway, so the way out is an inbox rather than a second press.
	 */
	const unanswered = (read: NoReport) => (
		<>
			<Banner tone="blocker" word="Nothing came back">
				{read.kind === 'no-session' ? (
					'This console is no longer connected to this deployment, so it could not ask it for anything. Reload this page and connect again.'
				) : read.kind === 'refused' ? (
					<>
						This deployment turned this console session down, so nothing was sent.
						{/* the deployment's own sentence, drawn rather than spliced into this one as
						    text: it marks the variable name and the command in it
						    (`@better-giving/operator/code-spans`). */}
						{read.message === null ? null : (
							<>
								{' '}
								<MarkedText text={read.message} />
							</>
						)}{' '}
						Reload this page and connect again.
					</>
				) : read.kind === 'no-surface' ? (
					"Something is deployed at that address and it isn't answering this console, so nothing was sent. It is either older than this console or not this deployment at all."
				) : read.kind === 'unreachable' ? (
					"The console couldn't get an answer out of this deployment, so it can't say whether the message went. Check the inbox before pressing again."
				) : (
					`${unreadAnswer("it can't say whether the message went")} Check the inbox before pressing again.`
				)}
			</Banner>
			{read.kind === 'unreachable' || read.kind === 'unreadable' ? <Said answer={read} /> : null}
		</>
	);

	/**
	 * what the last press said, under the button that made it — and nothing at all where it went.
	 *
	 * a send that worked is reported by the button, in place, the way every other write on these
	 * surfaces is (`@better-giving/operator/components/controls/SaveButton`), and a destination the
	 * deployment refused is reported at the box holding it. what is left here is every answer
	 * neither of those two can carry: the message did not go, or nothing came back at all.
	 */
	const testOutcome = (): ReactNode => {
		if (test === null) return null;
		if (test.kind === 'unanswered') return unanswered(test.read);
		// drawn at the box instead — see {@link TestSendForm}.
		if (test.kind === 'bad-address') return null;

		const report = test.report;
		if (report.outcome === 'sent') return null;
		// the one arm left did not deliver, and it may not be softened into a notice: sending nothing
		// is not a setting, so there is no way to press this and send none without something being
		// wrong. the deployment's own sentence names the value to fix.
		return (
			<>
				<Banner tone="blocker" word="Nothing was sent">
					This deployment could not hand the message to a mail host.
				</Banner>
				{report.detail === null ? null : (
					<p className="adm-prose">
						<MarkedText text={report.detail} />
					</p>
				)}
			</>
		);
	};

	/** the sentence a read that answered nothing gets, whichever door it came back through. */
	const trouble = (read: DeployedValues['vars']) => {
		if (read.kind === 'read' || read.kind === 'not-deployed') return null;
		return (
			<>
				<p className="adm-prose">
					{read.kind === 'refused'
						? `Cloudflare won't tell this sign-in what ${accountName} is holding.`
						: read.kind === 'no-credential'
							? "This machine isn't signed in to Cloudflare any more, so nothing here could be read. Reload this page to sign in again."
							: read.kind === 'unreachable'
								? "Cloudflare didn't answer, so nothing was found out either way."
								: "Cloudflare answered in a way this console couldn't read."}
				</p>
				<Said answer={read} />
			</>
		);
	};

	return (
		<div className="adm-stack">
			{/* a list of one, drawn by mapping: an id that stops matching the enumeration draws no
			    boxes rather than throwing at an operator who came to read them. */}
			{MAIL_CREDENTIALS.map((group) => (
				<MailSettings
					key={group.id}
					group={group}
					vars={values.vars}
					freed={freed}
					workerName={workerName}
					accountName={accountName}
					report={secrets}
					pending={pending}
					trouble={trouble}
					wrote={wrote}
				/>
			))}

			{/* the one control on the console that asks whether mail actually leaves: readiness can say
			    the settings are set and well-formed without saying a message is delivered, and a
			    deployment whose mail is quietly broken takes gifts and tells nobody. one send answers
			    for all three messages, because a host that will not take one will not take the others.
			    it is drawn in every state of the block above, because it asks the deployment over its
			    own mail transport (../api/client.ts's `sendTestEmail`) and reaches Cloudflare not at all — a
			    Cloudflare read that was refused says nothing about whether mail works, and this is the
			    moment that answer is wanted most.

			    no heading over it: it is one control, and a title over one control names what the
			    control already says. what separates it from the boxes above is the section boundary
			    alone, which packages/operator/src/styles/adm.css draws at `.adm-section +
			    .adm-section`. */}
			<Section>
				<TestSendForm
					/* re-seeded when the address on the Notifications row is saved: the box takes its
					   starting value on mount, so without this a send made after a save would go to the
					   address that was there when the panel opened. */
					key={stored.notification_email}
					notificationEmail={stored.notification_email}
					test={test}
					/* the boxes above are the whole of what says why the press is closed, so nothing here
					   is a sentence: a fold drawing a send nothing can leave through is drawing the empty
					   boxes it would leave through directly above it. */
					unconfigured={mailUnconfigured(MAIL_PRESSED, seeds)}
					pending={pending}
				/>
				{sending ? null : testOutcome()}
			</Section>
		</div>
	);
}

/**
 * the five boxes and the one press that stores them.
 *
 * a component of its own because it keeps three things the fold around it must not see — the form
 * element a landed save empties, the reading of whether there is anything in it to save, and the
 * confirm it is holding open.
 */
function MailSettings({
	group,
	vars,
	freed,
	workerName,
	accountName,
	report,
	pending,
	trouble,
	wrote
}: {
	group: SecretGroup;
	vars: DeployedValues['vars'];
	freed: VarsWritten | null;
	workerName: string;
	accountName: string;
	report: GroupReport | null;
	/** which intent the page has in flight, or `null`; this block is closed by its own and no other. */
	pending: string | null;
	trouble: (read: DeployedValues['vars']) => ReactNode;
	/** what a failed write says, in the words the fold holding the account name has for it. */
	wrote: (written: ValuesRefusal) => ReactNode;
}): ReactNode {
	/* what cloudflare says this deployment is holding, which is what every box below is drawn with
	   and what every reading of one is made against (./held-values.ts). memoised because the schema
	   is built from it and nothing else, so a record rebuilt at every render would be a schema
	   rebuilt at every keystroke. */
	const held = useMemo(() => heldValues(vars.kind === 'read' ? vars.vars : []), [vars]);

	const errors = report !== null && 'errors' in report ? report.errors : null;
	const written = report !== null && 'written' in report ? report.written : null;
	/* the failure inside that answer, or nothing: the arms that changed something, found nothing to
	   change, or refused over a value held in a form nothing can read back are each drawn elsewhere
	   (`refusalIn` in ./secret-trouble.tsx). */
	const failure = written === null ? null : refusalIn(written);
	const intent = groupIntent(group);
	/* this block's own request in flight: the send beside it writes somewhere else and takes nothing
	   away from these boxes, so it holds none of them ({@link ownPress} in ./smtp-fold-state.ts).
	   what the boxes and the button are closed for is longer than this and is {@link underway}. */
	const storing = ownPress(pending, intent);
	const names = filled(group.names);
	/* the four a press carries a value for, which is every reading below. the port is drawn among
	   them and is in none of them: a name with no box behind it comes back empty, and empty is how
	   this form asks for a stored value to be removed. */
	const pressed = filled(pressedNames(group));

	const seeds: MailSeeds = held.seeds;

	/* this form's own rules, which are what the boxes are read against before anything is sent —
	   `mailGaps` mounted for these seeds (./smtp-fold-state.ts). */
	const stated = useMemo(() => mailForm(group, seeds), [group, seeds]);

	/** what one box holds at the moment of a press, which is what every reading below is made of. */
	const typedIn = (element: HTMLFormElement, name: string): string => {
		const box = element.elements.namedItem(VALUE_FIELD(name)) as HTMLInputElement | null;
		return box?.value ?? '';
	};

	/**
	 * what the deployment holds under each of the four once the press lands.
	 *
	 * read off each box's own act against its own seed, which is the same reading the confirm's rows
	 * are built from and the same one the schema is: a box untouched leaves whatever it was drawn
	 * over, an emptied one leaves nothing, and anything else leaves what is in it
	 * (`mailHeld` in ./smtp-fold-state.ts).
	 */
	const after = (element: HTMLFormElement): readonly MailAfter[] =>
		pressed.map((name) => ({ name, held: mailHeld(seeds, name, typedIn(element, name)) }));

	/** whether the deployment is holding every one of them now, which is what makes a press a change. */
	const holding = pressed.every((name) => mailSeed(seeds, name) !== '');

	const asked = (element: HTMLFormElement): readonly Edit[] =>
		pressed.flatMap((name) => {
			const typed = typedIn(element, name);
			const which = mailBoxAct(seeds, name, typed);
			return which === null ? [] : [{ name, act: which, typed }];
		});

	/**
	 * the deployment's own answer carried onto the boxes this form draws, or `null` where it named
	 * none of them.
	 *
	 * **the two ends name a box differently and this is the one place that is reconciled.** the
	 * binary answers by the value's own name — `SMTP_HOST`, which is what it is called on the
	 * deployment (`secretEdits` in ./secret-edits.ts) — and the seam finds a box by what that box
	 * posts, which is `VALUE_FIELD`'s name (./use-console-form.ts). a key that is neither is a
	 * sentence drawn under nothing, with focus moved to nothing and the box's own lift never hung,
	 * so the press stays held back over a box the operator has already put right.
	 *
	 * a name this fold draws no box for is dropped rather than carried — the port among them — for
	 * the reason `foldErrors` in ./org-form.ts states: focus into a panel nobody has open is a press
	 * answered by nothing moving.
	 */
	const carried = (said: Record<string, string> | null): Record<string, string> | null => {
		if (said === null) return null;
		const named = pressed.filter((name) => said[name] !== undefined);
		if (named.length === 0) return null;
		return Object.fromEntries(named.map((name) => [VALUE_FIELD(name), said[name] as string]));
	};

	const landed = written?.kind === 'set';
	/* the boxes go back to what the deployment holds on the reading that lands after this press, and
	   not on the answer that arrives ahead of it: these seeds are a reading of the deployment, and
	   the answer commits two router phases before one does (./reseed.ts). `seeds` is the whole of
	   what the boxes are drawn from, so it is what says which reading is on the screen. */
	const spent = useReseeded({ landed, pending: storing, reading: seeds });
	/**
	 * this press from end to end, which is what the boxes are closed for and what the button reports.
	 *
	 * the request is the shorter half: it ends while the console is still finding out what it did,
	 * and a form that went back to `Save` over boxes it is about to put back is a press an operator
	 * makes twice. so the wait is the write and the reading that shows what the write left behind —
	 * and a box left editable across the second half is one whose contents are taken away by that
	 * reading landing, which is the thing ../closed-while-writing.spec.ts exists over.
	 */
	const underway = storing || (landed && !spent);

	const credentials = useConsoleForm(stated, {
		report,
		landed,
		spent,
		refused: carried(errors),
		/* the boxes seeded from what the deployment holds, keyed by what they post. the marking is
		   still the pass and not the seeding: nothing is said about a box until a submit runs the
		   rules (./use-console-form.ts). */
		defaultValue: Object.fromEntries(
			pressed.map((name) => [VALUE_FIELD(name), mailSeed(seeds, name)])
		),
		busy: storing,
		pending: underway
	});
	/** this form's own element, which the readings below are taken off. */
	const form = credentials.mount.ref;

	/**
	 * one box bound: the id every describing block on it is named from, what it posts, what it was
	 * drawn holding, and the one sentence standing under it (./use-console-form.ts).
	 *
	 * the port is not one of these — it posts nothing and is in no box of the schema — so it keeps
	 * the id it always had ({@link MailPort}).
	 *
	 * the index is asserted because the schema's shape is built from this same list rather than
	 * written out as a literal ({@link mailForm}), which is what lets the five be drawn from the
	 * enumeration at all — so a name with no metadata behind it is not a state this reaches.
	 */
	const box = (name: string) => credentials.box(credentials.fields[VALUE_FIELD(name)] as BoundBox);

	/**
	 * what the confirm is holding, or `null` where it is not on the screen: the lines the press
	 * touches and what the press does to this deployment. the act is taken with the lines rather
	 * than while the card is up, because both are readings of the boxes at the moment of the press.
	 */
	const [confirming, setConfirming] = useState<{
		readonly lines: readonly Edit[];
		readonly act: MailAct;
	} | null>(null);

	/**
	 * the control that answers the card, settled as one thing: what it says, what it posts, and which
	 * rank it is drawn in.
	 *
	 * **the destructive rank is for the press that does the damage and for no other.** stopping takes
	 * mail off the deployment and a donor's receipt with it; starting and switching both leave it
	 * sending, so they are the primary control
	 * `packages/operator/src/components/shell/Dialog.jsx` draws where no `danger` is handed over. red
	 * on a press that destroys nothing is a warning an operator learns to read past.
	 * ./stripe-section.tsx's own press applies the same rule.
	 */
	const press =
		confirming === null
			? null
			: {
					destroys: confirming.act === 'stopping',
					label: MAIL_ASKS[confirming.act].press,
					props: {
						type: 'submit' as const,
						name: 'intent',
						value: intent,
						disabled: storing || undefined,
						'aria-busy': storing || undefined
					}
				};

	/* the question is left the moment its own press is answered, whatever the answer says: a landed
	   write reports at the button underneath, and a refused one leaves the operator in the box it
	   named — neither is readable behind a card. keyed on the report itself and not on what it
	   carries, for the save-state half's own reason: two presses into the same form answer the same
	   way (packages/operator/src/saved-form-state.react.ts). */
	useEffect(() => {
		if (report === null) return;
		setConfirming(null);
	}, [report]);

	/* a fold put away is a fold at rest: the boxes back to their seeds and whatever was typed into
	   them gone. a box left holding a password behind something closed is one the next press on it
	   hands back in the clear. the element is found rather than handed down — what shuts is several
	   components above this one, and a flag threaded through each of them would be a prop every fold
	   states and nothing else reads. ./secret-group-form.tsx answers the same thing the same way. */
	useEffect(() => {
		const fold = form.current === null ? null : form.current.closest('details');
		if (fold === null) return;
		const shut = () => {
			if (fold.open) return;
			setConfirming(null);
			credentials.reset();
		};
		fold.addEventListener('toggle', shut);
		return () => fold.removeEventListener('toggle', shut);
	}, [form, credentials.reset]);

	if (vars.kind === 'not-deployed') {
		// this fold is drawn over a deployment that answered a moment ago, so the Worker went between
		// that reading and this one. the way out is the page read again, which draws the state it is
		// actually in rather than boxes over something that is not there.
		return (
			<Section>
				<p className="adm-prose">
					No Worker called {workerName} is in {accountName} any more, so there is nothing to store
					these on. Reload this page.
				</p>
			</Section>
		);
	}
	// no boxes where the read did not land: the write goes through the same door on the same sign-in,
	// so a read refused is a write that would be — and a box seeded from a reading nobody took would
	// draw a stored value as absent and read an emptied one as nothing to remove.
	if (vars.kind !== 'read') {
		return <Section>{trouble(vars)}</Section>;
	}

	return (
		/* no heading: the fold's own row names these settings (./home-sections.ts), and a heading here
		   would be a second name over the first. what opens the section instead is the one thing no
		   box below can say — where the four values it asks for come from. */
		<Section>
			<MailProviders />

			<Form
				{...credentials.mount}
				className="adm-stack"
				method="post"
				preventScrollReset
				/* every press on this form comes through here, whichever control carries it — the
				   button below, or the one inside the card it puts up — and what it decides is which
				   of those two this press is.

				   the seam goes first and answers both of the ways a press starts nothing: the rules
				   over the boxes, and the answer already standing over one of them
				   (./use-console-form.ts). a press held back there begins no navigation, so there is
				   no run to report, no card drawn over the boxes that have to be reached, and the
				   button never draws `Saving` over a press that was never made. */
				onSubmit={(event) => {
					credentials.mount.onSubmit(event);
					if (event.defaultPrevented) return;
					// the submit inside the card, which is the press the card was put up to ask about:
					// the question has been asked and answered, so it goes.
					if (confirming !== null) return;
					event.preventDefault();
					const element = form.current;
					if (element === null) return;
					// and every press that gets this far asks first: what it does to this deployment is
					// one of three things and none of them is on the screen behind the card
					// ({@link MAIL_ASKS}).
					setConfirming({ lines: asked(element), act: mailAct(holding, after(element)) });
				}}
			>
				{names.map((name) => {
					if (name === STATED_PORT) return <MailPort key={name} />;
					const bound = box(name);
					return (
						<Field
							key={name}
							id={bound.id}
							name={bound.name}
							label={
								name === SENDER ? (
									<>
										{mailLabel(name)}{' '}
										<AnchoredNote mark="info" label="What this address sends">
											<SenderAddress />
										</AnchoredNote>
									</>
								) : (
									mailLabel(name)
								)
							}
							// the code face. these are literals an operator checks character for character
							// against the page they copied them from.
							code
							// which of the four arrives masked is ./secret-groups.ts's.
							masked={isMasked(name)}
							autoComplete="off"
							spellCheck={false}
							defaultValue={bound.defaultValue}
							// the example the box stands on while it is empty, which is every box the
							// deployment holds nothing for. a box seeded from a value is full and shows
							// none of it.
							placeholder={MAIL_PLACEHOLDERS[name]}
							// closed for the whole of this block's own press ({@link underway},
							// ../closed-while-writing.spec.ts), and the loss is worse here than elsewhere for
							// the reason stated above the code face: a credential typed in behind a press is one
							// the operator believes they stored.
							disabled={underway}
							/* the deployment's sentence about this box ended by the keystroke that changes it
							   (./use-console-form.ts). */
							onInput={bound.onInput}
							/* what the deployment said about this box, or what this form's own rules held
							   its press back over. the answer's word wins where there is one: it is about
							   the value that was actually sent, and this form's reading is about a box that
							   never went. the seam composes the pair and ends each of them where it should
							   (./use-console-form.ts). */
							error={bound.error}
						/>
					);
				})}

				<div className="adm-actions">
					{/* the submit of this form, which also makes it the button Enter in any box presses.
					    what it carries is the question rather than the write: the boxes are read at the
					    form above and the card is drawn there, and the submit that stores them is the
					    control inside it. */}
					{/* the three words are the button's own defaults
					    (`@better-giving/operator/components/controls/SaveButton`): the fold this press
					    stands in is what says which settings are being saved, so a label naming them
					    again is the card's own row read twice. */}
					<SaveButton type="submit" name="intent" value={intent} state={credentials.state} />
				</div>

				{/* the names of this group the deployment holds in a form nothing can read back — the
				    boxes drawn empty over a value that is there, and the port, which has no box. no
				    save can set one of them until it comes off (./withheld-values.tsx). */}
				<WithheldValues
					names={withheldInGroup(held, group)}
					all={held.withheld}
					consequence="This deployment sends no email at all until these are saved again: no receipt to a donor, and no notice to you."
					written={freed}
					trouble={wrote}
					busy={pending !== null && pending !== FREE_INTENT}
					freeing={pending === FREE_INTENT}
				/>

				{failure === null ? null : wrote(failure)}

				{confirming === null ? null : (
					<Modal
						title={MAIL_ASKS[confirming.act].title}
						onDismiss={() => setConfirming(null)}
						danger={press?.destroys ? press.label : undefined}
						dangerProps={press?.destroys ? press.props : undefined}
						exit={press !== null && !press.destroys ? press.label : undefined}
						exitProps={press !== null && !press.destroys ? press.props : undefined}
						cancel="Go back"
						cancelProps={{ type: 'button', onClick: () => setConfirming(null) }}
					>
						{/* one line per value the press touches and nothing about the rest: an operator
						    reading this is deciding whether to make it, and a value they left alone is not
						    part of that decision. what a row holds is what they typed, cut to its lead
						    ({@link cut}) and drawn in the code face they typed it in: the check being made
						    here is that the value in the box is the value they meant, and an act word is
						    not a thing anybody can check. a removal has nothing to show and keeps the word,
						    in the descriptive register — packages/operator/src/styles/tokens.css states
						    that such a state carries no mark and no tone, so nothing here colours it. the
						    word carries it, and the destructive rank on the confirm carries the rest. */}
						{/* what the press does to this deployment, above the values it does it with. the rows
						    are the operator's own boxes read back and are the check that what is in them is
						    what they meant; this is the one thing the card can say that the screen behind it
						    cannot, so it is what the card opens with ({@link MAIL_ASKS}). */}
						<p className="adm-prose">{MAIL_ASKS[confirming.act].consequence}</p>
						<div>
							{confirming.lines.map((edit) => (
								<SettingRow
									key={edit.name}
									label={mailLabel(edit.name)}
									reading={edit.act === 'Removed' ? 'value' : 'literal'}
									value={edit.act === 'Removed' ? edit.act : cut(edit.typed)}
								/>
							))}
						</div>
					</Modal>
				)}
			</Form>
		</Section>
	);
}

/**
 * the one mail value the operator is not being asked for, and the reason it is not a choice.
 *
 * **the same box as the four beside it, holding 465 and not typeable.** the port stands in a column
 * of boxes, and a value drawn there as bare text has no frame around it and so reads as belonging
 * to nothing — a caption between two controls. the box greyed keeps the column's rhythm and says
 * the value is not the operator's to set in the shape its neighbours already use, code face and
 * all: on this one the face is the column's rather than a literal's.
 *
 * **it carries no name, so nothing about it is posted** — which is what the deployment already
 * assumes, since an absent `SMTP_PORT` is 465, and ../secret-groups.ts's `STATED_VALUES` is what
 * holds it out of every reading of what a press would do.
 *
 * the note hangs on the label and not inside the box, so `disabled` takes the value out of the tab
 * order and leaves the mark in it. what the note says is why there is no choice here, which is a
 * question an operator has once and never while typing.
 */
function MailPort(): ReactNode {
	return (
		<Field
			id={secretBox(STATED_PORT)}
			disabled
			// the code face, for the reason its neighbours wear it: one column, one face.
			code
			defaultValue="465"
			label={
				<>
					{mailLabel(STATED_PORT)}{' '}
					<AnchoredNote mark="info" label="Why the port is 465 and no other">
						<p>
							On 465 the connection is encrypted before anything is sent, so your mail password
							never crosses the network as readable text.
						</p>
						<p>
							Port 587 starts in the open and asks to be encrypted afterwards. Anything on the path
							between this deployment and your mail host can drop that request, and the password
							then goes across in the clear while the send still reports success. So this deployment
							dials 465 and turns down 587 along with every other port.
						</p>
					</AnchoredNote>
				</>
			}
		/>
	);
}

/**
 * what leaves under the sender address, and the one thing it is not.
 *
 * the three are the whole of what this deployment sends (`packages/emails/src/templates/`) and
 * they are named rather than pointed at: there is no screen listing them, and a list of three is
 * shorter than a way to go and find them.
 *
 * the second paragraph is the reason the note is on this box and not on the four beside it. an
 * address on this console is a street address on the Organisation row and a mailbox on the
 * Notifications row, so the word alone settles nothing — and an operator who reads this one as the
 * place mail reaches them has typed their own inbox into what every donor's receipt is from.
 */
function SenderAddress(): ReactNode {
	return (
		<>
			<p>
				Everything the deployment sends goes out from here: a donor's receipt, the word to a donor
				whose gift could not be collected, and the alerts that come to you.
			</p>
			<p>
				It is not where mail reaches you. That is the notification address, on the Notifications row
				below, and nothing is ever sent to this one.
			</p>
		</>
	);
}

/**
 * where the four typed values come from, standing above the boxes that ask for them.
 *
 * an operator opens this fold holding nothing, and the four labels below name values rather than
 * say where to get them. it is what a reader needs before they can fill in a single box, so it is
 * on the page rather than one press away, and it is one sentence so the reader already holding
 * their credentials passes it in a glance.
 *
 * the names are links and nothing else. a hostname or the username a provider expects is a fact
 * about somebody else's product, and one stated here is one this repository has to keep true — so
 * each name points at the page that already states it and states none of it a second time.
 *
 * the port is not among them and no sentence here mentions it: it is stated at the value itself
 * ({@link MailPort}), and said in both places the two come to disagree.
 */
function MailProviders(): ReactNode {
	return (
		<p className="adm-prose">
			SMTP credentials normally come from a mail provider:{' '}
			<a href="https://resend.com/docs/send-with-smtp" target="_blank" rel="noreferrer">
				Resend
			</a>
			,{' '}
			<a href="https://www.zoho.com/zeptomail/help/smtp-home.html" target="_blank" rel="noreferrer">
				ZeptoMail
			</a>
			,{' '}
			<a
				href="https://docs.aws.amazon.com/ses/latest/dg/smtp-connect.html"
				target="_blank"
				rel="noreferrer"
			>
				Amazon SES
			</a>
			,{' '}
			<a
				href="https://documentation.mailgun.com/docs/mailgun/user-manual/sending-messages/"
				target="_blank"
				rel="noreferrer"
			>
				Mailgun
			</a>{' '}
			or{' '}
			<a
				href="https://www.twilio.com/docs/sendgrid/for-developers/sending-email/getting-started-smtp"
				target="_blank"
				rel="noreferrer"
			>
				SendGrid
			</a>
			. Your own mail server works too, on its own host and whatever username it takes.
		</p>
	);
}

/**
 * the destination and the send, on one line.
 *
 * the box is seeded from the notification address ./notifications-fold.tsx holds and is the
 * operator's to retype: a send to somewhere else is how a mail host is checked against an inbox
 * that is not the one every alert already lands in. it takes ./org-fields.ts's treatment of that
 * same value — a plain text box, never `type="email"` and no `autoComplete` — because the
 * deployment's rule for an address is deliberately weaker than the browser's, and a value the
 * browser blocks and the deployment would take is a refusal with no message attached to it.
 *
 * the label stands over the box and the send beside it, so the box lines up with the five above and
 * the press is on the line it acts on. that is the shared `Field`'s `beside`, which is what makes
 * this one field rather than a hand-drawn copy of one: the refusal underneath gets the mark, the
 * invalid box and the `aria-describedby` back to it that every other refused box on the console
 * has, and none of the four can be left off here without being left off everywhere.
 */
function TestSendForm({
	notificationEmail,
	test,
	unconfigured,
	pending
}: {
	notificationEmail: string;
	/**
	 * how the last send went, or `null` where none has been made.
	 *
	 * the answer itself rather than the two readings of it below: the seam is handed it as the fact
	 * one refusal is told from the next by, so that a second press turned down over the same box
	 * moves the operator back into it (./use-console-form.ts).
	 */
	test: TestSend | null;
	/** the deployment holds no mail settings, so there is nothing for a message to leave through. */
	unconfigured: boolean;
	pending: string | null;
}): ReactNode {
	/* the box is this screen's own value and not conform's, which takes a default once at mount:
	   what is typed here is read at every keystroke by the press beside it — the emptiness below is
	   what closes it — and a reading taken off a default would be a press armed over a box that is
	   no longer empty. */
	const [to, setTo] = useState(notificationEmail);
	const sending = ownPress(pending, TEST_EMAIL_INTENT);

	const empty = to.trim() === '';

	/** the press landed and the message went, which is what the button itself reports. */
	const sent =
		test !== null && test.kind === 'reported' && test.report.outcome === 'sent' && !sending;

	/**
	 * the deployment would not read what was typed as an address, drawn at the box that holds it.
	 *
	 * it is the one answer to this press that an operator fixes in place, so it reports where the
	 * fixing happens rather than under the button with the states about mail.
	 */
	const badAddress = test !== null && test.kind === 'bad-address' && !sending;

	/**
	 * the box on the seam: the rule about what is in it, run at the press and before anything is
	 * sent, and the deployment's own answer to a send already made standing in the same place
	 * (./use-console-form.ts).
	 *
	 * **the far end's refusal arrives as the seam's `refused` and is never a message drawn here**,
	 * keyed to what this box posts, which is what the seam finds a box by. so the sentence about the
	 * value that actually went wins over the rule's about a value that never left, the operator is
	 * put in the box either way, and a second press over a box still holding what was turned down
	 * starts nothing at all.
	 *
	 * **no answer empties this box.** the press stores nothing, so `landed` is false: the address
	 * stays where it is, which is what a second send is made from.
	 *
	 * the rungs the button draws are {@link sendState}'s and not the seam's, and why they are a
	 * reading of their own is written there.
	 */
	const send = useConsoleForm(TEST_SEND, {
		report: test,
		landed: false,
		refused: badAddress ? { [TEST_TO_FIELD]: TEST_TO_SAID } : null,
		busy: sending,
		pending: sending
	});
	const box = send.box(send.fields[TEST_TO_FIELD]);

	/** whether the confirmation on the press has stood its seconds out and the press is a press again. */
	const [expired, setExpired] = useState(false);

	/* the tick ends, because a press that keeps one is a control reporting an errand the operator
	   finished thinking about. `expireAfter` is the same four seconds every save button on these
	   surfaces stands for, and the whole of why it is counted from the answer that started it rather
	   than from the answer itself is written where it lives
	   (packages/operator/src/save-state.ts). `sent` is the pair's own answer here: it is false for as
	   long as the press is in flight, so the run that clears the flag is the run before the one that
	   arms the next timer. */
	useEffect(() => expireAfter(sent, setExpired), [sent]);

	const state = sendState({
		pending,
		intent: TEST_EMAIL_INTENT,
		sent,
		expired,
		empty,
		unconfigured
	});
	/** the tick that is still standing, which is the one thing the press draws differently from `state`. */
	const done = state === 'done';

	/* whether the region beside the press is holding the confirmation, which is not the fact the tick
	   is drawn from: the region is emptied on the run `state` changes and written a task later, never
	   written straight over. a second send reports the same words as the first, and a region handed
	   what it is already holding is not a change and is announced by nobody — so the send that worked
	   would be answered with silence. the shared button clears and writes the same way
	   (`@better-giving/operator/components/controls/SaveButton`), and
	   `@better-giving/operator/components/controls/CopyControl` is the idiom both take it from.

	   a state that is not `done` empties the region and schedules nothing: a clear says nothing, so
	   the tick going at its four seconds is announced to nobody, and the next send has an empty
	   region to write into. */
	const [saying, setSaying] = useState(false);
	useEffect(() => {
		setSaying(false);
		if (state !== 'done') return;
		const say = setTimeout(() => setSaying(true), 0);
		return () => clearTimeout(say);
	}, [state]);

	return (
		<Form {...send.mount} className="adm-stack" method="post" preventScrollReset>
			<Field
				id={box.id}
				name={box.name}
				label="To"
				code
				autoComplete="off"
				spellCheck={false}
				value={to}
				onChange={(event) => setTo(event.currentTarget.value)}
				// the seam's own, hung on the box rather than on the form: a sentence the deployment
				// sent back is about what this box was holding, so typing in it is what ends it
				// (./use-console-form.ts). absent where there is nothing standing under the box.
				onInput={box.onInput}
				// closed while this send is in flight and never for a press somewhere else on the page
				// (./smtp-fold-state.ts), in the same reading the send beside it takes: the address is
				// read once, at the press. closed as well where the deployment holds no mail settings,
				// which is a box with no press left to serve — and never on the press's own `disabled`,
				// which carries the empty box too: closed on that reading, the box could not be typed
				// into to leave the state that closed it.
				disabled={sending || unconfigured}
				// no `needed` rung on an empty box, unlike the two seeded boxes above, where the rung is
				// drawn only once the operator has emptied one. this box has a single consumer and it is
				// the press beside it, which `sendState` already closes on the same emptiness
				// (./smtp-fold-state.ts) — so a rung here says a second time what the closed press says,
				// and says it on first paint, before the operator has touched anything, over a deployment
				// that has simply never stored a notification address.

				// what an address may be, said at the box: the rule this form runs at the press over
				// what is in it, or the deployment's own answer to a send already made, whichever is
				// standing (./use-console-form.ts). why one sentence answers for both ends is
				// ./smtp-fold-state.ts's. the field announces either, because both answer a press
				// somebody just made.
				error={box.error}
				beside={
					/* the bare rank, reporting in place the way a save does: the primary rank on this
					   page is the press that writes, and a send that changes nothing on the deployment
					   is not one of those. so it is `.adm-save` and its state class rather than a
					   `SaveButton`, which draws the accent it must not have. */
					<>
						<button
							type="submit"
							name="intent"
							value={TEST_EMAIL_INTENT}
							/* resting wears no name of its own: `.adm-save.is-idle` matches no rule in
							   packages/operator/src/styles/adm.css, and what a resting press looks like is
							   what `.adm-btn` already draws. the shared button composes its own list the
							   same way and for the same reason
							   (`@better-giving/operator/components/controls/SaveButton`). */
							className={['adm-btn', 'adm-save', state === 'idle' ? '' : `is-${state}`]
								.filter(Boolean)
								.join(' ')}
							/* closed while there is nowhere to send to, and closed while its own send is
							   already going: one press is one message, and a press left open under
							   `aria-busy` sends a second one for an errand the operator asked for once
							   (../closed-while-writing.spec.ts). `sending` is read off the navigation the
							   submission started, so it turns true only once that submission is away — a
							   press closed by a reading taken off the box at the moment it is pressed can
							   drop the very submission that closed it. */
							disabled={state === 'disabled' || sending || undefined}
							aria-busy={sending || undefined}
						>
							{/* the resting label stands in this span in every state, and under a press it is
							    what the dots stand over, which is how the three states measure the same.
							    the span and the dots are the shared button's and drawn once
							    (`@better-giving/operator/components/controls/Button`), so a press drawn
							    by hand reports a send the way every other press on this console does. */}
							<span className="adm-btn__label">
								{done ? (
									<span className="adm-save__done">
										<Mark name="check" />
										Sent
									</span>
								) : (
									'Send test email'
								)}
							</span>
							{sending ? <BusyDots /> : null}
						</button>
						{/* the live region stands beside the press and is never the press itself, nor
						    anything inside it: a region reports every change to its own contents, so a
						    press that was one would report the tick arriving over the label and the label
						    coming back — two announcements for one message. it is also outside what
						    carries `aria-busy`, which a reader is told to hold: a region under one is
						    silenced for exactly the wait it exists to narrate.

						    it stays mounted in every state, because a region that arrives carrying its
						    own text is one insertion rather than a change and is announced by nobody
						    (../closed-while-writing.spec.ts).

						    `.adm-vh` from packages/operator/src/styles/base.css: out of the flow, so it
						    is not a second item in the `.adm-actions` row `Field` puts what is beside
						    the box into. */}
						<span className="adm-vh" aria-live="polite">
							{saying ? 'Sent. Nothing was recorded and no donor hears about it.' : null}
						</span>
					</>
				}
			/>
		</Form>
	);
}
