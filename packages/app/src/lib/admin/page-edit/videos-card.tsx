import { Button } from '@better-giving/operator/components/controls/Button';
import { Field } from '@better-giving/operator/components/forms/Field';
import { Section } from '@better-giving/operator/components/shell/Layout';
import { Mark } from '@better-giving/operator/components/status/Mark';
import { StatusWord } from '@better-giving/operator/components/status/StatusWord';
import { getFormProps } from '@conform-to/react';
import { type MouseEvent, useEffect, useId, useRef, useState } from 'react';
import { Form, useFormAction, useNavigation, useSubmit } from 'react-router';
import { type AdminActionData, useAdminForm, whichForm } from '../use-admin-form';
import { clock } from '$lib/donate/sections/videos';
import { defineForm, WHICH_FORM } from '$lib/forms/definition';
import {
	type ShownVideo,
	VIDEO_ADD_INPUT,
	VIDEO_BOXES,
	VIDEO_FORMS,
	VIDEO_REFUSALS,
	type VideoCardSeed,
	type VideoDirection,
	type VideoSaved,
	youTubeWatchUrl
} from '$lib/page/videos';
import { formRefusal, useScreenAnswer } from './section-card';

// Videos, on the Donation page's edit screen between General and Donation settings: the YouTube
// videos the page shows, in order. unlike the section cards (./section-card.tsx) it has no Save:
// Add video, Move up, Move down and Remove each post to the screen's one action at once
// ($lib/server/pages/videos.ts) and write the draft, which donors see at Publish changes.
//
// Add video is a conform form, so a link that is no YouTube video is refused before it is sent;
// the server's refusals come back under the same box. while it is out the box is read-only and the
// press busy; a refused link stays in the box, and one that landed empties it.
//
// a move or a remove is a press the card submits itself. every press is held while any write from
// the screen is in flight, since each one acts on the draft as the last one left it. focus is put
// back once the answer has landed and the list redrawn: on the move press just used, or the row's
// other move press where that one has just reached an end; after a remove, on the next row's
// Remove, or the link box where no row follows. what landed is said in the status line under the
// box. an add that fills the page closes the box, so focus standing in it goes to the added row's
// Remove rather than to the document.
//
// a refused move or remove is said in a line above the list that is there before it speaks, and
// only the refused row's presses name it as their description.

const ADD = defineForm({ id: VIDEO_FORMS.add, schema: VIDEO_ADD_INPUT });

const LINK_HINT = 'Paste the address of a public or unlisted video.';

/** what the card needs to say and do once the answer to a press lands. */
type Press =
	| { readonly form: typeof VIDEO_FORMS.add }
	| {
			readonly form: typeof VIDEO_FORMS.move;
			readonly videoId: string;
			readonly title: string;
			readonly direction: VideoDirection;
	  }
	| {
			readonly form: typeof VIDEO_FORMS.remove;
			readonly videoId: string;
			readonly title: string;
			/** the row's place, which the row after it takes. */
			readonly at: number;
	  };

const saved = (answer: AdminActionData): VideoSaved | null =>
	answer !== null && answer !== undefined && typeof answer.saved === 'string'
		? (answer as VideoSaved)
		: null;

/** the press the screen's write in flight is, by its form and video; null with none. */
function useVideoWrite() {
	const navigation = useNavigation();
	const here = useFormAction();
	const writing = navigation.state !== 'idle' && navigation.formAction === here;
	const body = writing ? navigation.formData : undefined;
	const value = (name: string) => {
		const got = body?.get(name);
		return typeof got === 'string' ? got : null;
	};
	return {
		writing,
		form: value(WHICH_FORM),
		videoId: value(VIDEO_BOXES.videoId),
		direction: value(VIDEO_BOXES.direction)
	};
}

