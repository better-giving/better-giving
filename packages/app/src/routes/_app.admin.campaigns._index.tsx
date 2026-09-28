import { Modal } from '@better-giving/operator/behaviour/Dialog';
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
import { type MouseEvent, useSyncExternalStore } from 'react';
import { Form, href, Link, redirect, useNavigate, useNavigation } from 'react-router';
import { CHAT_PARAM } from '$lib/admin/editor/chat-wiring';
import { boxProps, useAdminForm } from '$lib/admin/use-admin-form';
import { screenTitle } from '$lib/admin/screen-title';
import { formatMinorBrief } from '$lib/donations/money';
import { FORM_CURRENCY } from '$lib/forms/amounts';
import { defineForm } from '$lib/forms/definition';
import { dayWords } from '$lib/page/end-date';
import { NEW_CAMPAIGN_SCHEMA } from '$lib/page/new-campaign';
import { invalid, parseForm } from '$lib/server/conform';
import { loadFailed } from '$lib/server/db/load-failure';
import { type CampaignListing, createCampaign, readCampaigns } from '$lib/server/pages/campaign';
import { database, platform } from '../context';
import type { Route } from './+types/_app.admin.campaigns._index';

// the Campaigns list: every campaign with its name, address, state, goal and end date, each linking
// to its editor, the ended ones in a collapsed group of their own; and New campaign, a dialog on
// `?new` whose action makes the campaign ($lib/server/pages/campaign.ts) and opens its editor — on
// its chat when a "What's it for?" line drafted it, the first turn already answered. the Donation
// page is no campaign and is not on this list.
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

const CAMPAIGN_CREATE = defineForm({ id: 'campaign-create', schema: NEW_CAMPAIGN_SCHEMA });

const WRITE_FAILED = 'Making this campaign failed and nothing was saved. Try again.';

/** what a zone-less press — one made before the page ran in a browser — reads a date in. */
const ZONE_UNKNOWN = 'UTC';

export function meta({ matches }: Route.MetaArgs): Route.MetaDescriptors {
	return [{ title: screenTitle(SCREEN_TITLE, matches) }];
}

export async function loader({ context, url }: Route.LoaderArgs) {
	let listed: CampaignListing[];
	try {
		listed = await readCampaigns(context.get(database));
	} catch (e) {
		console.error('loading the campaigns page failed:', e);
		loadFailed('This page');
	}
	const now = Date.now();
	const rows = listed.map((campaign) => ({
		id: campaign.id,
		name: campaign.name,
		address: campaign.slug === null ? null : `/${campaign.slug}`,
		state: campaign.state,
		goal: campaign.goalMinor === null ? null : formatMinorBrief(campaign.goalMinor, FORM_CURRENCY),
		// a campaign ended before its end date did not end on it.
		ends:
			campaign.end === null || (campaign.state === 'ended' && campaign.end.at > now)
				? null
				: dayWords(campaign.end.day)
	}));
	return {
		campaigns: rows.filter((row) => row.state !== 'ended'),
		ended: rows.filter((row) => row.state === 'ended'),
		asking: url.searchParams.has('new')
	};
}

export async function action({ context, request }: Route.ActionArgs) {
	const submission = parseForm(await request.formData(), CAMPAIGN_CREATE);
	if (!submission.ok) return invalid(400, submission.reject());
	const { title, purpose, time_zone } = submission.value;

	let made: Awaited<ReturnType<typeof createCampaign>>;
	try {
		made = await createCampaign(context.get(database), context.get(platform).env, {
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
		</div>
	</div>
);

export default function Campaigns({ loaderData, actionData }: Route.ComponentProps) {
	const { campaigns, ended, asking } = loaderData;
	const zone = useTimeZone();

	return (
		<Column>
			<List>
				<CreateCard as={Link} to={ASKING} preventScrollReset ghost={SAMPLE}>
					New campaign
				</CreateCard>
				{campaigns.map((row) => (
					<CampaignRecord key={row.id} row={row} />
				))}
			</List>

			{ended.length === 0 ? null : (
				<Disclosure summary={`Ended (${ended.length})`}>
					<List>
						{ended.map((row) => (
							<CampaignRecord key={row.id} row={row} />
						))}
					</List>
				</Disclosure>
			)}

			{asking ? <NewCampaignCard actionData={actionData} zone={zone} /> : null}
		</Column>
	);
}

function CampaignRecord({ row }: { readonly row: Row }) {
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
			{row.address === null ? null : (
				<div className="adm-record__row">
					{/* biome-ignore lint/a11y/noRedundantRoles: no marker and a flex row, as `RecordCard` states it. */}
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
				</div>
			)}
		</article>
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
		navigation.formMethod === 'POST' &&
		navigation.formAction?.split('?')[0] === SCREEN;
	// the zone is a hidden box, so a refusal of it is said with the form's own.
	const refusal = form.errors?.[0] ?? fields.time_zone.errors?.[0];

	return (
		<Form method="post" preventScrollReset {...getFormProps(form)}>
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
