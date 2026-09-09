import { invitation } from '@better-giving/emails';
import { renderEmail } from '@better-giving/emails/render';
import { Modal } from '@better-giving/operator/behaviour/Dialog';
import { Button } from '@better-giving/operator/components/controls/Button';
import { SaveButton } from '@better-giving/operator/components/controls/SaveButton';
import { DataTable } from '@better-giving/operator/components/data/DataTable';
import { Field } from '@better-giving/operator/components/forms/Field';
import { Column, Section } from '@better-giving/operator/components/shell/Layout';
import { PageHeader } from '@better-giving/operator/components/shell/PageHeader';
import { StatusWord } from '@better-giving/operator/components/status/StatusWord';
import { useSaveState } from '@better-giving/operator/save-state.react';
import { getFormProps } from '@conform-to/react';
import { data, Form, Link, redirect, useNavigate, useNavigation } from 'react-router';
import { z } from 'zod';
import { buttonState } from '$lib/admin/save-button-state';
import { APP_NAME, screenTitle } from '$lib/admin/screen-title';
import { type AdminActionData, boxProps, useAdminForm, whichForm } from '$lib/admin/use-admin-form';
import { defineForm, WHICH_FORM } from '$lib/forms/definition';
import { inviteMember, listMembers, removeMember, STAFF_USER_ID } from '$lib/server/auth';
import { readSetupState } from '$lib/server/config/setup-state';
import { invalid, parseForm, submittedForm, unread } from '$lib/server/conform';
import { createEmailProvider } from '$lib/server/email/factory';
import { redirectWithFlash, SAVED_FLASH, takeFlash } from '$lib/server/flash';
import { database, platform, staff } from '../context';
import type { Route } from './+types/_app.admin.members';

// who can sign in to this deployment besides the deployer, and the two presses that change it.
//
// the reads and the writes are `$lib/server/auth/invitations.ts` and `.../members.ts`; the only
// job here is turning a request into one of them and a refusal into a sentence. **nothing about
// how a colleague becomes a member is decided in this file** — one live token per address, what a
// dead link is told, why an address that already signs in is refused — and the mail's own wording is
// `packages/emails/src/templates/invitation.tsx`'s. what this route owns is the address in the
// link, because the host a deployment answers on is a fact about the request rather than about
// the invitation.
//
// **who may invite and remove is the deployer's session and no other, and that is a decision
// rather than a law.** it is one predicate — `context.get(staff).id === STAFF_USER_ID` — read
// twice, once by the loader so a member is offered neither control and once by the action so a
// hand-written POST is refused. `inviteMember` records who invited and reads it for nothing
// (`invitations.ts` says so), so widening this to every member is deleting the predicate rather
// than growing a role.
//
// **there is no self-removal rule and none is needed.** the deployer's row is not on the list at
// all and `removeMember` refuses it by id besides, and no member can reach the press — so the row
// a person could aim at themselves does not exist on either side of the decision above.
//
// this screen reports at the control the operator pressed, never in a band at the head: Send
// invitation is a `SaveButton` and draws its own confirmation, and a refused invitation is the
// sentence under the box. the confirmation survives its own redirect as a flash carrying the
// address ($lib/server/flash.ts), which the loader matches against the rows it has already read —
// the same shape ./_app.admin.forms._index.tsx uses for the form a create just made.

/** the screen's name, rendered as the document title and as the heading. */
const SCREEN_TITLE = 'Members';

/** the address this screen answers on, and the one a write redirects back to. */
const SCREEN = '/admin/members';

/**
 * where a member changes their own password.
 *
 * under this screen's address so `currentDestination` keeps the Members cell marked
 * ($lib/admin/destinations.ts), and out of its layout nesting: `members_` in the file name is what
 * writes it out, because this file draws no `Outlet`.
 */
const PASSWORD_SCREEN = `${SCREEN}/password`;

/** what an empty box and a box the request did not carry are both told. */
const MISSING = 'required';

