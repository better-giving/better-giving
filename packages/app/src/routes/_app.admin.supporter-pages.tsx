import { useCallback, useLayoutEffect, useMemo, useState } from 'react';
import { href, useFetcher, useSubmit } from 'react-router';
import { z } from 'zod';
import type { CrumbHandle } from '$lib/admin/crumbs';
import { APP_NAME, screenTitle } from '$lib/admin/screen-title';
import {
	INTENT_FIELD,
	PAGE_ID_FIELD,
	type RowOutcome,
	type RowPress,
	SUPPORTER_PAGES_INTENTS,
	SupporterPages
} from '$lib/admin/supporter-pages/supporter-pages';
import { type AdminActionData, resultFor } from '$lib/admin/use-admin-form';
import { defineForm } from '$lib/forms/definition';
import { SUPPORTER_HIDE_INPUT, SUPPORTER_SETTING_INPUT } from '$lib/supporters/input';
import { STAFF_USER_ID } from '$lib/server/auth';
import { invalid, type ParsedForm, parseForm, unread } from '$lib/server/conform';
import { loadFailed } from '$lib/server/db/load-failure';
import {
	readOrgProfile,
	setSupporterFundraisersEnabled,
	supporterFundraisersEnabled
} from '$lib/server/org/queries';
import { hideFundraiser, listAllFundraisers, showFundraiser } from '$lib/server/supporters/admin';
import { database, staff } from '../context';
import type { Route } from './+types/_app.admin.supporter-pages';

// Supporter pages: the setting that lets supporters start fundraisers, and every supporter's page
// with Open and Hide or Show again. staff and members may both hide and show — moderation of what
// the public sees, as Public messages is (./_app.admin.donations.messages.tsx) — and the setting is
// the deployer's alone (AGENTS.md → Boundaries): a member is drawn it unchangeable, and a member's
// save is refused here.
//
// what is listed and what a press writes are $lib/server/supporters/admin.ts's and
// $lib/server/org/queries.ts's. each press answers on this screen without navigating, through a
// fetcher of its own, one per row so a press on one row cancels no other's. Open goes to the public
// address, or to the staff preview (./admin.supporter-pages.$id.preview.tsx) for a page the public
// cannot see: hidden, or still waiting on its confirm link.

const SCREEN_TITLE = 'Supporter pages';

export const handle = {
	crumbs: ({ pathname }) => [{ href: pathname, label: SCREEN_TITLE }]
} satisfies CrumbHandle;

export function meta({ matches }: Route.MetaArgs): Route.MetaDescriptors {
	return [{ title: screenTitle(SCREEN_TITLE, matches) }];
}

export async function loader({ context }: Route.LoaderArgs) {
	const db = context.get(database);
	const mayChange = context.get(staff).id === STAFF_USER_ID;
	try {
		const [profile, enabled, pages] = await Promise.all([
			readOrgProfile(db),
			supporterFundraisersEnabled(db),
			listAllFundraisers(db)
		]);
		return {
			orgName: profile?.legalName ?? APP_NAME,
			setting: { enabled, mayChange },
			pages: pages.map((page) => {
				const address = href('/f/:slug', { slug: page.slug });
				const unseen = page.hidden || page.status === 'pending';
				return {
					id: page.id,
					supporterName: page.supporterName,
					supporterEmail: page.supporterEmail,
					title: page.title,
					address,
					openHref: unseen ? href('/admin/supporter-pages/:id/preview', { id: page.id }) : address,
					goalMinor: page.goalMinor,
					raisedMinor: page.raisedMinor,
					currency: page.currency,
					status: page.status,
					hidden: page.hidden
				};
			})
		};
	} catch (e) {
		console.error('listing supporter pages failed:', e);
		loadFailed('The supporter pages list');
	}
}

const SETTING = defineForm({ id: 'supporter-setting', schema: SUPPORTER_SETTING_INPUT });
const HIDE = defineForm({
	id: 'supporter-page-hide',
	schema: SUPPORTER_HIDE_INPUT.extend({ [PAGE_ID_FIELD]: z.string() })
});
const SHOW = defineForm({
	id: 'supporter-page-show',
	schema: z.object({ [PAGE_ID_FIELD]: z.string() })
});

const NOT_YOURS = 'Only whoever runs this server can change this.';
const NO_SUCH_PRESS = `\`${INTENT_FIELD}\` names no press on this screen. it is one of: ${Object.values(SUPPORTER_PAGES_INTENTS).join(', ')}.`;
const NO_PROFILE = 'Save the organisation details first, then switch fundraisers off.';
const SETTING_FAILED = 'Couldn’t save the setting. Try again.';
const NOT_LISTED = 'That page is no longer on this list. Reload to see the pages as they are now.';
const PRESS_FAILED = {
	hide: 'Couldn’t hide this page. Try again.',
	show: 'Couldn’t show this page again. Try again.'
} as const;

