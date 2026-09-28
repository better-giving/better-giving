import { Modal } from '@better-giving/operator/behaviour/Dialog';
import { Button } from '@better-giving/operator/components/controls/Button';
import { CreateCard } from '@better-giving/operator/components/data/CreateCard';
import { Disclosure } from '@better-giving/operator/components/data/Disclosure';
import { Press } from '@better-giving/operator/components/data/Press';
import { Field } from '@better-giving/operator/components/forms/Field';
import { Column, List } from '@better-giving/operator/components/shell/Layout';
import { Banner } from '@better-giving/operator/components/status/Banner';
import { Mark } from '@better-giving/operator/components/status/Mark';
import { StatusWord } from '@better-giving/operator/components/status/StatusWord';
import { MarkedText } from '@better-giving/operator/marked-text.react';
import { getFormProps } from '@conform-to/react';
import { type MouseEvent, type ReactNode, useSyncExternalStore } from 'react';
import { Form, href, Link, redirect, useNavigate, useNavigation } from 'react-router';
import { z } from 'zod';
import { CHAT_PARAM } from '$lib/admin/editor/chat-wiring';
import {
	type AdminActionData,
	boxProps,
	recordVersion,
	resultFor,
	useAdminForm,
	whichForm
} from '$lib/admin/use-admin-form';
import { screenTitle } from '$lib/admin/screen-title';
import { formatMinorBrief } from '$lib/donations/money';
import { FORM_CURRENCY } from '$lib/forms/amounts';
import { defineForm, type RejectionStatus, WHICH_FORM } from '$lib/forms/definition';
import { dayWords } from '$lib/page/end-date';
import { stateAt } from '$lib/page/ended';
import { NEW_CAMPAIGN_SCHEMA } from '$lib/page/new-campaign';
import {
	invalid,
	type ParsedForm,
	parseForm,
	submittedForm,
	submittedVersion
} from '$lib/server/conform';
import { loadFailed } from '$lib/server/db/load-failure';
import { type CampaignListing, createCampaign, readCampaigns } from '$lib/server/pages/campaign';
import { publishPage } from '$lib/server/pages/publish';
import { deleteNeverPublishedCampaign, endCampaign, readPage } from '$lib/server/pages/queries';
import { database, platform } from '../context';
import type { Route } from './+types/_app.admin.campaigns._index';

// the Campaigns list: every campaign with its name, address, state, goal and end date, each linking
// to its editor, the ended ones in a collapsed group of their own; and New campaign, a dialog on
// `?new` whose action makes the campaign ($lib/server/pages/campaign.ts) and opens its editor — on
// its chat when a "What's it for?" line drafted it, the first turn already answered. the Donation
// page is no campaign and is not on this list.
//
// each row has the one press its state allows. End on a live campaign and Delete on one never
// published each ask first, in a dialog on `?end={id}` or `?delete={id}`; Publish on an ended one
// is the editor's own Publish of its draft (`publishPage`), end date rule and all, and asks nothing
// as that one does not. End keeps the published page and the draft (`endCampaign`), and Delete is
// only ever of a campaign nobody was shown (`deleteNeverPublishedCampaign` argues why). every press is
// written against the version its row was drawn at, so a row changed since — in its editor, in
// another tab — is refused rather than acted on, and a press naming the Donation page names no
// campaign. a live campaign past its published end date is an ended one here, in its group and to
// its presses, as everywhere ($lib/page/ended.ts).
//
// the goal and end date are the draft's, which is what the editor shows. an end date is the day
// chosen, in the zone it was chosen in ($lib/page/end-date.ts's `endDayOf`), so every operator reads
// the same day wherever they are.

const SCREEN_TITLE = 'Campaigns';

const SCREEN = href('/admin/campaigns');

/** where New campaign is asked, on this same address. */
const ASKING = `${SCREEN}?new`;

/** a campaign's editor, which the create opens. */
const editorOf = (pageId: string) => `${SCREEN}/${encodeURIComponent(pageId)}`;

const WRITE_FAILED = 'Making this campaign failed and nothing was saved. Try again.';