/** the longest address there is (RFC 5321), so a body cannot buy an unbounded lookup. */
const MAX_EMAIL_LENGTH = 254;

/**
 * the two forms this screen carries, as the literals a body names itself with.
 *
 * one `action` and two submissions, told apart by the box `whichForm` writes into each `<form>` —
 * the mechanism is the seam's and `$lib/server/conform.ts`'s header is where it is argued.
 */
const INVITE_FORM_ID = 'members-invite';
const REMOVE_FORM_ID = 'members-remove';
const SCREEN_FORMS = [INVITE_FORM_ID, REMOVE_FORM_ID] as const;

/**
 * the invite, which states one box.
 *
 * the address is lower-cased and trimmed here as well as by `inviteMember`, and the second reading
 * is not a copy of the first: what this one produces is the value the mail is addressed to and the
 * marker the confirmation is matched by, and both have to be the spelling the row was written
 * under.
 *
 * whether the value is an address at all is `inviteMember`'s answer and not a rule here, so that
 * one module decides what this deployment can create an account for; what it answers with lands
 * under this box.
 */
const INVITE_FORM = defineForm({
	id: INVITE_FORM_ID,
	schema: z.object({
		email: z
			.string({ error: MISSING })
			.trim()
			.toLowerCase()
			.min(1, { error: MISSING })
			.max(MAX_EMAIL_LENGTH, { error: `must be at most ${MAX_EMAIL_LENGTH} characters` })
	})
});

/**
 * the removal, which states the row it acts on.
 *
 * the id is a box rather than a path segment because this screen is the list and the confirmation
 * alike — the question is `?confirm=<id>` on this same address, so a form posting to a path of its
 * own would be a second address for a screen that has one.
 *
 * it is not a capability: `removeMember` refuses the deployer's id by name and every other id is a
 * row this list would have shown.
 */
const REMOVE_FORM = defineForm({
	id: REMOVE_FORM_ID,
	schema: z.object({
		member_id: z
			.string({ error: MISSING })
			.min(1, { error: MISSING })
			.max(64, { error: 'must be at most 64 characters' })
	})
});

/**
 * what an invitation that could not be minted says, under the box the address was typed in.
 *
 * `member` is the one an operator reaches by trying to help: a colleague who cannot get in at an
 * address that already signs in here has nothing to be invited to, and what they need is a reset
 * link, which they ask for themselves from the sign-in page (src/routes/forgot.tsx). there is
 * nothing to press on this screen for it.
 */
const INVITE_REFUSALS = {
	member: 'This address can already sign in here.',
	invalid_email: 'This is not an email address an invitation could be sent to.'
} as const;

/**
 * what a mail that did not go says, in the same place.
 *
 * the invitation row is written before the send and stays written when the send fails, which is
 * the right way round: the operator can press again on the same address — the second invitation
 * supersedes the first — or take the pending row off the list. the sentence points at the console
 * because that is where this deployment's mail settings are typed and where the send test is.
 */
const SEND_FAILED =
	'The invitation could not be sent. Open the console (`better-giving open`) and check this ' +
	'deployment’s mail settings, then send it again.';

/**
 * what a POST from a member's session is answered with.
 *
 * this screen draws neither control for a member, so a body that arrives is one this app's markup
 * could not have sent and no box on the screen is what went wrong. it comes back as a form-level
 * refusal all the same, because every rejection in /admin does — a hand-built failure response
 * from a module that holds a form is what `packages/app/form-rules.spec.ts` refuses, and the
 * reason it refuses one is that the status and the form's own state have to agree. a 4xx body in
 * this app is read by an agent (CLAUDE.md), so the sentence names the rule.
 */
const NOT_THE_DEPLOYER =
	'Only the deployer’s session may invite or remove members on this deployment. Sign in with ' +
	'`ADMIN_PASSWORD` at /login.';

/** what a body aimed at the deployer's own row is answered with, for the same reason. */
const STAFF_KEPT =
	'The deployer is the deployment rather than a member and cannot be removed. The sign-in ' +
	'password is set on the console (`better-giving open`).';

