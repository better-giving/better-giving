import { Modal } from '@better-giving/operator/behaviour/Dialog';
import { ShownOnce, useShownOnce } from '@better-giving/operator/behaviour/ShownOnce';
import { Button } from '@better-giving/operator/components/controls/Button';
import { CopyControl } from '@better-giving/operator/components/controls/CopyControl';
import { SaveButton } from '@better-giving/operator/components/controls/SaveButton';
import { CodeChip } from '@better-giving/operator/components/data/CodeSlab';
import { DataTable } from '@better-giving/operator/components/data/DataTable';
import { Field } from '@better-giving/operator/components/forms/Field';
import { Column, Grouped, Groups } from '@better-giving/operator/components/shell/Layout';
import { getFormProps } from '@conform-to/react';
import { type RefObject, useEffect, useRef, useState } from 'react';
import { data, Form, Link, useNavigate, useNavigation } from 'react-router';
import { z } from 'zod';
import { screenTitle } from '$lib/admin/screen-title';
import { type AdminActionData, boxProps, useAdminForm, whichForm } from '$lib/admin/use-admin-form';
import { defineForm, WHICH_FORM } from '$lib/forms/definition';
import { publishedOrigin, readAuthEnv, readPin, STAFF_USER_ID } from '$lib/server/auth';
import { invalid, parseForm, submittedForm } from '$lib/server/conform';
import { notFound } from '$lib/server/db/load-failure';
import { redirectWithFlash, SAVED_FLASH, takeFlash } from '$lib/server/flash';
import { agentPromptFor } from '$lib/server/integrations/agent-prompt';
import {
	listApiKeys,
	mintApiKey,
	revokeAndArchiveApiKey,
	revokedApiKeyName
} from '$lib/server/integrations/keys';
import { AGENT_PROMPT_PATH, OPENAPI_PATH } from '$lib/server/integrations/openapi';
import { database, platform, staff } from '../context';
import type { Route } from './+types/_app.admin.integrations.api';

// the keys an organisation's own systems present to /integrations/v1: made and named here, shown
// once, listed by name and never by value, and revoked.
//
// what a key is, how it is stored and why nothing can show it twice is
// `$lib/server/integrations/keys.ts`'s header; what a request presenting one is answered with is
// `$lib/server/integrations/surface.ts`'s. this route turns a press into one of those calls.
//
// **only the deployer's session reaches this page**, the predicate ./_app.admin.members.tsx reads
// — `context.get(staff).id === STAFF_USER_ID` — read here by the loader and by the action alike, and
// by ./_app.tsx to leave the rail's Integrations group out for anyone else. a member's GET and
// POST alike are answered with the dashboard's not-found (`notFound` in
// $lib/server/db/load-failure.ts), the panel an address nothing serves draws, since the rail
// offers them no way here; its body names the rule for an agent that sent the request by hand.
//
// **the key is in the make's answer and nowhere else.** the action answers it rather than
// redirecting, so it rides that one response into `ShownOnce`; no loader returns it, so a reload,
// a revalidation or a second tab lists the name alone. react router keeps an action's answer on the
// page after the card is dismissed, which is why `useShownOnce` keys the dismissal off the value.
//
// a revoke reports by the state it leaves — the row is gone from the list the redirect lands on —
// and says so to a reader who cannot see it go: the key's id rides the redirect as a flash
// ($lib/server/flash.ts), and the loader turns it back into the name a status region reads out.
//
// the API reference and the agent prompt are the read API's two documents, each built for the
// origin this request publishes (`publishedOrigin` in $lib/server/auth/env.ts): the reference is a
// link to the document the deployment serves, and the prompt is copied whole from the loader's
// answer. a copy the clipboard refuses puts a link to the served prompt beside the press, since
// nothing on the page prints it, and the refusal's announcement names that link.
//
// both dialogs take their opener off the page as they answer — a made key remounts the form that
// asked, a revoked row takes its Revoke with it — so each hands `fallbackFocus` the Name box, the
// one control that stands through both answers.

/** the screen's name in the document title. ./_app.tsx names the page in a hidden `h1`. */
const SCREEN_TITLE = 'API';

/** the address this screen answers on, and the one a revoke redirects back to. */
const SCREEN = '/admin/integrations/api';

/** what an empty box and a box the request did not carry are both told. */
const MISSING = 'required';

