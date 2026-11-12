import { getFormProps } from '@conform-to/react';
import { type ReactNode, useCallback, useState } from 'react';
import { Form } from 'react-router';
import { useAdminForm } from '$lib/admin/use-admin-form';
import { defineForm } from '$lib/forms/definition';
import { SUPPORTER_STORY_MAX, SUPPORTER_TITLE_MAX } from '$lib/supporters/input';
import { StateCard } from './cards';
import { PHOTO_NOT_STORED, START_REFUSED, type StartRefusal } from './copy';
import { StoryField, TextField } from './field';
import { INTENT, INTENTS, PHOTO_FILE_FIELD, START_FORM } from './forms';
import { PhotoField } from './photo-field';
import { SupporterShell, type SupporterOrg } from './shell';
import { answered, boxOf, type FormResult } from './supporter-form';
import { usePressOnce } from './use-press-once';

// /fundraise: what a fundraiser is and what of it is public beside the form that starts one, or,
// where the organisation has switched fundraisers off, the one card saying so with the way to give
// directly. a start posts `intent=start` to the route standing here, which answers a refused box
// through `lastResult` and a refusal of the whole post through `refused`. a starter has no session
// to upload with, so the cropped photo is a `PHOTO_FILE_FIELD` file part of the start itself.

/** Create my page, as the route's action parses it. */
const START = defineForm({ id: START_FORM.id, schema: START_FORM.schema });

export type StartFundraiserProps = {
	readonly org: SupporterOrg;
	/** whether the organisation takes new fundraisers (`supporterFundraisersEnabled`). */
	readonly open: boolean;
	/** where the off card's one way on goes: the organisation's donation page. */
	readonly donateHref: string;
	/** "Get a sign-in link". */
	readonly signInHref: string;
	/** the form's own result from a refused post. */
	readonly lastResult?: FormResult;
	/** why the last post was refused as a whole (`StartResult` in $lib/server/supporters/start.ts). */
	readonly refused?: StartRefusal | null | undefined;
	/** while the post is in flight. */
	readonly sending: boolean;
	/** the spam check the route mounts (Turnstile or ALTCHA), drawn just above the press. */
	readonly challenge?: ReactNode;
};

export function StartFundraiser(props: StartFundraiserProps) {
	const { org, open, donateHref } = props;
	return (
		<SupporterShell org={org}>
			{open ? (
				<StartLayout {...props} />
			) : (
				<div className="sa-narrow">
					<StateCard
						heading="h1"
						title="Fundraisers aren’t open right now"
						action={
							<a className="ds-btn ds-btn-primary" href={donateHref}>
								Donate to {org.name}
							</a>
						}
					>
						{org.name} isn’t taking new fundraiser pages at the moment. You can still give to{' '}
						{org.name} directly.
					</StateCard>
				</div>
			)}
		</SupporterShell>
	);
}