/** the dialog asking whether to end the campaign whose id it carries. */
const END_PARAM = 'end';
/** the dialog asking whether to delete the campaign whose id it carries. */
const DELETE_PARAM = 'delete';

const CREATE_FORM_ID = 'campaign-create';
const END_FORM_ID = 'campaign-end';
const DELETE_FORM_ID = 'campaign-delete';
const PUBLISH_FORM_ID = 'campaign-publish';
const FORM_IDS = [CREATE_FORM_ID, END_FORM_ID, DELETE_FORM_ID, PUBLISH_FORM_ID] as const;
type RowPress = typeof END_FORM_ID | typeof DELETE_FORM_ID | typeof PUBLISH_FORM_ID;

const CAMPAIGN_CREATE = defineForm({ id: CREATE_FORM_ID, schema: NEW_CAMPAIGN_SCHEMA });

/** the box a row's press names its campaign in. */
const PAGE_ID = 'page_id';
const ROW_PRESS = z.object({ [PAGE_ID]: z.string() });

const CAMPAIGN_END = defineForm({ id: END_FORM_ID, schema: ROW_PRESS });
const CAMPAIGN_DELETE = defineForm({ id: DELETE_FORM_ID, schema: ROW_PRESS });
const CAMPAIGN_PUBLISH = defineForm({ id: PUBLISH_FORM_ID, schema: ROW_PRESS });

/** what each press does, as a refusal says it did not. */
const DONE: Record<RowPress, string> = {
	[END_FORM_ID]: 'ended',
	[DELETE_FORM_ID]: 'deleted',
	[PUBLISH_FORM_ID]: 'published'
};

/** the one state each press acts on. */
const ACTS_ON: Record<RowPress, CampaignListing['state']> = {
	[END_FORM_ID]: 'live',
	[DELETE_FORM_ID]: 'never_published',
	[PUBLISH_FORM_ID]: 'ended'
};

/** why a campaign at the version pressed is not one the press acts on. */
const NOT_THIS_STATE: Record<RowPress, string> = {
	[END_FORM_ID]:
		'Nothing was ended: this campaign is not live. A campaign never published is deleted rather than ended.',
	[DELETE_FORM_ID]:
		'Nothing was deleted: this campaign has been published, and gifts may point at it. End it instead.',
	[PUBLISH_FORM_ID]:
		'Nothing was published: this campaign has not ended. Publish it from its editor.'
};

const STALE =
	'Nothing was changed: this campaign has been changed since this list was opened. Reload the page, then try again.';

const PRESS_FAILED: Record<RowPress, string> = {
	[END_FORM_ID]: 'Ending this campaign failed and nothing was changed. Try again.',
	[DELETE_FORM_ID]: 'Deleting this campaign failed and nothing was changed. Try again.',
	[PUBLISH_FORM_ID]: 'Publishing this campaign failed and nothing was changed. Try again.'
};

/** a press naming a page that is no campaign: gone since the list was drawn, or the Donation page. */
function noCampaign(press: RowPress, pageId: string): string {
	return `Nothing was ${DONE[press]}: \`${PAGE_ID}\` ${pageId} names no campaign. It may have been deleted since this list was opened, so reload the page. The Donation page is not a campaign and is never ended, deleted or published from here.`;
}

/** what a zone-less press — one made before the page ran in a browser — reads a date in. */
const ZONE_UNKNOWN = 'UTC';

export function meta({ matches }: Route.MetaArgs): Route.MetaDescriptors {
	return [{ title: screenTitle(SCREEN_TITLE, matches) }];
}