/** the bound every name box on the dashboard takes; `api_key.name` has no length check of its own. */
const MAX_KEY_NAME = 200;

const MAKE_FORM_ID = 'api-key-make';
const REVOKE_FORM_ID = 'api-key-revoke';
const SCREEN_FORMS = [MAKE_FORM_ID, REVOKE_FORM_ID] as const;

/** the make, which states one box: what the organisation calls the system the key is for. */
const MAKE_FORM = defineForm({
	id: MAKE_FORM_ID,
	schema: z.object({
		name: z
			.string({ error: MISSING })
			.trim()
			.min(1, { error: MISSING })
			.max(MAX_KEY_NAME, { error: `must be at most ${MAX_KEY_NAME} characters` })
	})
});

/**
 * the revoke, which states the row it acts on — a box rather than a path segment, because the
 * question is `?confirm=<id>` on this same address.
 */
const REVOKE_FORM = defineForm({
	id: REVOKE_FORM_ID,
	schema: z.object({
		key_id: z
			.string({ error: MISSING })
			.min(1, { error: MISSING })
			.max(64, { error: 'must be at most 64 characters' })
	})
});

/** the body of a member's not-found. the panel ../root.tsx draws does not show it; an agent reads it. */
const NOT_HERE =
	`No page at ${SCREEN} for a member’s session. API keys are made and revoked from the ` +
	'deployer’s session: sign in with `ADMIN_PASSWORD` at /login.';

/**
 * a day as the list says it — `2 Sep 2026` — in UTC, where the instant was stored. formatted by the
 * loader, so the Worker's render and the browser's hydration read one string.
 */
const MONTH = new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' });
const dayOf = (at: Date) => `${at.getUTCDate()} ${MONTH.format(at)} ${at.getUTCFullYear()}`;

export function meta({ matches }: Route.MetaArgs): Route.MetaDescriptors {
	return [{ title: screenTitle(SCREEN_TITLE, matches) }];
}

export async function loader({ context, request, url }: Route.LoaderArgs) {
	if (context.get(staff).id !== STAFF_USER_ID) notFound(NOT_HERE);

	const db = context.get(database);
	const keys = (await listApiKeys(db)).map((key) => ({
		id: key.id,
		name: key.name,
		madeAt: key.createdAt.toISOString(),
		madeOn: dayOf(key.createdAt),
		lastUsedAt: key.lastUsedAt?.toISOString() ?? null,
		lastUsedOn: key.lastUsedAt === null ? 'Never' : dayOf(key.lastUsedAt)
	}));

	// the key a revoke is being confirmed for, held in the address so the question can be shared,
	// reloaded and backed out of; an id no listed row answers to asks nothing.
	const asked = url.searchParams.get('confirm');

	// the revoke that just landed, taken: read and cleared on this one response, so a reload says
	// nothing. the marker is the key's id and the name is read back from the row it names.
	const landed = await takeFlash(request, SAVED_FLASH);
	const revoked = landed === null ? null : await revokedApiKeyName(db, landed.marker);

	const published = publishedOrigin(url, readPin(readAuthEnv(context.get(platform).env)));
	return data(
		{
			keys,
			revoking: keys.find((key) => key.id === asked) ?? null,
			revoked,
			apiReference: `${published}${OPENAPI_PATH}`,
			agentPrompt: agentPromptFor(published),
			agentPromptHref: `${published}${AGENT_PROMPT_PATH}`
		},
		landed === null ? {} : { headers: { 'Set-Cookie': landed.clear } }
	);
}

/**
 * both writes this screen performs. **the request body is read exactly once, here** — and not at
 * all for a member, who is answered before it.
 */