export function DonationPageVideosCard({ seed }: { readonly seed: VideoCardSeed }) {
	const id = useId();
	const answer = useScreenAnswer();
	const [form, fields] = useAdminForm(ADD, answer, { defaultValue: { video_link: '' } });
	const write = useVideoWrite();
	const submit = useSubmit();
	const presses = useRef(new Map<string, HTMLButtonElement>());
	const pressed = useRef<Press | null>(null);
	const answered = useRef(answer);
	const [said, setSaid] = useState('');
	// the row whose move or remove the answer standing refused; null with none.
	const [refusedRow, setRefusedRow] = useState<string | null>(null);

	const { videos, count, cap } = seed;
	const full = count >= cap;
	const adding = write.form === VIDEO_FORMS.add;

	// keyed on a new answer, never on a render: it lands with the list it changed, so the rows here
	// are already the new ones.
	useEffect(() => {
		if (answered.current === answer) return;
		answered.current = answer;
		const press = pressed.current;
		if (press === null || answer === null || answer === undefined) return;
		pressed.current = null;
		const landed = saved(answer);
		if (press.form === VIDEO_FORMS.add) {
			if (landed?.saved === VIDEO_FORMS.add) {
				const added = videos.find((video) => video.videoId === landed.videoId);
				form.reset();
				setSaid(added === undefined ? '' : `Added “${added.title}”.`);
				const active = document.activeElement;
				const box = document.getElementById(fields.video_link.id);
				if (full && (active === box || active === document.body || active === null)) {
					presses.current.get(`${landed.videoId}:remove`)?.focus();
				}
			} else {
				document.getElementById(fields.video_link.id)?.focus();
			}
			return;
		}
		if (landed === null) {
			setRefusedRow(press.videoId);
			return;
		}
		if (press.form === VIDEO_FORMS.move) {
			if (landed.saved !== VIDEO_FORMS.move) return;
			const atEnd =
				(press.direction === 'up' && landed.position === 1) ||
				(press.direction === 'down' && landed.position === landed.count);
			const other: VideoDirection = press.direction === 'up' ? 'down' : 'up';
			presses.current.get(`${press.videoId}:${atEnd ? other : press.direction}`)?.focus();
			setSaid(
				`Moved “${press.title}” ${press.direction}, now ${landed.position} of ${landed.count}.`
			);
			return;
		}
		if (landed.saved !== VIDEO_FORMS.remove) return;
		const next = videos[press.at];
		if (next === undefined) document.getElementById(fields.video_link.id)?.focus();
		else presses.current.get(`${next.videoId}:remove`)?.focus();
		setSaid(`Removed “${press.title}”.`);
	}, [answer, videos, full, form, fields.video_link.id]);

	const linkError =
		fields.video_link.errors?.[0] ?? formRefusal({ id: VIDEO_FORMS.add }, answer) ?? undefined;
	const pressRefusal =
		formRefusal({ id: VIDEO_FORMS.move }, answer) ??
		formRefusal({ id: VIDEO_FORMS.remove }, answer);

	const press = (event: MouseEvent<HTMLButtonElement>, next: Press, body: FormData) => {
		if (write.writing) {
			event.preventDefault();
			return;
		}
		pressed.current = next;
		setSaid('');
		setRefusedRow(null);
		body.set(WHICH_FORM, next.form);
		submit(body, { method: 'post', preventScrollReset: true });
	};

	const holdAdd = full || (write.writing && !adding);
	return (
		<Section card>
			<h2>Videos</h2>
			<p className="adm-hint">
				YouTube videos shown on your donation page, in this order. Donors see a picture first, and
				the video loads only when they press play.
			</p>
			<Form
				method="post"
				preventScrollReset
				className="adm-videoadd"
				{...getFormProps(form)}
				onSubmit={(event) => {
					if (holdAdd || adding) {
						event.preventDefault();
						return;
					}
					form.onSubmit(event);
					if (event.defaultPrevented) return;
					pressed.current = { form: VIDEO_FORMS.add };
					setSaid('');
				}}
			>
				<input {...whichForm(form.id)} />
				<Field
					id={fields.video_link.id}
					name={fields.video_link.name}
					label="YouTube link"
					hint={
						full
							? `${count} of ${cap} added. ${VIDEO_REFUSALS.atCap}`
							: `${LINK_HINT} ${count} of ${cap} added.`
					}
					type="url"
					inputMode="url"
					placeholder="https://www.youtube.com/watch?v="
					defaultValue=""
					readOnly={adding}
					disabled={full}
					error={full ? undefined : linkError}
					beside={
						<Button
							type="submit"
							mark={adding ? undefined : 'plus'}
							aria-busy={adding || undefined}
							aria-disabled={holdAdd || adding || undefined}
						>
							{adding ? (
								<>
									<Mark name="grip-vertical" className="adm-dots" />
									Adding video
								</>
							) : (
								'Add video'
							)}
						</Button>
					}
				/>
			</Form>
			<p className={said === '' ? 'adm-vh' : 'adm-momentary'} role="status">
				{said === '' ? null : (
					<>
						<Mark name="check" />
						{said}
					</>
				)}
			</p>
			<p className={pressRefusal === null ? 'adm-vh' : undefined} id={`${id}-refused`} role="alert">
				{pressRefusal === null ? null : (
					<StatusWord register="momentary" blocked mark="circle-alert">
						{pressRefusal}
					</StatusWord>
				)}
			</p>
			{videos.length === 0 ? (
				<p>
					No videos yet. Add a YouTube link and donors will see it between About us and Messages
					from donors.
				</p>
			) : (
				<ol className="adm-videos" aria-label="Videos on your donation page">
					{videos.map((video, at) => (
						<VideoRow
							key={video.videoId}
							video={video}
							first={at === 0}
							last={at === videos.length - 1}
							held={write.writing}
							busy={write.videoId === video.videoId ? write.form : null}
							describedBy={
								pressRefusal !== null && refusedRow === video.videoId ? `${id}-refused` : undefined
							}
							press={(dir) => (node) => {
								const key = `${video.videoId}:${dir}`;
								if (node === null) presses.current.delete(key);
								else presses.current.set(key, node);
							}}
							onMove={(event, direction) => {
								const body = new FormData();
								body.set(VIDEO_BOXES.videoId, video.videoId);
								body.set(VIDEO_BOXES.direction, direction);
								press(
									event,
									{ form: VIDEO_FORMS.move, videoId: video.videoId, title: video.title, direction },
									body
								);
							}}
							onRemove={(event) => {
								const body = new FormData();
								body.set(VIDEO_BOXES.videoId, video.videoId);
								press(
									event,
									{ form: VIDEO_FORMS.remove, videoId: video.videoId, title: video.title, at },
									body
								);
							}}
						/>
					))}
				</ol>
			)}
		</Section>
	);
}