export async function loader({ context, url }: Route.LoaderArgs) {
	const now = Date.now();
	let listed: CampaignListing[];
	try {
		listed = await readCampaigns(context.get(database), now);
	} catch (e) {
		console.error('loading the campaigns page failed:', e);
		loadFailed('This page');
	}
	const rows = listed.map((campaign) => ({
		id: campaign.id,
		name: campaign.name,
		address: campaign.slug === null ? null : `/${campaign.slug}`,
		state: campaign.state,
		version: campaign.updatedAt.getTime(),
		goal: campaign.goalMinor === null ? null : formatMinorBrief(campaign.goalMinor, FORM_CURRENCY),
		// a campaign ended before its end date did not end on it.
		ends:
			campaign.end === null || (campaign.state === 'ended' && campaign.end.at > now)
				? null
				: dayWords(campaign.end.day)
	}));
	// a dialog naming a campaign not in the state it acts on — ended or published since the address
	// was copied — is not drawn.
	const asked = (param: string, state: CampaignListing['state']) =>
		rows.find((row) => row.id === url.searchParams.get(param) && row.state === state) ?? null;
	return {
		campaigns: rows.filter((row) => row.state !== 'ended'),
		ended: rows.filter((row) => row.state === 'ended'),
		asking: url.searchParams.has('new'),
		ending: asked(END_PARAM, 'live'),
		deleting: asked(DELETE_PARAM, 'never_published')
	};
}

export async function action({ context, request }: Route.ActionArgs) {
	const body = await request.formData();
	const db = context.get(database);
	switch (submittedForm(body, FORM_IDS)) {
		case CREATE_FORM_ID:
			return create(parseForm(body, CAMPAIGN_CREATE));
		case END_FORM_ID:
			return rowPress(END_FORM_ID, parseForm(body, CAMPAIGN_END));
		case DELETE_FORM_ID:
			return rowPress(DELETE_FORM_ID, parseForm(body, CAMPAIGN_DELETE));
		case PUBLISH_FORM_ID:
			return rowPress(PUBLISH_FORM_ID, parseForm(body, CAMPAIGN_PUBLISH));
	}

	async function create(submission: ParsedForm<z.output<typeof NEW_CAMPAIGN_SCHEMA>>) {
		if (!submission.ok) return invalid(400, submission.reject());
		const { title, purpose, time_zone } = submission.value;

		let made: Awaited<ReturnType<typeof createCampaign>>;
		try {
			made = await createCampaign(db, context.get(platform).env, {
				title,
				line: purpose ?? '',
				timeZone: time_zone ?? ZONE_UNKNOWN,
				now: Date.now()
			});
		} catch (e) {
			console.error('making a campaign failed:', e);
			return invalid(500, submission.reject({ formErrors: [WRITE_FAILED] }));
		}
		const drafted = (purpose ?? '').trim() !== '';
		return redirect(drafted ? `${editorOf(made.pageId)}?${CHAT_PARAM}` : editorOf(made.pageId));
	}

	/**
	 * End, Delete or Publish on one row. the row is read to say why a press is refused, and the
	 * write carries the version itself, so a campaign changed between the read and the write is
	 * refused too. the page id rides back beside a refusal, which is how the screen finds its row.
	 */
	async function rowPress(press: RowPress, submission: ParsedForm<z.output<typeof ROW_PRESS>>) {
		if (!submission.ok) return invalid(400, submission.reject());
		const seen = submittedVersion(body);
		const pageId = submission.value[PAGE_ID];
		const refuse = (status: RejectionStatus, text: string) =>
			invalid(status, submission.reject({ formErrors: [text] }), { pageId });

		try {
			const now = Date.now();
			const row = await readPage(db, pageId);
			if (row === null || row.type !== 'campaign') return refuse(404, noCampaign(press, pageId));
			if (row.updatedAt.getTime() !== seen.getTime()) return refuse(409, STALE);
			if (stateAt(row, now) !== ACTS_ON[press]) return refuse(409, NOT_THIS_STATE[press]);

			switch (press) {
				case END_FORM_ID:
					return (await endCampaign(db, pageId, seen)) ? redirect(SCREEN) : refuse(409, STALE);
				case DELETE_FORM_ID:
					return (await deleteNeverPublishedCampaign(db, pageId, seen))
						? redirect(SCREEN)
						: refuse(409, STALE);
				case PUBLISH_FORM_ID: {
					const published = await publishPage(db, { type: 'campaign', id: pageId }, seen, {
						now
					});
					switch (published.kind) {
						case 'published':
							return redirect(SCREEN);
						case 'refused':
							return refuse(422, published.text);
						case 'stale':
							return refuse(409, STALE);
						case 'gone':
							return refuse(404, noCampaign(press, pageId));
					}
				}
			}
		} catch (e) {
			console.error(`${press} on page ${pageId} failed:`, e);
			return refuse(500, PRESS_FAILED[press]);
		}
	}
}

