import { Modal } from '@better-giving/operator/behaviour/Dialog';
import { Button } from '@better-giving/operator/components/controls/Button';
import { InlineCode } from '@better-giving/operator/components/data/CodeSlab';
import { DataTable } from '@better-giving/operator/components/data/DataTable';
import { SaveButton } from '@better-giving/operator/components/controls/SaveButton';
import { Field } from '@better-giving/operator/components/forms/Field';
import { Column, Section } from '@better-giving/operator/components/shell/Layout';
import { PageHeader } from '@better-giving/operator/components/shell/PageHeader';
import type { Tone } from '@better-giving/operator/components/closed-sets';
import { Banner } from '@better-giving/operator/components/status/Banner';
import { StatusWord } from '@better-giving/operator/components/status/StatusWord';
import { useSaveState } from '@better-giving/operator/save-state.react';
import { getFormProps } from '@conform-to/react';
import { type RefObject, useMemo, useRef } from 'react';
import {
	data,
	Form,
	href,
	Link,
	type ShouldRevalidateFunctionArgs,
	useNavigate,
	useNavigation
} from 'react-router';
import { z } from 'zod';
import type { CrumbHandle } from '$lib/admin/crumbs';
import { useAfterPaint } from '$lib/admin/after-paint';
import { useAnswerRevision } from '$lib/admin/answer-revision';
import { buttonState } from '$lib/admin/save-button-state';
import { screenTitle } from '$lib/admin/screen-title';
import {
	type AdminActionData,
	resultFor,
	useAdminForm,
	whichForm
} from '$lib/admin/use-admin-form';
import { DestinationFields, eventsBox } from '$lib/admin/webhooks/destination-fields';
import { defineForm, WHICH_FORM } from '$lib/forms/definition';
import { redactPublicId } from '$lib/redact';
import { WEBHOOK_EVENTS } from '$lib/webhooks/catalog';
import { DESTINATION_INPUT } from '$lib/webhooks/destination-input';
import { STAFF_USER_ID } from '$lib/server/auth';
import { invalid, parseForm, submittedForm, unread } from '$lib/server/conform';
import { notFound } from '$lib/server/db/load-failure';
import { CREATED_FLASH, redirectWithFlash, SAVED_FLASH, takeFlash } from '$lib/server/flash';
import {
	deleteDestination,
	readDestination,
	readPostTarget,
	resumeDestination,
	updateDestination
} from '$lib/server/webhooks/destinations';
import { listDeliveries, sendTestWebhook } from '$lib/server/webhooks/deliver';
import { readConfigEnv } from '$lib/server/config/env';
import { planOf } from '$lib/server/outbox/budget';
import { database, platform, staff } from '../context';
import type { Route } from './+types/_app.admin.integrations.webhooks.$id';

// one webhook destination: its recent deliveries, a test sent to it, its signing secret, its
// address and events edited, a paused one resumed, and the destination deleted. what each write
// does is its function's doc in $lib/server/webhooks/destinations.ts; this route turns a press into
// one of them.
//
// **only the deployer's session reaches this page**, as ./_app.admin.integrations.webhooks._index.tsx
// argues; a member's GET and POST alike are answered with the dashboard's not-found.
//
// **the signing secret is on this page and no other**, masked until the press inside its box shows
// it, and copied from the box: the receiving system checks every post with it. it stays
// retrievable because every post is signed with it (`webhook_destination` in
// $lib/server/db/schema.ts).
//
// the resume and the delete are each asked first, in a dialog held on the address
// (`?confirm=resume`, `?confirm=delete`) so the question can be reloaded and backed out of. each
// press posts to the page's own address rather than the question's, in place of it in the history:
// whatever the action answers lands on the page with the question down. a resume reports at the
// header's status line, where its press stood; a delete lands on the list, which names what it
// took. a refused resume answers 409, and `shouldRevalidate` reads the page again after it so the
// header shows the destination as it stands.
//
// the test is sent at once and reports at the same status line, in the word its answer earns:
// `Sent — 200`, `Refused — 500`, or `No answer` for a fault or a timeout. it is offered on a paused
// destination too, since it is how a fix is checked before the resume; what it posts, and why it
// changes nothing, is `sendTestWebhook`'s doc in $lib/server/webhooks/deliver.ts.
//
// the recent deliveries are the destination's latest rows, and the page states no period for them:
// how far back they reach is whatever the delivery table still holds.