function StartLayout({
	org,
	signInHref,
	lastResult,
	refused,
	sending,
	challenge
}: StartFundraiserProps) {
	const [form, fields] = useAdminForm(START, answered(START, lastResult));
	const [photoWorking, setPhotoWorking] = useState(false);
	const onPhotoWorking = useCallback((working: boolean) => setPhotoWorking(working), []);
	// a second post would re-spend the single-use spam answer, and its refusal would be drawn over
	// the first post's way on to Check your email.
	const press = usePressOnce(sending, lastResult ?? refused);
	/* each answer refusing the photo puts the photo box back to empty, under its refusal: the crop
	   it holds is the one refused, and posted again it would be refused again. an answer about
	   anything else leaves the crop where it is. */
	const [photoRefusals, setPhotoRefusals] = useState({ answer: lastResult, count: 0 });
	if (refused === 'photo_missing' && photoRefusals.answer !== lastResult) {
		setPhotoRefusals({ answer: lastResult, count: photoRefusals.count + 1 });
	}
	const refusal =
		refused === undefined || refused === null || refused === 'photo_missing'
			? form.errors?.[0]
			: START_REFUSED[refused];
	const refusalId = `${form.id}-refused`;
	const formProps = getFormProps(form);
	return (
		<div className="sa-start">
			<div className="sa-start-aside">
				<h1 className="sa-h1">Start a fundraiser</h1>
				<p className="sa-lede">
					Tell people why you’re raising money for {org.name}, set a goal and share your page.
				</p>
				<ol className="sa-steps">
					<li>
						<span className="ds-badge ds-badge-primary" aria-hidden="true">
							1
						</span>
						<span>
							<b>Tell your story.</b> A title, a goal, a few paragraphs and a photo if you have one.
						</span>
					</li>
					<li>
						<span className="ds-badge ds-badge-primary" aria-hidden="true">
							2
						</span>
						<span>
							<b>Confirm your email.</b> We send a link. Your page goes live when you open it.
						</span>
					</li>
					<li>
						<span className="ds-badge ds-badge-primary" aria-hidden="true">
							3
						</span>
						<span>
							<b>Share the link.</b> Every gift goes straight to {org.name}.
						</span>
					</li>
				</ol>
				<p className="sa-quiet">
					<b>Public:</b> your name, title, story, photo, goal and the total raised.
					<br />
					<b>Private:</b> your email. {org.name} can see it. Donors can’t.
				</p>
			</div>
			<Form
				method="post"
				encType="multipart/form-data"
				{...formProps}
				onSubmit={(event) => {
					// a second press while the first is out, or a submit before the crop is in, sends nothing.
					if (photoWorking || !press.claim()) {
						event.preventDefault();
						return;
					}
					formProps.onSubmit(event);
					if (event.defaultPrevented) press.release();
				}}
				aria-labelledby={`${form.id}-heading`}
				className="sa-plane sa-form"
			>
				<h2 className="sa-h2" id={`${form.id}-heading`}>
					About you and your page
				</h2>
				<input type="hidden" name={INTENT} value={INTENTS.start} />
				<TextField
					box={boxOf(fields.name)}
					label="Your name"
					hint="Shown on your page."
					autoComplete="name"
					placeholder="Maya Reyes"
				/>
				<TextField
					box={boxOf(fields.email)}
					label="Email"
					hint="We email you a link to publish and manage your page."
					type="email"
					autoComplete="email"
					placeholder="maya@example.org"
				/>
				<TextField
					box={boxOf(fields.title)}
					label="Page title"
					hint={`Shown at the top of your page. Up to ${SUPPORTER_TITLE_MAX} characters.`}
					maxLength={SUPPORTER_TITLE_MAX}
					placeholder="Keep the pantry trucks running this winter"
				/>
				<TextField
					box={boxOf(fields.goal)}
					label="Goal"
					hint="You can change it later."
					prefix="$"
					inputMode="decimal"
					placeholder="5,000"
				/>
				<StoryField
					box={boxOf(fields.story)}
					label="Your story"
					hint="Say who you are and why this matters to you. A few short paragraphs is plenty."
					max={SUPPORTER_STORY_MAX}
				/>
				<PhotoField
					key={photoRefusals.count}
					id={`${form.id}-photo`}
					name={PHOTO_FILE_FIELD}
					photoId={null}
					error={refused === 'photo_missing' ? PHOTO_NOT_STORED : undefined}
					onWorking={onPhotoWorking}
				/>
				{challenge}
				<div className="sa-submit">
					{refusal === undefined ? null : (
						<p className="sa-refused" id={refusalId} role="alert">
							{refusal}
						</p>
					)}
					<button
						type="submit"
						className="ds-btn ds-btn-primary ds-btn-lg ds-btn-sentence"
						aria-busy={sending || undefined}
						aria-describedby={refusal === undefined ? undefined : refusalId}
					>
						{sending ? 'Creating your page…' : 'Create my page'}
					</button>
					<p className="sa-quiet" role="status">
						{sending
							? 'Keep this tab open. It takes a few seconds.'
							: 'We’ll email you a link to confirm. Nothing is public until you open it.'}
					</p>
				</div>
				<p className="sa-quiet">
					Already started one?{' '}
					<a className="sa-link" href={signInHref}>
						Get a sign-in link
					</a>
				</p>
			</Form>
		</div>
	);
}
