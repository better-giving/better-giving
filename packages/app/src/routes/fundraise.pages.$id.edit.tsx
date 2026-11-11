import { href } from 'react-router';
import { defineForm } from '$lib/forms/definition';
import { EditFundraiser } from '$lib/supporter/area/edit-form';
import { EDIT_FORM, INTENTS } from '$lib/supporter/area/forms';
import { supporterAreaLinks } from '$lib/supporter/area/links';
import { usePosting } from '$lib/supporter/area/use-posting';
import { refuseWriteFromAnotherOrigin } from '$lib/server/auth/gate';
import { invalid, parseForm } from '$lib/server/conform';
import { notFound } from '$lib/server/db/load-failure';
import {
	editablePage,
	NOT_YOUR_PAGE,
	readSupporterOrg,
	supporterAccount
} from '$lib/server/supporters/area';
import { editOwnFundraiser } from '$lib/server/supporters/pages';
import { database } from '../context';
import type { Route } from './+types/fundraise.pages.$id.edit';

// Edit your page: the supporter's name and this page's title, goal, story and photo, posted as
// `intent=save` and written by `editOwnFundraiser` ($lib/server/supporters/pages.ts), which answers
// for the supporter's own page alone. the screen stays after a save and says Saved by the press.
// an ended page is done with editing: its manage screen offers no Edit, and this address goes back
// to it.

/** the screen's form as the action parses it: the one `EditFundraiser` mounts. */
const EDIT = defineForm({ id: EDIT_FORM.id, schema: EDIT_FORM.schema });

export async function loader({ context, params, request }: Route.LoaderArgs) {
	const db = context.get(database);
	const { signedIn, page } = await editablePage(db, request, params.id);
	return {
		org: await readSupporterOrg(db),
		account: supporterAccount(signedIn),
		page: {
			name: page.name,
			title: page.title,
			goalMinor: page.goalMinor,
			story: page.story,
			photoId: page.photoId
		},
		backTitle: page.title,
		backHref: href('/fundraise/pages/:id', { id: page.id })
	};
}

/** one supporter's own page, read under their session: no copy is kept. */
export function headers() {
	return { 'cache-control': 'no-store' };
}

export async function action({ context, params, request }: Route.ActionArgs) {
	refuseWriteFromAnotherOrigin(request);
	const db = context.get(database);
	const { signedIn } = await editablePage(db, request, params.id);
	const submission = parseForm(await request.formData(), EDIT);
	if (!submission.ok) return invalid(400, submission.reject());
	const now = new Date();
	const edited = await editOwnFundraiser(
		db,
		signedIn.supporterId,
		params.id,
		submission.value,
		now
	);
	switch (edited) {
		case 'saved':
			return { savedAt: now.getTime() };
		case 'photo_missing':
			return invalid(400, submission.reject(), { photoMissing: true });
		case 'not_found':
			notFound(NOT_YOUR_PAGE);
	}
}

export function meta(): Route.MetaDescriptors {
	return [{ title: 'Edit your page' }];
}

export function links(): Route.LinkDescriptors {
	return supporterAreaLinks();
}

export default function EditRoute({ loaderData, actionData }: Route.ComponentProps) {
	const sending = usePosting(INTENTS.save);
	return (
		<EditFundraiser
			{...loaderData}
			uploadUrl={href('/fundraise/photo')}
			lastResult={actionData !== undefined && 'form' in actionData ? actionData.form.result : null}
			photoMissing={actionData !== undefined && 'photoMissing' in actionData}
			savedAt={actionData !== undefined && 'savedAt' in actionData ? actionData.savedAt : null}
			sending={sending}
		/>
	);
}