export function meta({ matches }: Route.MetaArgs): Route.MetaDescriptors {
	return [{ title: screenTitle(SCREEN_TITLE, matches) }];
}

export async function loader({ context, request, url }: Route.LoaderArgs) {
	const db = context.get(database);

	// one predicate, read here and again at the action. the screen not drawing a control is not
	// what withholds the press — the action is — and this is the half that keeps a member from
	// being offered something they would then be refused.
	const mayManage = context.get(staff).id === STAFF_USER_ID;

	const members = await listMembers(db, new Date());

	// the invitation that just went, taken: read and cleared on this one response, so a reload
	// reports nothing ($lib/server/flash.ts owns that).
	//
	// taken after the read above and matched against it, which is what makes a marker no row
	// answers to report nothing — the same lookup ./_app.admin.forms._index.tsx does with the id of
	// a form a create just made.
	const landed = await takeFlash(request, SAVED_FLASH);
	const sentTo = members.find((row) => row.email === landed?.marker)?.email ?? null;

	// whether the operator has asked to remove somebody and is being asked again.
	//
	// the state lives in the URL because that is where a confirmation an operator can share, reload
	// and back out of lives, and because nothing on this screen has to hold it between two
	// requests — the same shape ./_app.admin.forms.$id.tsx's archive takes.
	//
	// never offered to a member, whatever the address says: the action would refuse the press, so a
	// card asking about it is a question with one wrong answer.
	const asked = mayManage ? url.searchParams.get('confirm') : null;

	return data(
		{
			mayManage,
			members,
			sentTo,
			removing: members.find((row) => row.id === asked) ?? null
		},
		// the header that burns the marker rides on the response that publishes it, so a reload
		// reports nothing. a `Set-Cookie` from a loader is sent without this route exporting
		// `headers` — react router preserves that one header on its own.
		landed === null ? {} : { headers: { 'Set-Cookie': landed.clear } }
	);
}

/**
 * both writes this screen performs.
 *
 * **the request body is read exactly once, here, by the action that owns it** — `parseForm` reads
 * what it returns and nothing above this route may.
 */