type Row = Route.ComponentProps['loaderData']['campaigns'][number];

const STATE_WORDS: Record<Row['state'], string> = {
	live: 'Live',
	never_published: 'Not published',
	ended: 'Ended'
};

/** the browser's zone, and none while the page is drawn on the server or hydrating. */
function useTimeZone(): string | null {
	return useSyncExternalStore(
		subscribeToNothing,
		() => Intl.DateTimeFormat().resolvedOptions().timeZone,
		() => null
	);
}

function subscribeToNothing() {
	return () => {};
}

/* a campaign as the create card's hidden sample draws it, so the card stands a record's height.
   no link and no heading inside: `CreateCard`'s `ghost` says why. */
const SAMPLE = (
	<div className="adm-record">
		<div className="adm-record__head adm-record__head--marked">
			<span className="adm-record__mark">
				<Mark name="megaphone" />
			</span>
			<span className="adm-record__title">Winter coat drive</span>
			<StatusWord tone="done">Live</StatusWord>
		</div>
		<p className="adm-record__facts">Goal $15,000 · Ends Dec 31, 2026</p>
		<div className="adm-record__row">
			<ul className="adm-record__origins adm-record__foot">
				<li>
					<span className="adm-chip adm-press">/winter-coat-drive</span>
				</li>
			</ul>
			<span className="adm-btn adm-btn--quiet adm-btn--sm">End</span>
		</div>
	</div>
);

/** the page id a refused row press carries back, beside the refusal. */
function refusedRow(actionData: AdminActionData): string | null {
	const pageId = actionData?.pageId;
	return typeof pageId === 'string' ? pageId : null;
}

/** what the last press of `form` on the row `pageId` was refused with; nothing where it was not. */
function rowRefusal(
	form: { readonly id: string },
	pageId: string,
	actionData: AdminActionData
): string | undefined {
	if (refusedRow(actionData) !== pageId) return undefined;
	return resultFor(form, actionData)?.error?.['']?.at(-1);
}

/**
 * whether `form`'s press on the row `pageId` is in flight — held through the redirect's load too, so
 * a second press cannot land on the row the first already moved and be refused as stale.
 */
function usePressing(form: { readonly id: string }, pageId: string): boolean {
	const navigation = useNavigation();
	return (
		navigation.state !== 'idle' &&
		navigation.formAction?.split('?')[0] === SCREEN &&
		navigation.formData?.get(WHICH_FORM) === form.id &&
		navigation.formData.get(PAGE_ID) === pageId
	);
}

/** the three hidden boxes every row press posts: which press, the row's version, and the row. */
function RowPressBoxes({
	form,
	row
}: {
	readonly form: { readonly id: string };
	readonly row: Row;
}) {
	return (
		<>
			<input {...whichForm(form.id)} />
			<input {...recordVersion(row.version)} />
			<input type="hidden" name={PAGE_ID} value={row.id} />
		</>
	);
}

export default function Campaigns({ loaderData, actionData }: Route.ComponentProps) {
	const { campaigns, ended, asking, ending, deleting } = loaderData;
	const zone = useTimeZone();

	return (
		<Column>
			<List>
				<CreateCard as={Link} to={ASKING} preventScrollReset ghost={SAMPLE}>
					New campaign
				</CreateCard>
				{campaigns.map((row) => (
					<CampaignRecord key={row.id} row={row} actionData={actionData} />
				))}
			</List>

			{ended.length === 0 ? null : (
				<Disclosure summary={`Ended (${ended.length})`}>
					<List>
						{ended.map((row) => (
							<CampaignRecord key={row.id} row={row} actionData={actionData} />
						))}
					</List>
				</Disclosure>
			)}

			{asking ? <NewCampaignCard actionData={actionData} zone={zone} /> : null}
			{ending ? (
				<RowConfirm
					form={CAMPAIGN_END}
					row={ending}
					title={`End ${ending.name}?`}
					act="End campaign"
					word="Not ended"
					refusal={rowRefusal(CAMPAIGN_END, ending.id, actionData)}
				>
					<p className="adm-prose">
						<code className="adm-chip">{ending.address}</code> will say the campaign has ended and
						link to <code className="adm-chip">/donate</code>. Monthly gifts started on it keep
						charging until they’re stopped.
					</p>
				</RowConfirm>
			) : null}
			{deleting ? (
				<RowConfirm
					form={CAMPAIGN_DELETE}
					row={deleting}
					title={`Delete ${deleting.name}?`}
					act="Delete"
					word="Not deleted"
					refusal={rowRefusal(CAMPAIGN_DELETE, deleting.id, actionData)}
				>
					<p className="adm-prose">It was never published. This can’t be undone.</p>
				</RowConfirm>
			) : null}
		</Column>
	);
}

