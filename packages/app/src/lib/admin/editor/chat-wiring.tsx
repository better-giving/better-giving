import { type ReactNode, useEffect, useRef, useState } from 'react';
import { useFetcher } from 'react-router';
import { describeResized, type Resized } from '$lib/images/resize';
import { imageSrc } from '$lib/page/image-src';
import { AttachControl, attachRefusal } from '../chat/attach-control';
import {
	AiPanel,
	type ChatAttachment,
	type ChatMessage,
	type ChatSend,
	type ChatUnsent
} from '../chat/ai-panel';
import { liveAsk } from '../chat/chat-log';
import type { CardAnswer } from '../chat/question-card';
import { ChatClosed, ChatOpening } from './editor-shell';
import { postPhoto, type UploadAnswer } from './photo-upload';
import { useWide } from './wide';

// the AI panel as both editors mount it: `panel` for the shell's slot beside the preview, `open`
// for the bar's AI press, and `sheet` for what stands in the sheet's place below the wide breakpoint
// while it is on its way or once it went. the chat is the page's chat route's
// (src/routes/_app.admin.pages.$pageId.chat.ts), asked by fetchers held by the editor rather than
// the panel, so a turn sent and closed on still lands: one loading the chat as the editor opens, at
// either width, because whether it is empty decides the arrival; one posting the opening; one
// posting each turn and each card's answers. from the wide breakpoint the panel is docked and shown
// from the start; below it, from the AI press.
//
// a chat read empty on arrival is asked its opening questions: one `open` post carrying the
// browser's zone, once per editor visit, so a chat a Reset or a Discard empties later is not asked
// again until the editor is opened anew. the panel reads `opening` until the asked turn lands with
// the revalidation that follows the post; an opening the route could not answer ends it and is said
// where a refused send is. below the wide breakpoint the arrival also opens the sheet, and closing
// that sheet hands the focus to the AI press (`ChatClosed`): no press opened it, so it has no opener
// of its own to hand it back to.
//
// a turn is the three boxes that route takes: the words, the photos as a JSON array, and the
// browser's zone, which an end date the operator names is a day in. while it runs the words stand
// in the log as sent and the sheet holds Send. once it lands, the revalidation that follows every
// fetcher post reads the chat again with both new turns, and reads the editor's own loader, whose
// version the preview is keyed on — so the preview redraws on an accepted turn, the one that moves
// the draft, and on no other.
//
// a card's answers are `intent=answers`: the answers as a JSON array, `[]` for its skip press, and
// the zone. nothing stands in the log while they run — the card stays the chat's last turn, held by
// `isRunning`, because one unmounted under its press would take the focus with it. they land the
// way a turn does, and carry no photo, so an attached one stays through them.
//
// a send nothing was stored from comes back as `unsent`: its words, for the box to take back, and
// the operator's line for why, worded here off the answer's `reason` (a 400 or 404 names none and
// is said in its own `error`); answers come back the same way with no words, worded off their own.
// the refusal is held in state, taken from each new answer the fetcher lands, because the fetcher's
// answer outlives the sheet; it is cleared by the next send, so a refusal repeated word for word
// still reads as a new one, and by reopening the sheet.
//
// suggestions are offered only while no card is live and a reply has changed the page: before
// that, the card is what drafts it, and a suggestion beside a card would skip it unanswered.
//
// the panel mounts once the chat has loaded rather than on an empty log: the log takes the chat it
// opens on as already read ($lib/admin/chat/chat-log.tsx), and would speak the whole history as it
// arrived. until then, below the wide breakpoint, `ChatOpening` stands in the sheet's place and
// holds the AI press busy (./editor-shell.tsx).
//
// a photo is attached by the sheet's attach press, which resizes it in the browser and reports
// here; the resized photo is posted at once to the images route (./photo-upload.ts) by its own
// fetcher, whose answer is the stored id the next send carries — the sheet puts a ready photo's id
// in `imageIds` itself. an upload's answer is taken only while its photo is still `uploading`, so
// one landing after Remove or after a new pick is dropped. the photo stays attached through a send
// nothing was stored from, so the resend carries it, and goes once a turn carrying it lands.

const SUGGESTIONS = ['Tell donors what each amount buys', 'Add a FAQ', 'Shorten the story'];

/**
 * whether a reply in `turns` changed the page: one that asks nothing and was accepted, so carries no
 * note but `fell-back`.
 */