export async function action(args: Route.ActionArgs) {
	const body = await args.request.formData();

	// which of this screen's two forms the body came from, read before anything else: what a
	// refusal is answered under is the form it was submitted from, the gate below included.
	const submitted = submittedForm(body, SCREEN_FORMS);

	// the one gate over both arms. see this module's header for why it is the deployer's session
	// rather than a role. `unread` because nothing has been parsed against the schema yet and there
	// is nothing in the body that is wrong — the refusal is about who pressed.
	if (args.context.get(staff).id !== STAFF_USER_ID) {
		// the two calls rather than one over a chosen form: `unread` is generic in the schema, and a
		// form picked by a ternary reaches it as a union no call can be resolved against.
		return submitted === INVITE_FORM_ID
			? invalid(403, unread(INVITE_FORM, NOT_THE_DEPLOYER))
			: invalid(403, unread(REMOVE_FORM, NOT_THE_DEPLOYER));
	}

	switch (submitted) {
		case INVITE_FORM_ID:
			return invite(args, body);
		case REMOVE_FORM_ID:
			return remove(args, body);
	}

	// the two arms are declared inside the action rather than beside it, and it is not a style
	// choice: react router strips a route's `action` from the bundle it ships and strips nothing
	// else, so a module-scope helper reaching `$lib/server/**` puts D1 and this deployment's
	// secrets into the browser — with the export that used it dropped and the helper still there.
	// ../routes.spec.ts is what holds that, over the module graph rather than over a rule.

	/**
	 * mint an invitation and mail the link.
	 *
	 * **the row is written before the message goes, and stays written when it does not.** the other
	 * order is a colleague holding a link this deployment has no record of. what a failed send
	 * leaves is a pending row the operator can remove or invite over — inviting the same address
	 * again revokes the first token in the same `batch()` that writes the second
	 * (`$lib/server/auth/invitations.ts`), so pressing again is the whole of the repair.
	 *
	 * the link is composed here and nowhere else. the invitations module returns the token and
	 * never an address — it reads no url, no origin and no header — and the template is handed the
	 * finished string, so the host this deployment answers on is known in exactly one place.
	 */
	async function invite({ context, request, url }: Route.ActionArgs, body: FormData) {
		const submission = parseForm(body, INVITE_FORM);
		if (!submission.ok) return invalid(400, submission.reject());

		const db = context.get(database);
		const { env } = context.get(platform);
		const email = submission.value.email;

		const minted = await inviteMember(db, {
			email,
			now: new Date(),
			invitedBy: context.get(staff).id
		});
		if (!minted.ok) {
			return invalid(
				400,
				submission.reject({ fieldErrors: { email: [INVITE_REFUSALS[minted.reason]] } })
			);
		}

		// the registered name, for a subject line a recipient recognises. a read that did not land
		// costs the name and not the invitation: this route falls back to what every screen falls
		// back to, and a colleague still gets their link.
		const state = await readSetupState(db, env);

		const sent = await createEmailProvider(env).send({
			to: email,
			...(await renderEmail(
				invitation.template({
					orgName: state?.profile?.legalName ?? APP_NAME,
					link: `${url.origin}/join?token=${minted.token}`,
					expiresAt: minted.expiresAt
				})
			))
		});

		if (!sent.ok) {
			// the detail names the value to fix and is written for an operator holding a log line;
			// what the screen gets is the pointer at the console, because this box is not where an
			// SMTP credential is repaired.
			console.error('an invitation could not be sent:', sent.reason, sent.detail);
			return invalid(500, submission.reject({ fieldErrors: { email: [SEND_FAILED] } }));
		}

		// POST-redirect-GET, so a reload does not mint a second invitation over the first. the
		// address is the marker, and the loader turns it back into the press's confirmation by
		// finding the row it now names.
		return redirectWithFlash(request, SAVED_FLASH, SCREEN, email);
	}

	/**
	 * take a colleague off the list, whether they had accepted or not.
	 *
	 * one id and two tables, which is `removeMember`'s to sort out — the screen does not say which
	 * kind a row is, and the card the operator answered does.
	 */
	async function remove({ context }: Route.ActionArgs, body: FormData) {
		const submission = parseForm(body, REMOVE_FORM);
		if (!submission.ok) return invalid(400, submission.reject());

		const removal = await removeMember(context.get(database), {
			id: submission.value.member_id,
			now: new Date()
		});

		// the deployer's own id, which no control on this screen can name: the list leaves that row
		// out, so a body carrying it is hand-written and gets the same kind of answer a body naming
		// no form gets.
		if (!removal.ok && removal.reason === 'staff') {
			return invalid(400, submission.reject({ formErrors: [STAFF_KEPT] }));
		}

		// `unknown` lands here with the rest, and that is the answer rather than a gap: a second
		// press of the same button is the ordinary way to reach it, and the row is gone either way.
		// the redirect drops `?confirm=` with it, so the card closes on the list it changed.
		return redirect(SCREEN, 303);
	}
}

export default function Members({ loaderData, actionData }: Route.ComponentProps) {
	return (
		// nothing wraps the plane: a plain element between the column and it is one the column can
		// never make narrower than the whole table, so the page scrolls sideways instead of the
		// plane and the pinned column goes with it.
		<Column wide>
			<PageHeader title={SCREEN_TITLE} />
			{loaderData.mayManage ? (
				<InviteSection sentTo={loaderData.sentTo} actionData={actionData} />
			) : (
				// a member is offered one control on this screen and it is about themselves, in the
				// place the deployer is offered the invite. the deployer is offered neither: their
				// password is a deploy-time secret set on the console, and that screen refuses their
				// session (./_app.admin.members_.password.tsx).
				<Section>
					<div className="adm-actions">
						<Button as={Link} to={PASSWORD_SCREEN}>
							Change your password
						</Button>
					</div>
				</Section>
			)}
			<MemberPlane members={loaderData.members} mayManage={loaderData.mayManage} />
			{loaderData.removing ? <RemoveCard row={loaderData.removing} /> : null}
		</Column>
	);
}