export async function action({ context, request }: Route.ActionArgs) {
	const db = context.get(database);
	const body = await request.formData();
	const intent = body.get(INTENT_FIELD);
	switch (intent) {
		case SUPPORTER_PAGES_INTENTS.saveSetting: {
			const submission = parseForm(body, SETTING);
			if (!submission.ok) return invalid(400, submission.reject());
			if (context.get(staff).id !== STAFF_USER_ID) {
				return invalid(404, submission.reject({ formErrors: [NOT_YOURS] }));
			}
			try {
				const saved = await setSupporterFundraisersEnabled(db, submission.value.enabled);
				if (saved === 'no-profile') {
					return invalid(409, submission.reject({ formErrors: [NO_PROFILE] }));
				}
			} catch (e) {
				console.error('saving the supporter fundraisers setting failed:', e);
				return invalid(500, submission.reject({ formErrors: [SETTING_FAILED] }));
			}
			return { saved: 'setting' as const };
		}
		case SUPPORTER_PAGES_INTENTS.hide:
			return rowPress('hide', parseForm(body, HIDE), (pageId, value) =>
				hideFundraiser(db, pageId, value.note ?? null, new Date())
			);
		case SUPPORTER_PAGES_INTENTS.show:
			return rowPress('show', parseForm(body, SHOW), (pageId) => showFundraiser(db, pageId));
		default:
			return invalid(400, unread(SETTING, NO_SUCH_PRESS));
	}

	async function rowPress<V extends { readonly [PAGE_ID_FIELD]: string }>(
		pressed: 'hide' | 'show',
		submission: ParsedForm<V>,
		write: (pageId: string, value: V) => Promise<string>
	) {
		if (!submission.ok) return invalid(400, submission.reject());
		const pageId = submission.value[PAGE_ID_FIELD];
		try {
			if ((await write(pageId, submission.value)) === 'not_found') {
				return invalid(404, submission.reject({ formErrors: [NOT_LISTED] }), { pageId });
			}
		} catch (e) {
			console.error(`${pressed} on supporter page ${pageId} failed:`, e);
			return invalid(500, submission.reject({ formErrors: [PRESS_FAILED[pressed]] }), { pageId });
		}
		return { landed: pressed === 'hide' ? ('hidden' as const) : ('shown' as const), pageId };
	}
}

/** the action's answer to a row's press, as the row takes it; null for one naming no page. */
function rowOutcome(answer: AdminActionData): RowOutcome | null {
	if (typeof answer?.pageId !== 'string') return null;
	const landed = answer.landed;
	if (landed === 'hidden' || landed === 'shown') return { landed };
	const refused = (resultFor(HIDE, answer) ?? resultFor(SHOW, answer))?.error?.['']?.at(-1);
	return refused === undefined ? null : { refused };
}

/** the fetcher a row's presses go through, one per page. */
const pressKey = (pageId: string) => `supporter-page-press-${pageId}`;

export default function SupporterPagesScreen({ loaderData }: Route.ComponentProps) {
	const submit = useSubmit();
	const setting = useFetcher<AdminActionData>({ key: 'supporter-setting' });
	const [pressed, setPressed] = useState<readonly string[]>([]);
	const [presses, setPresses] = useState<Readonly<Record<string, RowPress>>>({});
	const record = useCallback((pageId: string, state: RowPress) => {
		setPresses((all) => {
			const was = all[pageId];
			if (was?.pending === state.pending && was.outcome === state.outcome) return all;
			return { ...all, [pageId]: state };
		});
	}, []);
	const press = (pageId: string, body: FormData) => {
		setPressed((ids) => (ids.includes(pageId) ? ids : [...ids, pageId]));
		submit(body, { method: 'post', navigate: false, fetcherKey: pressKey(pageId) });
	};
	const settingRefused = resultFor(SETTING, setting.data)?.error?.['']?.at(-1) ?? null;
	return (
		<>
			{pressed.map((pageId) => (
				<RowFetcher key={pageId} pageId={pageId} onState={record} />
			))}
			<SupporterPages
				orgName={loaderData.orgName}
				setting={{
					...loaderData.setting,
					pending: setting.state !== 'idle',
					saved: setting.state === 'idle' && setting.data?.saved === 'setting',
					refused: setting.state === 'idle' ? settingRefused : null
				}}
				pages={loaderData.pages}
				presses={presses}
				onSaveSetting={(body) => setting.submit(body, { method: 'post' })}
				onHide={press}
				onShow={press}
			/>
		</>
	);
}

/**
 * one pressed row's fetcher, which draws nothing and hands the screen where that row's press
 * stands, in a layout effect so the screen redraws with it before the browser paints. as
 * `RowPress` in ./_app.admin.donations.messages.tsx.
 */
function RowFetcher({
	pageId,
	onState
}: {
	readonly pageId: string;
	readonly onState: (pageId: string, state: RowPress) => void;
}) {
	const fetcher = useFetcher<AdminActionData>({ key: pressKey(pageId) });
	// memoized on the answer itself: the screen tells one outcome from the next by identity.
	const outcome = useMemo(() => rowOutcome(fetcher.data), [fetcher.data]);
	const pending = fetcher.state !== 'idle';
	useLayoutEffect(() => onState(pageId, { pending, outcome }), [pageId, onState, pending, outcome]);
	return null;
}