const drafted = (turns: readonly ChatMessage[]) =>
	turns.some(
		(turn) =>
			turn.role === 'assistant' &&
			(turn.questions?.length ?? 0) === 0 &&
			(turn.note === undefined || turn.note === 'fell-back')
	);

/** what the chat route's loader answers. */
type History = { readonly turns: readonly ChatMessage[] };

/** what the chat route's action answers: the turn stored, or why nothing was. */
type TurnAnswer =
	| { readonly outcome: string; readonly turns: readonly ChatMessage[] }
	| {
			readonly error: string;
			readonly reason?: 'stale' | 'failed' | 'answered' | 'unanswered' | 'refused';
	  };

type Refused = Extract<TurnAnswer, { error: string }>;

/** the attached photo as this module holds it: the sheet's attachment, less the Remove press. */
type Photo = ChatAttachment extends infer A
	? A extends unknown
		? Omit<A, 'onRemove'>
		: never
	: never;

/** the attachment row once the images route has answered for a photo `bytes` long. */
function uploadLanded(photo: Photo, answer: UploadAnswer, bytes: number): Photo {
	const { name, previewSrc } = photo;
	if ('error' in answer) {
		const reason =
			answer.reason === 'failed' ? 'That didn’t go through. Attach it again.' : answer.error;
		return { name, previewSrc, state: 'refused', reason };
	}
	const detail = describeResized({ width: answer.width, height: answer.height, bytes });
	return { name, previewSrc, state: 'ready', imageId: answer.id, detail };
}

/** the operator's words for a send nothing was stored from. */
function unsentReason(answer: Refused): string {
	switch (answer.reason) {
		case 'stale':
			return 'The page was saved while this was being written, so nothing changed. Send it again.';
		case 'failed':
			return 'That didn’t go through. Send it again.';
		default:
			return answer.error;
	}
}

/** the operator's words for answers nothing was stored from. */
function unansweredReason(answer: Refused): string {
	switch (answer.reason) {
		case 'answered':
			return 'These questions were answered already. Reload the editor to see the chat.';
		case 'stale':
			return 'The page was saved while this was being written, so nothing changed. Send your answers again.';
		case 'failed':
			return 'That didn’t go through. Send your answers again.';
		default:
			return answer.error;
	}
}

/**
 * the chat with the message being answered after it, until the chat that stores it lands. answers
 * on their way add nothing: the card stays the last turn, held, rather than unmounting with the
 * focus in it.
 */
function inFlight(
	turns: readonly ChatMessage[],
	sent: FormData | undefined
): readonly ChatMessage[] {
	if (sent === undefined || sent.get('intent') === 'answers') return turns;
	return [
		...turns,
		{
			id: 'sending',
			role: 'operator',
			text: String(sent.get('message')),
			imageIds: JSON.parse(String(sent.get('imageIds'))) as string[]
		}
	];
}

/** the browser's IANA zone, which an end date the operator names is a day in. */
const zone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