type RowProps = {
	readonly video: ShownVideo;
	readonly first: boolean;
	readonly last: boolean;
	/** a write from the screen is in flight, so no press here may start another. */
	readonly held: boolean;
	/** the form of the write in flight for this row's video; null with none. */
	readonly busy: string | null;
	readonly describedBy: string | undefined;
	readonly press: (kind: VideoDirection | 'remove') => (node: HTMLButtonElement | null) => void;
	readonly onMove: (event: MouseEvent<HTMLButtonElement>, direction: VideoDirection) => void;
	readonly onRemove: (event: MouseEvent<HTMLButtonElement>) => void;
};

function VideoRow({
	video,
	first,
	last,
	held,
	busy,
	describedBy,
	press,
	onMove,
	onRemove
}: RowProps) {
	const { title, durationSeconds } = video;
	// an end's move press is closed but stays, so focus can stand on it and the row keeps its shape.
	const move = (direction: VideoDirection, closed: boolean) => (
		<Button
			ref={press(direction)}
			type="button"
			variant="quiet"
			mark={direction === 'up' ? 'chevron-up' : 'chevron-down'}
			aria-label={`Move “${title}” ${direction}`}
			aria-disabled={closed || held || undefined}
			aria-busy={busy === VIDEO_FORMS.move || undefined}
			aria-describedby={describedBy}
			onClick={(event) => {
				if (closed) return;
				onMove(event, direction);
			}}
		/>
	);
	return (
		<li className="adm-video">
			<img className="adm-video__poster" src={video.posterUrl} alt="" loading="lazy" />
			<div className="adm-video__words">
				<p className="adm-video__title">{title}</p>
				<p className="adm-video__meta">
					{durationSeconds === null ? null : <span>{clock(durationSeconds)}</span>}
					<a href={youTubeWatchUrl(video.videoId)} target="_blank" rel="noopener">
						<Mark name="external-link" />
						Watch on YouTube<span className="adm-vh">: “{title}” (opens in a new tab)</span>
					</a>
				</p>
			</div>
			<div className="adm-video__actions">
				{move('up', first)}
				{move('down', last)}
				<Button
					ref={press('remove')}
					type="button"
					variant="quiet"
					mark="trash-2"
					aria-label={`Remove “${title}”`}
					aria-disabled={held || undefined}
					aria-busy={busy === VIDEO_FORMS.remove || undefined}
					aria-describedby={describedBy}
					onClick={onRemove}
				>
					Remove
				</Button>
			</div>
		</li>
	);
}