/**
 * the invite: one box and one press on the box's own row, with the outcome reported at that press.
 *
 * `beside` is what puts the pair on one row — `Field` wraps the two in `.adm-actions`, which is
 * what makes the box take the line's remainder and the pair wrap at the 375px floor rather than
 * shrink.
 *
 * the press is a `SaveButton`, so what a sent invitation looks like is the tick on the button that
 * sent it and it clears itself; the rules it draws by are
 * `packages/operator/src/save-state.ts`'s. the box is seeded empty every time this screen is
 * served, so `{ email: '' }` is the seed `changed` is measured against and the press rests closed
 * until something is typed. the address is not in the confirmation: the row the invitation made is
 * on the list below, marked Invited.
 */
function InviteSection({
	sentTo,
	actionData
}: {
	readonly sentTo: string | null;
	readonly actionData: AdminActionData;
}) {
	const [form, fields] = useAdminForm(INVITE_FORM, actionData);
	const navigation = useNavigation();

	// this form's own submission and not any submission on the screen: the removal posts from the
	// card and would otherwise mark this press busy and take its confirmation off the row while it
	// ran.
	const sending = navigation.formData?.get(WHICH_FORM) === INVITE_FORM.id;

	// `!actionData` for the reason ./_app.admin.forms.$id.tsx gives: a refused write is answered
	// with a rejection rather than a redirect, so the marker the last landing published is still on
	// the page — and a tick over a request that was just refused is two answers to one press.
	const inviteSave = useSaveState({
		landed: sentTo !== null && !actionData,
		// conform's own reading against the seed this form was mounted on, which is no seed at all:
		// the box arrives empty, so anything in it is something to send (`useAdminForm` in
		// $lib/admin/use-admin-form.ts).
		changed: form.dirty,
		pending: sending
	});

	return (
		<Section>
			<h2>Invite someone</h2>
			{/* no `action` attribute, so this posts to the address the operator is standing on and
			    leaves `?confirm=` alone. */}
			<Form method="post" {...getFormProps(form)}>
				<input {...whichForm(INVITE_FORM.id)} />
				<Field
					{...boxProps(fields.email)}
					label="Email address"
					type="email"
					autoComplete="off"
					required
					placeholder="name@example.org"
					beside={
						<SaveButton
							label="Send invitation"
							doneLabel="Invitation sent"
							state={buttonState(inviteSave)}
						/>
					}
				/>
			</Form>
		</Section>
	);
}

/**
 * the four columns, and the shares sum to the whole of the table.
 *
 * the first is the row's own header and what the plane pins: a member's address is what the other
 * three cells are about, and it is the one thing they have before they have accepted. the share is
 * stated here rather than taken from a token because a column's percentage is one of the few
 * things `packages/operator/src/styles/tokens.css` leaves a screen to write.
 */
const COLUMNS = [
	{ key: 'email', label: 'Email', width: '38%' },
	{ key: 'name', label: 'Name', width: '26%' },
	// `neverDash`: an accepted member is in no state worth a word, and an em dash beside a colleague
	// who is still waiting reads as a value that failed to load rather than as one that is absent.
	{ key: 'status', label: 'Status', width: '18%', neverDash: true },
	{ key: 'remove', label: 'Remove', width: '18%' }
];