export function useEditorChat(url: string): {
	open: () => void;
	panel: ReactNode;
	sheet: ReactNode;
} {
	const wide = useWide();
	const [open, setOpen] = useState(false);
	/** the sheet up, or last up, is one the arrival opened, rather than one an AI press did. */
	const [openedOnArrival, setOpenedOnArrival] = useState(false);
	const history = useFetcher<History>();
	const turn = useFetcher<TurnAnswer>();
	const opener = useFetcher<TurnAnswer>();
	/** the chat read empty on arrival, so this visit asks its opening questions. */
	const [asksOpening, setAsksOpening] = useState(false);
	const [arrived, setArrived] = useState(false);
	if (!arrived && history.data !== undefined) {
		setArrived(true);
		if (history.data.turns.length === 0) {
			setAsksOpening(true);
			if (!wide) {
				setOpen(true);
				setOpenedOnArrival(true);
			}
		}
	}
	/** the last post: a send's words, for the box to take back if nothing is stored from it. */
	const [sent, setSent] = useState<{ answers: boolean; text: string }>({
		answers: false,
		text: ''
	});
	const [unsent, setUnsent] = useState<ChatUnsent | undefined>(undefined);
	const [answered, setAnswered] = useState(turn.data);
	const upload = useFetcher<UploadAnswer>();
	const [photo, setPhoto] = useState<Photo | undefined>(undefined);
	/** the size of the photo being posted, for its row's detail once it is stored. */
	const [postedBytes, setPostedBytes] = useState(0);
	const [uploadAnswered, setUploadAnswered] = useState(upload.data);
	if (turn.data !== answered) {
		setAnswered(turn.data);
		if (turn.data !== undefined && 'error' in turn.data) {
			const reason = sent.answers ? unansweredReason(turn.data) : unsentReason(turn.data);
			setUnsent({ text: sent.text, reason });
		} else if (turn.data !== undefined && !sent.answers) {
			setPhoto(undefined);
		}
	}
	const [opened, setOpened] = useState(opener.data);
	if (opener.data !== opened) {
		setOpened(opener.data);
		if (opener.data !== undefined && 'error' in opener.data) {
			const reason =
				opener.data.reason === 'failed'
					? 'The questions didn’t load. Reload the editor to be asked them.'
					: opener.data.error;
			setUnsent({ text: '', reason });
		}
	}
	if (upload.data !== uploadAnswered) {
		setUploadAnswered(upload.data);
		if (upload.data !== undefined && photo?.state === 'uploading') {
			setPhoto(uploadLanded(photo, upload.data, postedBytes));
		}
	}

	const previewSrc = photo?.previewSrc;
	useEffect(() => {
		if (previewSrc === undefined) return;
		return () => URL.revokeObjectURL(previewSrc);
	}, [previewSrc]);

	/**
	 * the pick being resized, by name. a ref because its result reaches the handler of the render it
	 * was picked on, which saw no photo yet.
	 */
	const resizing = useRef<string | null>(null);

	const picked = (file: File) => {
		resizing.current = file.name;
		setPhoto({ name: file.name, state: 'resizing' });
	};

	const remove = () => {
		resizing.current = null;
		setPhoto(undefined);
	};

	const resized = (result: Resized) => {
		const name = resizing.current;
		if (name === null) return;
		resizing.current = null;
		if (!result.ok) {
			setPhoto({ name, state: 'refused', reason: attachRefusal(result.reason) });
			return;
		}
		setPhoto({ name, previewSrc: URL.createObjectURL(result.blob), state: 'uploading' });
		setPostedBytes(result.blob.size);
		postPhoto(upload, result.blob);
	};

	const { load } = history;
	useEffect(() => {
		load(url);
	}, [load, url]);

	const { submit: postOpen } = opener;
	useEffect(() => {
		if (asksOpening)
			postOpen({ intent: 'open', timeZone: zone() }, { method: 'post', action: url });
	}, [asksOpening, postOpen, url]);
	const opening = asksOpening && (opener.state !== 'idle' || opener.data === undefined);

	const send = ({ text, imageIds }: ChatSend) => {
		setSent({ answers: false, text });
		setUnsent(undefined);
		turn.submit(
			{
				message: text,
				imageIds: JSON.stringify(imageIds),
				timeZone: zone()
			},
			{ method: 'post', action: url }
		);
	};

	const answer = (answers: readonly CardAnswer[]) => {
		setSent({ answers: true, text: '' });
		setUnsent(undefined);
		turn.submit(
			{ intent: 'answers', answers: JSON.stringify(answers), timeZone: zone() },
			{ method: 'post', action: url }
		);
	};

	const dismiss = () => setOpen(false);

	const running = turn.state !== 'idle';
	const sheet = wide ? null : !open ? (
		openedOnArrival ? (
			<ChatClosed />
		) : null
	) : history.data === undefined ? (
		<ChatOpening />
	) : null;
	const turns = history.data?.turns;
	const panel =
		turns === undefined ? null : (
			<AiPanel
				messages={inFlight(turns, turn.formData)}
				isRunning={running}
				onSend={send}
				onAnswer={answer}
				open={open}
				onDismiss={dismiss}
				opening={opening}
				suggestions={liveAsk(turns) === null && drafted(turns) ? SUGGESTIONS : []}
				imageSrc={imageSrc}
				unsent={unsent}
				attachment={photo && { ...photo, onRemove: remove }}
				attach={({ held }) => <AttachControl held={held} onPicked={picked} onResized={resized} />}
			/>
		);

	return {
		open: () => {
			setUnsent(undefined);
			setOpenedOnArrival(false);
			setOpen(true);
		},
		panel,
		sheet
	};
}