export async function action(args: Route.ActionArgs) {
	if (args.context.get(staff).id !== STAFF_USER_ID) notFound(NOT_HERE);

	const body = await args.request.formData();
	switch (submittedForm(body, SCREEN_FORMS)) {
		case MAKE_FORM_ID:
			return make(args, body);
		case REVOKE_FORM_ID:
			return revoke(args, body);
	}

	// the arms are declared inside the action because react router strips the `action` export from
	// the browser bundle and nothing else: a module-scope helper reaching `$lib/server/**` would ship
	// D1 to the browser (./_app.admin.members.tsx says the same; ../routes.spec.ts holds it).

	/**
	 * mint the key and answer with it. an answer rather than a redirect, because the answer is the
	 * one place the key may travel; a reload after it is a GET and lists the name alone.
	 */
	async function make({ context }: Route.ActionArgs, body: FormData) {
		const submission = parseForm(body, MAKE_FORM);
		if (!submission.ok) return invalid(400, submission.reject());

		const { name } = submission.value;
		const minted = await mintApiKey(context.get(database), { name, kind: 'api' });
		return { made: { name, key: minted.key } };
	}

	/**
	 * revoke the key and take it off the list, in the one statement `revokeAndArchiveApiKey` is. a key
	 * already gone, and an id naming no listed key, land here with the rest: a second press of the
	 * same button is the ordinary way to reach them, and the row is gone either way.
	 */
	async function revoke({ context, request }: Route.ActionArgs, body: FormData) {
		const submission = parseForm(body, REVOKE_FORM);
		if (!submission.ok) return invalid(400, submission.reject());

		const id = submission.value.key_id;
		await revokeAndArchiveApiKey(context.get(database), id);
		return redirectWithFlash(request, SAVED_FLASH, SCREEN, id);
	}
}

type ListedKey = Route.ComponentProps['loaderData']['keys'][number];

export default function Api({ loaderData, actionData }: Route.ComponentProps) {
	const made = actionData && 'made' in actionData ? actionData.made : undefined;
	const [shown, done] = useShownOnce(made?.key);
	const nameBox = useRef<HTMLInputElement>(null);
	const [promptRefused, setPromptRefused] = useState(false);

	return (
		<Column wide>
			<Groups>
				<Grouped>
					{/* remounted on each key made, so the box empties: a create form that stays on its
					    screen starts over once it has answered. */}
					<MakeKey key={made?.key ?? 'none'} actionData={actionData} box={nameBox} />
					<div className="adm-actions">
						<Button
							as="a"
							href={loaderData.apiReference}
							target="_blank"
							rel="noreferrer"
							variant="quiet"
							size="sm"
							markAfter="external-link"
						>
							API reference
						</Button>
						<CopyControl
							text={loaderData.agentPrompt}
							wording="Copy agent prompt"
							wayOut="Open agent prompt, after this button, opens it to copy by hand."
							onBlocked={() => setPromptRefused(true)}
						/>
						{promptRefused ? (
							<Button
								as="a"
								href={loaderData.agentPromptHref}
								target="_blank"
								rel="noreferrer"
								variant="quiet"
								size="sm"
								markAfter="external-link"
							>
								Open agent prompt
							</Button>
						) : null}
					</div>
				</Grouped>
				<KeyPlane keys={loaderData.keys} />
			</Groups>
			{/* mounted empty and written when a revoke lands, so the words are a change a reader
			    hears rather than an element that arrived holding them. */}
			<p className="adm-vh" role="status">
				{loaderData.revoked === null ? null : `Revoked ${loaderData.revoked}.`}
			</p>
			{loaderData.revoking ? (
				<RevokeCard row={loaderData.revoking} fallbackFocus={nameBox} />
			) : null}
			{shown && made ? (
				<ShownOnce
					title={
						<>
							Copy the key for <CodeChip>{made.name}</CodeChip>
						</>
					}
					secret={shown}
					copyLabel="Copy the key"
					onDone={done}
					fallbackFocus={nameBox}
				/>
			) : null}
		</Column>
	);
}

/**
 * the name box and Make key on one row. the press is a `SaveButton` held only while its own
 * submission is in flight: an empty box still submits, so the press answers with `required` under
 * the box and conform puts the caret there, rather than resting closed and saying nothing. what
 * reports a key made is the card, so the press never draws a tick.
 */