function CampaignRecord({
	row,
	actionData
}: {
	readonly row: Row;
	readonly actionData: Route.ComponentProps['actionData'];
}) {
	const publishing = usePressing(CAMPAIGN_PUBLISH, row.id);
	const refusal = rowRefusal(CAMPAIGN_PUBLISH, row.id, actionData);
	const facts = [
		row.goal === null ? null : `Goal ${row.goal}`,
		row.ends === null ? null : `${row.state === 'ended' ? 'Ended' : 'Ends'} ${row.ends}`
	].filter((fact) => fact !== null);

	return (
		<article className="adm-record">
			<div className="adm-record__head adm-record__head--marked">
				<span className="adm-record__mark">
					<Mark name="megaphone" />
				</span>
				<h2 className="adm-record__title">
					<Link to={editorOf(row.id)}>{row.name}</Link>
				</h2>
				<StatusWord
					tone={
						row.state === 'live'
							? 'done'
							: row.state === 'never_published'
								? 'attention'
								: undefined
					}
					secondary={row.state === 'ended'}
				>
					{STATE_WORDS[row.state]}
				</StatusWord>
			</div>
			{facts.length === 0 ? null : <p className="adm-record__facts">{facts.join(' · ')}</p>}
			<div className="adm-record__row">
				{row.address === null ? null : (
					// biome-ignore lint/a11y/noRedundantRoles: no marker and a flex row, as `RecordCard` states it.
					<ul role="list" className="adm-record__origins adm-record__foot">
						{row.state === 'never_published' ? (
							// nothing answers there until the first Publish, so it is no link yet.
							<li>
								<code className="adm-chip">{row.address}</code>
							</li>
						) : (
							<Press
								words
								as="a"
								href={row.address}
								aria-label={`Open ${row.name} at ${row.address}`}
							>
								{row.address}
							</Press>
						)}
					</ul>
				)}
				{row.state === 'live' ? (
					// a link, because it writes nothing: it asks.
					<Button
						as={Link}
						to={`${SCREEN}?${END_PARAM}=${encodeURIComponent(row.id)}`}
						preventScrollReset
						variant="quiet"
						size="sm"
						aria-label={`End ${row.name}`}
					>
						End
					</Button>
				) : row.state === 'never_published' ? (
					<Button
						as={Link}
						to={`${SCREEN}?${DELETE_PARAM}=${encodeURIComponent(row.id)}`}
						preventScrollReset
						variant="quiet"
						size="sm"
						mark="trash-2"
						aria-label={`Delete ${row.name}`}
					>
						Delete
					</Button>
				) : (
					<Form method="post" preventScrollReset>
						<RowPressBoxes form={CAMPAIGN_PUBLISH} row={row} />
						<Button
							type="submit"
							variant="quiet"
							size="sm"
							aria-label={`Publish ${row.name}`}
							aria-disabled={publishing}
							aria-busy={publishing}
							onClick={(event: MouseEvent<HTMLButtonElement>) => {
								if (publishing) event.preventDefault();
							}}
						>
							Publish
						</Button>
					</Form>
				)}
			</div>
			{refusal === undefined ? null : (
				<Banner tone="blocker" word="Not published">
					<MarkedText text={refusal} />
				</Banner>
			)}
		</article>
	);
}