const NOT_HERE =
	'No page at /admin/integrations/webhooks/:id for a member’s session. Webhook destinations are ' +
	'changed from the deployer’s session: sign in with `ADMIN_PASSWORD` at /login.';

const EDIT_FORM_ID = 'webhook-destination-edit';
const RESUME_FORM_ID = 'webhook-destination-resume';
const DELETE_FORM_ID = 'webhook-destination-delete';
const TEST_FORM_ID = 'webhook-destination-test';
const SCREEN_FORMS = [EDIT_FORM_ID, RESUME_FORM_ID, DELETE_FORM_ID, TEST_FORM_ID] as const;

const EDIT_FORM = defineForm({ id: EDIT_FORM_ID, schema: DESTINATION_INPUT });
/** the resume, the delete and the test state no box; the body says which form it came from. */
const RESUME_FORM = defineForm({ id: RESUME_FORM_ID, schema: z.object({}) });
const DELETE_FORM = defineForm({ id: DELETE_FORM_ID, schema: z.object({}) });
const TEST_FORM = defineForm({ id: TEST_FORM_ID, schema: z.object({}) });

const NOT_PAUSED = 'This destination is not paused, so there was nothing to resume.';

/** the marker an edit's save lands under. */
const SAVED = 'details';

/** the address as a heading and a crumb say it: without its scheme, which is always https. */
const titleOf = (url: string) => url.replace(/^https:\/\//, '');

const screen = (id: string) => href('/admin/integrations/webhooks/:id', { id });

/** how many of its deliveries the page lists. */
const RECENT_DELIVERIES = 50;

const MONTH = new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' });
const twoDigits = (n: number) => String(n).padStart(2, '0');
/**
 * a moment as the deliveries list says it, in UTC and formatted here: an `Intl.DateTimeFormat` in
 * the page would run once on the Worker during ssr and again in the browser, in two time zones.
 */
const whenOf = (at: Date) =>
	`${at.getUTCDate()} ${MONTH.format(at)} ${at.getUTCFullYear()}, ` +
	`${twoDigits(at.getUTCHours())}:${twoDigits(at.getUTCMinutes())} UTC`;

export const handle = {
	crumbs: ({ pathname, loaderData }) => [
		{ href: href('/admin/integrations/webhooks'), label: 'Webhooks' },
		{ href: pathname, label: loaderData?.title ?? 'Destination' }
	]
} satisfies CrumbHandle<Route.ComponentProps['loaderData'] | undefined>;

export function meta({ loaderData, matches }: Route.MetaArgs): Route.MetaDescriptors {
	return [{ title: screenTitle(loaderData?.title ?? 'Destination', matches) }];
}

/** the body of the not-found for an address no standing destination answers on. */
const noSuchDestination = (id: string) =>
	`No destination has the id \`${redactPublicId(id)}\`. Check the address, or open /admin/integrations/webhooks for the destinations this deployment posts to.`;

export async function loader({ context, params, request, url }: Route.LoaderArgs) {
	if (context.get(staff).id !== STAFF_USER_ID) notFound(NOT_HERE);

	const db = context.get(database);
	const [destination, deliveries] = await Promise.all([
		readDestination(db, params.id),
		listDeliveries(db, params.id, RECENT_DELIVERIES)
	]);
	if (destination === null) notFound(noSuchDestination(params.id));

	const asked = url.searchParams.get('confirm');
	// the outcome of whichever write just redirected here, taken: read and cleared on this one
	// response, so a reload reports nothing.
	const [added, saved] = await Promise.all([
		takeFlash(request, CREATED_FLASH),
		takeFlash(request, SAVED_FLASH)
	]);
	const cleared = [added, saved].flatMap((landed) => (landed === null ? [] : [landed.clear]));

	const headers = new Headers();
	for (const clear of cleared) headers.append('Set-Cookie', clear);
	return data(
		{
			id: destination.id,
			url: destination.url,
			title: titleOf(destination.url),
			events: [...destination.events],
			signingSecret: destination.signingSecret,
			paused: destination.paused,
			held: destination.held,
			// a resume is asked only of a paused destination: the action would refuse it otherwise.
			confirming:
				asked === 'delete'
					? ('delete' as const)
					: asked === 'resume' && destination.paused
						? ('resume' as const)
						: null,
			added: added?.marker === destination.id,
			saved: saved?.marker === SAVED,
			deliveries: deliveries.map((delivery) => ({
				id: delivery.id,
				event: delivery.event,
				status: delivery.status,
				at: delivery.createdAt.toISOString(),
				when: whenOf(delivery.createdAt),
				answer: delivery.lastStatus,
				attempts: delivery.attempts
			}))
		},
		{ headers }
	);
}

/**
 * the four presses this page takes: the edit, the resume, the delete and the test. **the request
 * body is read exactly once, here** — and not at all for a member, who is answered before it.
 */
export async function action(args: Route.ActionArgs) {
	if (args.context.get(staff).id !== STAFF_USER_ID) notFound(NOT_HERE);

	const body = await args.request.formData();
	switch (submittedForm(body, SCREEN_FORMS)) {
		case EDIT_FORM_ID:
			return edit(args, body);
		case RESUME_FORM_ID:
			return resume(args, body);
		case DELETE_FORM_ID:
			return remove(args, body);
		case TEST_FORM_ID:
			return test(args, body);
	}

	// the arms are declared inside the action for the reason ./_app.admin.integrations.api.tsx gives:
	// react router strips the `action` export from the browser bundle and nothing else.

	async function edit({ context, params, request }: Route.ActionArgs, body: FormData) {
		const submission = parseForm(body, EDIT_FORM);
		if (!submission.ok) return invalid(400, submission.reject());

		const moved = await updateDestination(context.get(database), params.id, submission.value);
		if (!moved.ok) {
			if (moved.reason === 'not_found') notFound(noSuchDestination(params.id));
			return invalid(400, submission.reject({ fieldErrors: { [moved.field]: [moved.box] } }));
		}
		return redirectWithFlash(request, SAVED_FLASH, screen(params.id), SAVED);
	}

	async function resume({ context, params }: Route.ActionArgs, body: FormData) {
		const submission = parseForm(body, RESUME_FORM);
		if (!submission.ok) return invalid(400, submission.reject());

		const resumed = await resumeDestination(
			context.get(database),
			params.id,
			new Date(),
			planOf(readConfigEnv(context.get(platform).env))
		);
		if (resumed.ok) return { resumed: resumed.requeued };
		if (resumed.reason === 'not_found') notFound(noSuchDestination(params.id));
		return invalid(409, unread(RESUME_FORM, NOT_PAUSED));
	}

	async function test({ context, params }: Route.ActionArgs, body: FormData) {
		const submission = parseForm(body, TEST_FORM);
		if (!submission.ok) return invalid(400, submission.reject());

		const target = await readPostTarget(context.get(database), params.id);
		if (target === null) notFound(noSuchDestination(params.id));
		return { tested: await sendTestWebhook(fetch, target, new Date()) };
	}

	async function remove({ context, params, request }: Route.ActionArgs, body: FormData) {
		const submission = parseForm(body, DELETE_FORM);
		if (!submission.ok) return invalid(400, submission.reject());

		const deleted = await deleteDestination(context.get(database), params.id, new Date());
		if (!deleted.ok) notFound(noSuchDestination(params.id));
		return redirectWithFlash(
			request,
			SAVED_FLASH,
			href('/admin/integrations/webhooks'),
			deleted.url
		);
	}
}

/**
 * the page is read again after a refused resume, which react router skips for a 4xx by default: a
 * 409 means the destination was resumed under the page, and the header should stop offering it. a
 * test changes nothing, so nothing is read again after one, and its press is free again the moment
 * its answer lands.
 */
export function shouldRevalidate({
	actionStatus,
	formData,
	defaultShouldRevalidate
}: ShouldRevalidateFunctionArgs) {
	const form = formData?.get(WHICH_FORM);
	if (form === TEST_FORM_ID) return false;
	return actionStatus === 409 && form === RESUME_FORM_ID ? true : defaultShouldRevalidate;
}

type Loaded = Route.ComponentProps['loaderData'];

const events = (n: number) => `${n} held ${n === 1 ? 'event' : 'events'}`;

/** a line the header's status says: done, refused, or a press that changed nothing. */
type Report = { readonly text: string; readonly reading: 'done' | 'blocked' | 'neutral' };

/** how the status line's word is drawn for each reading. */
const READINGS = {
	done: {},
	blocked: { blocked: true },
	neutral: { neutral: true }
} as const;

/** what the header's status line says of the test that just answered, or nothing. */
function testReport(actionData: Route.ComponentProps['actionData']): Report | null {
	if (!actionData || !('tested' in actionData)) return null;
	const { tested } = actionData;
	switch (tested.outcome) {
		case 'sent':
			return { text: `Sent — ${tested.status}`, reading: 'done' };
		case 'refused':
			return { text: `Refused — ${tested.status}`, reading: 'blocked' };
		case 'unanswered':
			return { text: 'No answer', reading: 'blocked' };
	}
}

/** what the header's status line says of the resume that just answered, or nothing. */
function resumeReport(actionData: AdminActionData): Report | null {
	if (actionData && 'resumed' in actionData && typeof actionData.resumed === 'number') {
		const n = actionData.resumed;
		return {
			text: n === 0 ? 'Resumed. Nothing was held.' : `Resumed. ${events(n)} sent again now.`,
			reading: 'done'
		};
	}
	// the one refusal is that it was not paused: the press changed nothing.
	const refusal = resultFor(RESUME_FORM, actionData)?.error?.['']?.at(-1);
	return refusal === undefined ? null : { text: refusal, reading: 'neutral' };
}

export default function Destination({ loaderData, actionData }: Route.ComponentProps) {
	const { id, title, paused, held, confirming } = loaderData;
	const said = useRef<HTMLParagraphElement>(null);
	const deleteLink = useRef<HTMLAnchorElement>(null);
	const resumeLink = useRef<HTMLAnchorElement>(null);
	// where a resume's question hands focus back when nothing opened it: the Resume press while it
	// stands, and the status line once a resume has taken it off the page.
	const resumeReturn = useMemo<RefObject<HTMLElement | null>>(
		() => ({
			get current() {
				return resumeLink.current?.isConnected ? resumeLink.current : said.current;
			}
		}),
		[]
	);
	const navigation = useNavigation();
	// held from the press until its answer lands, and the dots only while the post is out.
	const testing = navigation.formData?.get(WHICH_FORM) === TEST_FORM.id;
	// the line is emptied while a test is out, so its answer is written in afresh even where it
	// says what the last one said, and a live region only announces what changes in it.
	const report = testing ? null : (testReport(actionData) ?? resumeReport(actionData));

	// the add that just landed, written into the status line once the line has been drawn: the add
	// was pressed on another page ($lib/admin/after-paint.ts).
	const arrived = useAfterPaint(loaderData.added ? 'Destination added.' : null);

	return (
		<Column wide>
			<PageHeader
				title={title}
				pageAction={
					<div className="adm-actions">
						{paused ? (
							// a link dressed as a button, because it writes nothing: it asks.
							<Button
								ref={resumeLink}
								as={Link}
								variant="primary"
								to={`${screen(id)}?confirm=resume`}
								preventScrollReset
							>
								Resume
							</Button>
						) : null}
						<Form method="post" preventScrollReset>
							<input {...whichForm(TEST_FORM.id)} />
							<Button
								type="submit"
								aria-busy={testing && navigation.state === 'submitting'}
								aria-disabled={testing || undefined}
								onClick={(event) => {
									if (testing) event.preventDefault();
								}}
							>
								Send a test
							</Button>
						</Form>
						{/* mounted empty and written when a test or a resume answers or an add lands. it
						    takes focus when a resume's dialog comes down after the resume took the Resume
						    press off the page. */}
						<p ref={said} role="status" tabIndex={-1}>
							{report ? (
								<StatusWord register="momentary" {...READINGS[report.reading]}>
									{report.text}
								</StatusWord>
							) : arrived !== null && !testing ? (
								<StatusWord register="momentary">{arrived}</StatusWord>
							) : null}
						</p>
					</div>
				}
			/>
			{paused ? (
				<Banner tone="attention" word="Paused">
					{held === 0
						? 'Events are held until you resume.'
						: `${held === 1 ? 'One event is' : `${held} events are`} held until you resume.`}
				</Banner>
			) : null}
			<RecentDeliveries deliveries={loaderData.deliveries} />
			<SigningSecret secret={loaderData.signingSecret} />
			<Editor loaderData={loaderData} actionData={actionData} />
			<Section>
				<div className="adm-actions">
					<Button ref={deleteLink} as={Link} to={`${screen(id)}?confirm=delete`} preventScrollReset>
						Delete destination
					</Button>
				</div>
			</Section>
			{confirming === 'resume' ? (
				<ResumeCard id={id} held={held} fallbackFocus={resumeReturn} />
			) : null}
			{confirming === 'delete' ? (
				<DeleteCard id={id} title={title} fallbackFocus={deleteLink} />
			) : null}
		</Column>
	);
}

/** each way a delivery can stand, as the list says it and the tone the word takes. */
const OUTCOMES: Record<Loaded['deliveries'][number]['status'], { word: string; tone: Tone }> = {
	delivered: { word: 'Delivered', tone: 'done' },
	pending: { word: 'Waiting', tone: 'attention' },
	failed: { word: 'Failed', tone: 'blocker' },
	dropped: { word: 'Withheld', tone: 'note' }
};

/** the five columns; the shares sum to the whole of the table. */
const DELIVERY_COLUMNS = [
	{ key: 'event', label: 'Event', width: '30%' },
	{ key: 'when', label: 'When', kind: 'date', width: '26%' },
	{ key: 'outcome', label: 'Outcome', width: '18%' },
	{ key: 'answer', label: 'Answer', width: '13%' },
	{ key: 'attempts', label: 'Attempts', kind: 'count', width: '13%' }
] as const;

/** the destination's latest deliveries, newest first, as the loader read them. */
function RecentDeliveries({ deliveries }: { readonly deliveries: Loaded['deliveries'] }) {
	return (
		<Section>
			<h2 id="recent-deliveries-heading">Recent deliveries</h2>
			<DataTable
				namedBy="recent-deliveries-heading"
				columns={DELIVERY_COLUMNS}
				rows={deliveries.map((delivery) => ({
					id: delivery.id,
					cells: {
						event: WEBHOOK_EVENTS[delivery.event],
						when: <time dateTime={delivery.at}>{delivery.when}</time>,
						outcome: (
							<StatusWord tone={OUTCOMES[delivery.status].tone}>
								{OUTCOMES[delivery.status].word}
							</StatusWord>
						),
						answer: delivery.answer,
						attempts: delivery.attempts
					}
				}))}
				empty="No deliveries yet"
			/>
		</Section>
	);
}

/** the secret, masked, with the presses that show it and copy it inside the box. */
function SigningSecret({ secret }: { readonly secret: string }) {
	return (
		<Section>
			<h2 id="signing-secret-heading">Signing secret</h2>
			<Field
				id="signing-secret"
				aria-labelledby="signing-secret-heading"
				value={secret}
				readOnly
				code
				masked
				copyable
				copyLabel="Copy signing secret"
				revealLabel="Show signing secret"
				hideLabel="Hide signing secret"
				spellCheck={false}
				autoComplete="off"
			/>
		</Section>
	);
}

/**
 * the address and events, seeded from the destination and saved in place. the save redirects back
 * here and the fresh read re-seeds the boxes; the button reports it landed.
 */
function Editor({
	loaderData,
	actionData
}: {
	readonly loaderData: Loaded;
	readonly actionData: AdminActionData;
}) {
	const [form, fields] = useAdminForm(EDIT_FORM, actionData, {
		defaultValue: { url: loaderData.url, events: loaderData.events }
	});
	const formProps = getFormProps(form);
	const answers = useAnswerRevision(actionData, formProps.onSubmit);
	const navigation = useNavigation();
	const save = useSaveState({
		landed: loaderData.saved && !actionData,
		changed: form.dirty,
		pending: navigation.state !== 'idle' && navigation.formData?.get(WHICH_FORM) === EDIT_FORM.id
	});

	return (
		<Section>
			<h2>URL and events</h2>
			<Form method="post" preventScrollReset {...formProps} onSubmit={answers.onSubmit}>
				<input {...whichForm(EDIT_FORM.id)} />
				<div className="adm-stack">
					<DestinationFields
						boxes={{ url: fields.url, events: eventsBox(fields.events) }}
						revision={answers.revision}
					/>
					<div className="adm-actions">
						<SaveButton label="Save" state={buttonState(save)} />
					</div>
				</div>
			</Form>
		</Section>
	);
}

/**
 * the resume, asked: everything the pause held is sent again. the form posts to the page's own
 * address, in place of the question's, so the answer lands with the dialog down (the header
 * argues it).
 */
function ResumeCard({
	id,
	held,
	fallbackFocus
}: {
	readonly id: string;
	readonly held: number;
	readonly fallbackFocus: RefObject<HTMLElement | null>;
}) {
	const navigate = useNavigate();
	const navigation = useNavigation();
	const resuming =
		navigation.state !== 'idle' && navigation.formData?.get(WHICH_FORM) === RESUME_FORM.id;

	return (
		<Form method="post" replace preventScrollReset>
			<input {...whichForm(RESUME_FORM.id)} />
			<Modal
				title="Resume this destination?"
				exit="Resume"
				exitProps={{
					type: 'submit',
					// the press's own `formaction`, for the reason ./_app.admin.integrations.zapier.tsx
					// gives: the form takes no `action` attribute.
					formAction: screen(id),
					'aria-busy': resuming,
					'aria-disabled': resuming || undefined,
					onClick: (event) => {
						if (resuming) event.preventDefault();
					}
				}}
				cancel="Cancel"
				cancelProps={{ as: Link, to: screen(id), preventScrollReset: true }}
				onDismiss={() => navigate(screen(id), { preventScrollReset: true })}
				fallbackFocus={fallbackFocus}
			>
				<p className="adm-prose">
					{held === 0
						? 'Nothing is held, so nothing is sent again. New events are sent as they happen.'
						: `The ${events(held)} ${held === 1 ? 'is' : 'are'} sent now.`}
				</p>
			</Modal>
		</Form>
	);
}

/** the delete, asked: nothing more is queued for the destination, and what it was owed is dropped. */
function DeleteCard({
	id,
	title,
	fallbackFocus
}: {
	readonly id: string;
	readonly title: string;
	readonly fallbackFocus: RefObject<HTMLElement | null>;
}) {
	const navigate = useNavigate();
	const navigation = useNavigation();
	const deleting =
		navigation.state !== 'idle' && navigation.formData?.get(WHICH_FORM) === DELETE_FORM.id;

	return (
		<Form method="post" replace preventScrollReset>
			<input {...whichForm(DELETE_FORM.id)} />
			<Modal
				title="Delete this destination?"
				danger="Yes, delete"
				dangerProps={{
					type: 'submit',
					formAction: screen(id),
					'aria-busy': deleting,
					'aria-disabled': deleting || undefined,
					onClick: (event) => {
						if (deleting) event.preventDefault();
					}
				}}
				cancel="Cancel"
				cancelProps={{ as: Link, to: screen(id), preventScrollReset: true }}
				onDismiss={() => navigate(screen(id), { preventScrollReset: true })}
				fallbackFocus={fallbackFocus}
			>
				<p className="adm-prose">
					Nothing more is queued for <InlineCode>{title}</InlineCode>, and events waiting to be sent
					to it are dropped. A delivery already on its way may still arrive in the next two minutes.
				</p>
			</Modal>
		</Form>
	);
}