function MakeKey({
	actionData,
	box
}: {
	readonly actionData: AdminActionData;
	readonly box: RefObject<HTMLInputElement | null>;
}) {
	const [form, fields] = useAdminForm(MAKE_FORM, actionData);
	const navigation = useNavigation();

	// this form's own submission, through the `loading` that follows it: a press re-armed before the
	// answer lands is a second key for one intent.
	const making =
		navigation.state !== 'idle' && navigation.formData?.get(WHICH_FORM) === MAKE_FORM.id;

	// the box, handed up for the dialogs' `fallbackFocus`. found by the id conform gave it because
	// `Field` takes no ref of its own; set again on each remount, so it is always the box on the page.
	const boxId = fields.name.id;
	useEffect(() => {
		const found = document.getElementById(boxId);
		box.current = found instanceof HTMLInputElement ? found : null;
	}, [box, boxId]);

	return (
		<Form method="post" {...getFormProps(form)}>
			<input {...whichForm(MAKE_FORM.id)} />
			<Field
				{...boxProps(fields.name)}
				label="Name"
				autoComplete="off"
				required
				beside={<SaveButton label="Make key" state={making ? 'pending' : 'idle'} />}
			/>
		</Form>
	);
}

/** the four columns; the shares sum to the whole of the table. */
const COLUMNS = [
	{ key: 'name', label: 'Name', width: '40%' },
	{ key: 'made', label: 'Made', kind: 'date', width: '22%' },
	{ key: 'used', label: 'Last used', kind: 'date', width: '22%' },
	{ key: 'revoke', label: 'Revoke', width: '16%' }
] as const;

const KEYS_HEADING_ID = 'api-keys-heading';

function KeyPlane({ keys }: { readonly keys: readonly ListedKey[] }) {
	return (
		<>
			{/* the table's name, with rows or without, and drawn for no eye: an organisation holds a
			    handful of keys and counts them at a glance, so the table takes no caption, and
			    `DataTable` names a table with rows from a caption only by drawing it. */}
			<h2 className="adm-vh" id={KEYS_HEADING_ID}>
				API keys
			</h2>
			<DataTable
				namedBy={KEYS_HEADING_ID}
				columns={COLUMNS}
				rows={keys.map((key) => ({
					id: key.id,
					cells: {
						name: key.name,
						made: <time dateTime={key.madeAt}>{key.madeOn}</time>,
						used:
							key.lastUsedAt === null ? (
								key.lastUsedOn
							) : (
								<time dateTime={key.lastUsedAt}>{key.lastUsedOn}</time>
							),
						// a link dressed as a button, because it writes nothing: it asks. named from its row,
						// so a reader meeting it out of context is told which key it stops.
						revoke: (
							<Button
								as={Link}
								size="sm"
								to={`${SCREEN}?confirm=${encodeURIComponent(key.id)}`}
								preventScrollReset
								aria-label={`Revoke ${key.name}`}
							>
								Revoke
							</Button>
						)
					}
				}))}
				empty="No keys yet"
			/>
		</>
	);
}

/**
 * the question over the list, in the top layer: revoking stops every system holding the key, and
 * that cannot be taken back — a revoked key is never admitted again, only replaced.
 *
 * the press reports at itself: held busy while its own submission is in flight, and answered by
 * the list it lands on and the page's status region. the `<form>` stands around the whole card,
 * which is the rule `Dialog` states for a submit in its actions row.
 */
function RevokeCard({
	row,
	fallbackFocus
}: {
	readonly row: ListedKey;
	readonly fallbackFocus: RefObject<HTMLElement | null>;
}) {
	const navigate = useNavigate();
	const navigation = useNavigation();
	const revoking =
		navigation.state !== 'idle' && navigation.formData?.get(WHICH_FORM) === REVOKE_FORM.id;

	return (
		<Form method="post" preventScrollReset>
			<input {...whichForm(REVOKE_FORM.id)} />
			<input type="hidden" name="key_id" value={row.id} />
			<Modal
				title={
					<>
						Revoke <CodeChip>{row.name}</CodeChip>?
					</>
				}
				// the title names the key; the press does not say it again, so a long name cannot break it.
				danger="Yes, revoke"
				dangerProps={{
					type: 'submit',
					'aria-busy': revoking,
					'aria-disabled': revoking || undefined,
					onClick: (event) => {
						if (revoking) event.preventDefault();
					}
				}}
				cancel="Cancel"
				cancelProps={{ as: Link, to: SCREEN, preventScrollReset: true }}
				onDismiss={() => navigate(SCREEN, { preventScrollReset: true })}
				fallbackFocus={fallbackFocus}
			>
				<p className="adm-prose">Every request made with it is refused from now on.</p>
				<p className="adm-prose">
					{row.lastUsedAt === null
						? 'It has never been used.'
						: `It was last used on ${row.lastUsedOn}.`}
				</p>
			</Modal>
		</Form>
	);
}