/**
 * End's or Delete's question about one row, in the top layer while the address asks it. the act
 * posts the row's own press, and leaving is a navigation back to the list, as New campaign's is.
 */
function RowConfirm({
	form,
	row,
	title,
	act,
	word,
	refusal,
	children
}: {
	readonly form: { readonly id: string };
	readonly row: Row;
	readonly title: string;
	readonly act: string;
	/** the refusal's word, saying the act did not happen. */
	readonly word: string;
	readonly refusal: string | undefined;
	readonly children: ReactNode;
}) {
	const navigate = useNavigate();
	const pressing = usePressing(form, row.id);
	return (
		<Form method="post" preventScrollReset>
			<RowPressBoxes form={form} row={row} />
			<Modal
				title={title}
				danger={act}
				dangerProps={{
					type: 'submit',
					'aria-disabled': pressing,
					'aria-busy': pressing,
					onClick: (event: MouseEvent<HTMLButtonElement>) => {
						if (pressing) event.preventDefault();
					}
				}}
				cancel="Cancel"
				cancelProps={{ as: Link, to: SCREEN, preventScrollReset: true }}
				onDismiss={() => navigate(SCREEN, { preventScrollReset: true })}
			>
				<div className="adm-stack">
					{children}
					{refusal === undefined ? null : (
						<Banner tone="blocker" word={word}>
							<MarkedText text={refusal} />
						</Banner>
					)}
				</div>
			</Modal>
		</Form>
	);
}

/**
 * New campaign, in the top layer while the address asks for it. the `<form>` stands around the
 * whole card, as `Dialog` requires.
 */
function NewCampaignCard({
	actionData,
	zone
}: {
	readonly actionData: Route.ComponentProps['actionData'];
	readonly zone: string | null;
}) {
	const navigate = useNavigate();
	const navigation = useNavigation();
	const [form, fields] = useAdminForm(CAMPAIGN_CREATE, actionData, {
		defaultValue: { title: '', purpose: '', time_zone: '' }
	});
	// held from the press through the redirect's load, so a second press cannot make a second
	// campaign while the first — and its first chat turn — is still being written.
	const creating =
		navigation.state !== 'idle' &&
		navigation.formAction?.split('?')[0] === SCREEN &&
		navigation.formData?.get(WHICH_FORM) === CAMPAIGN_CREATE.id;
	// the zone is a hidden box, so a refusal of it is said with the form's own.
	const refusal = form.errors?.[0] ?? fields.time_zone.errors?.[0];

	return (
		<Form method="post" preventScrollReset {...getFormProps(form)}>
			<input {...whichForm(CAMPAIGN_CREATE.id)} />
			<input type="hidden" name={fields.time_zone.name} value={zone ?? ''} />
			<Modal
				title="New campaign"
				commit="Create"
				commitProps={{
					type: 'submit',
					'aria-disabled': creating,
					'aria-busy': creating,
					onClick: (event: MouseEvent<HTMLButtonElement>) => {
						if (creating) event.preventDefault();
					}
				}}
				cancel="Cancel"
				cancelProps={{ as: Link, to: SCREEN, preventScrollReset: true }}
				onDismiss={() => navigate(SCREEN, { preventScrollReset: true })}
			>
				<div className="adm-stack">
					<Field
						label="Title"
						required
						placeholder="Winter coat drive"
						{...boxProps(fields.title)}
						error={
							fields.title.errors?.[0] === undefined ? undefined : (
								<MarkedText text={fields.title.errors[0]} />
							)
						}
					/>
					<Field
						as="textarea"
						label="What's it for?"
						optional
						placeholder="Coats for 300 kids, goal $15k by Dec 31"
						{...boxProps(fields.purpose)}
						error={
							fields.purpose.errors?.[0] === undefined ? undefined : (
								<MarkedText text={fields.purpose.errors[0]} />
							)
						}
					/>
					{refusal ? (
						<Banner tone="blocker" word="Not created">
							<MarkedText text={refusal} />
						</Banner>
					) : null}
				</div>
			</Modal>
		</Form>
	);
}