function MemberPlane({
	members,
	mayManage
}: {
	readonly members: Route.ComponentProps['loaderData']['members'];
	readonly mayManage: boolean;
}) {
	const columns = mayManage ? COLUMNS : COLUMNS.filter((column) => column.key !== 'remove');

	return (
		<DataTable
			// the count where there are rows to count, and the screen's own noun where there are
			// none: `DataTable` draws no caption for an empty list and names the plane from the same
			// string instead, so a table with nothing in it is still announced as one.
			caption={
				members.length > 0
					? `${members.length} ${members.length === 1 ? 'member' : 'members'}.`
					: SCREEN_TITLE
			}
			columns={columns}
			rows={members.map((member) => ({
				// the row's own id, which is what keys it and what the remove link names. it is a
				// user id for a colleague who accepted and an invitation id for one who has not,
				// which is the only thing the action needs to be told.
				id: member.id,
				cells: {
					email: member.email,
					// nobody has typed one on an invitation, so the cell dashes — inventing one from
					// the address would put a guess on the screen beside real ones.
					name: member.name ?? undefined,
					status: member.invited ? <StatusWord secondary>Invited</StatusWord> : undefined,
					...(mayManage
						? {
								// a link dressed as a button, because it writes nothing: it asks. it keeps
								// one visible word and takes its own name from the row it acts on, so a
								// reader meeting it out of context is told which colleague it drops.
								remove: (
									<Button
										as={Link}
										size="sm"
										to={`${SCREEN}?confirm=${encodeURIComponent(member.id)}`}
										aria-label={`Remove ${member.email}`}
									>
										Remove
									</Button>
								)
							}
						: {})
				}
			}))}
			empty="No members yet"
		/>
	);
}

/**
 * the card over the list, and the one place on this screen the top layer is spent.
 *
 * removing a colleague destroys something that already exists — a way in, and every session behind
 * it — so the question is asked in the top layer, where the page behind it is inert until it is
 * answered; ./_app.admin.forms.$id.tsx's archive stays in the page because it destroys nothing.
 *
 * the consequences are a run of rows rather than a paragraph: what the press does is a couple of
 * facts an operator checks one at a time, and a sentence holding both is one they read once. only
 * what this press touches is listed — a colleague who accepted has no open invitation to stop, and
 * an invitation nobody accepted signed nobody in.
 *
 * the `<form>` stands around the whole card rather than around the control that submits it, which
 * is the rule `Dialog` states: its actions row holds controls, and a submit belongs to the form
 * enclosing it whether or not the card has been lifted into the top layer.
 */
function RemoveCard({
	row
}: {
	readonly row: NonNullable<Route.ComponentProps['loaderData']['removing']>;
}) {
	const navigate = useNavigate();
	const card = row.invited ? invitedCard(row.email) : acceptedCard(row.name ?? row.email);

	return (
		<Form method="post">
			<input {...whichForm(REMOVE_FORM.id)} />
			<input type="hidden" name="member_id" value={row.id} />
			<Modal
				title={card.title}
				danger={card.confirm}
				dangerProps={{ type: 'submit' }}
				cancel="Cancel"
				// a `Link` rather than an anchor, so leaving the card is a navigation the router
				// handles rather than a full document load. it takes the secondary rank the library
				// pairs a danger control with, and states no `variant` of its own to get it.
				cancelProps={{ as: Link, to: SCREEN }}
				// Escape and a press on the ground mean what Cancel means, and the state they are
				// dismissing is on the address rather than in this component.
				onDismiss={() => navigate(SCREEN)}
			>
				{card.lines.map((line) => (
					<p className="adm-prose" key={line}>
						{line}
					</p>
				))}
			</Modal>
		</Form>
	);
}

function acceptedCard(who: string) {
	return {
		title: `Remove ${who}?`,
		lines: [
			'Signed out on every device, straight away.',
			'Nothing they did is undone. Every gift, form and change stays exactly as it is.'
		],
		confirm: `Yes, remove ${who}`
	};
}

function invitedCard(email: string) {
	return {
		title: `Remove the invitation to ${email}?`,
		lines: [
			'The link in their invitation stops working.',
			'Nothing is undone. They have not signed in yet.'
		],
		confirm: 'Yes, remove this invitation'
	};
}
