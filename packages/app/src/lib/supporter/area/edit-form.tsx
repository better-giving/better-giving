import { getFormProps } from '@conform-to/react';
import { useCallback, useEffect, useState } from 'react';
import { Form } from 'react-router';
import { useAdminForm } from '$lib/admin/use-admin-form';
import { FORM_CURRENCY, groupedEntry } from '$lib/forms/amounts';
import { defineForm } from '$lib/forms/definition';
import { SUPPORTER_STORY_MAX, SUPPORTER_TITLE_MAX } from '$lib/supporters/input';
import { PHOTO_NOT_STORED } from './copy';
import { StoryField, TextField } from './field';
import { EDIT_FORM, INTENT, INTENTS } from './forms';
import { Mark } from './glyph';
import { PhotoField } from './photo-field';
import { type SupporterAccount, SupporterShell, type SupporterOrg } from './shell';
import { answered, boxOf, type FormResult } from './supporter-form';

// /fundraise/pages/:id/edit: the supporter's name, which signs every page of theirs, and this page's
// title, goal, story and photo. the address never changes once a page is out, so it is no box here.
// Save changes posts `intent=save` and the screen stays: Saved stands beside the press for
// `SAVED_FOR_MS` and focus stays on the press. Cancel goes back without saving.

/** Save changes, as the route's action parses it. */
const EDIT = defineForm({ id: EDIT_FORM.id, schema: EDIT_FORM.schema });

/** how long Saved stands beside the press. */
export const SAVED_FOR_MS = 4000;

/** the page as the form is seeded from it (`readOwnFundraiser`). */
export type EditedPage = {
	readonly name: string;
	readonly title: string;
	readonly goalMinor: number;
	readonly story: string;
	readonly photoId: string | null;
};

export type EditFundraiserProps = {
	readonly org: SupporterOrg;
	readonly account: SupporterAccount;
	readonly page: EditedPage;
	/** the back link's words and where it and Cancel go: the page's manage screen. */
	readonly backTitle: string;
	readonly backHref: string;
	readonly uploadUrl: string;
	readonly lastResult?: FormResult;
	/** the photo posted is one no stored image carries (`OwnEdit`'s `photo_missing`). */
	readonly photoMissing: boolean;
	/**
	 * when the last save landed (ms since the epoch, the route's clock), or null. each new value
	 * puts Saved up beside the press.
	 */
	readonly savedAt: number | null;
	readonly sending: boolean;
};

export function EditFundraiser({
	org,
	account,
	page,
	backTitle,
	backHref,
	uploadUrl,
	lastResult,
	photoMissing,
	savedAt,
	sending
}: EditFundraiserProps) {
	const [form, fields] = useAdminForm(EDIT, answered(EDIT, lastResult), {
		defaultValue: {
			name: page.name,
			title: page.title,
			goal: groupedEntry(page.goalMinor, FORM_CURRENCY),
			story: page.story,
			photo_id: page.photoId ?? ''
		}
	});
	const [photoWorking, setPhotoWorking] = useState(false);
	const onPhotoWorking = useCallback((working: boolean) => setPhotoWorking(working), []);
	const saved = useSaved(savedAt);
	const formProps = getFormProps(form);
	return (
		<SupporterShell org={org} account={account}>
			<a className="sa-back" href={backHref}>
				<Mark name="back" />
				{backTitle}
			</a>
			<h1 className="sa-h1">Edit your page</h1>
			<Form
				method="post"
				{...formProps}
				onSubmit={(event) => {
					if (sending || photoWorking) {
						event.preventDefault();
						return;
					}
					formProps.onSubmit(event);
				}}
				aria-label="Edit your page"
				className="sa-plane sa-form sa-narrow"
			>
				<input type="hidden" name={INTENT} value={INTENTS.save} />
				<TextField
					box={boxOf(fields.name)}
					label="Your name"
					hint="Shown on your page."
					autoComplete="name"
				/>
				<TextField
					box={boxOf(fields.title)}
					label="Page title"
					hint={`Shown at the top of your page. Up to ${SUPPORTER_TITLE_MAX} characters.`}
					maxLength={SUPPORTER_TITLE_MAX}
				/>
				<TextField
					box={boxOf(fields.goal)}
					label="Goal"
					hint="Raising it later is fine. Your page shows the new goal right away."
					prefix="$"
					inputMode="decimal"
				/>
				<StoryField box={boxOf(fields.story)} label="Your story" max={SUPPORTER_STORY_MAX} />
				<PhotoField
					id={fields.photo_id.id}
					name={fields.photo_id.name}
					photoId={page.photoId}
					uploadUrl={uploadUrl}
					error={photoMissing ? PHOTO_NOT_STORED : undefined}
					onWorking={onPhotoWorking}
				/>
				<div className="sa-row">
					<button
						type="submit"
						className="ds-btn ds-btn-primary ds-btn-lg ds-btn-sentence"
						aria-busy={sending || undefined}
					>
						Save changes
					</button>
					<a className="ds-btn ds-btn-ghost ds-btn-lg" href={backHref}>
						Cancel
					</a>
					<span className="sa-saved" role="status">
						{saved ? (
							<>
								<Mark name="tick" />
								Saved
							</>
						) : null}
					</span>
				</div>
			</Form>
		</SupporterShell>
	);
}

/** true for `SAVED_FOR_MS` after each new `savedAt`. */
function useSaved(savedAt: number | null): boolean {
	const [shownFor, setShownFor] = useState<number | null>(null);
	useEffect(() => {
		if (savedAt === null) return;
		setShownFor(savedAt);
		const gone = setTimeout(() => setShownFor(null), SAVED_FOR_MS);
		return () => clearTimeout(gone);
	}, [savedAt]);
	return shownFor !== null && shownFor === savedAt;
}
