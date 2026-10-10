import { type ReactNode, useEffect, useRef, useState } from 'react';
import { useFetcher } from 'react-router';
import { describeResized, type Resized } from '@better-giving/operator/images/resize';
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
import { AiLayer, ChatClosed, ChatOpening } from './editor-shell';
import { postPhoto, type UploadAnswer } from './photo-upload';
import { useWide } from './wide';

// the AI panel as both editors mount it: `panel` for the shell's slot after the preview, `open`
// for the bar's AI press, and `sheet` for the shell's children: `AiLayer`, which tells the bar
// whether the panel is open and lets Settings and a clicked block close it, and what stands in the
// panel's place while it is on its way or once it went (./editor-shell.tsx). the chat is the page's
// chat route's (src/routes/_app.admin.pages.$pageId.chat.ts), asked by fetchers held by the editor
// rather than the panel, so a turn sent and closed on still lands: one loading the chat as the
// editor opens, because whether it is empty decides the arrival; one posting the opening; one
// posting each turn and each card's answers.
//
// **a drafted page opens with the panel closed**, at every width, and the AI press opens it. it
// stays open through a turn and the reply that lands, and goes on the AI press again, on Escape or
// the sheet's X, and as the bar's Settings or a clicked block opens a sheet. a turn that lands while
// it is closed marks the AI press unread until it is next opened, and moves no focus; a refusal that
// landed that way is still there when it is, where one the operator has already read is cleared.
//
// a page never drafted whose chat reads empty on arrival is asked its opening questions: one `open`
// post carrying the browser's zone, once per editor visit, so a chat a Reset or a Discard empties
// later is not asked again until the editor is opened anew. the panel reads `opening` until the
// asked turn lands with the revalidation that follows the post; an opening the route could not
// answer ends it and is said where a refused send is. a drafted page's empty chat is asked nothing:
// the questions draft a page, and this one has a draft, so its panel opens on the box alone.
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
// is said in its own `error`). answers nothing was stored from come back as `answerRefusal`, said
// at the card, which is still up with every value in it and the focus on its press: worded here
// for `answered`, `stale`, `failed` and `refused_again`, and otherwise the route's own `error` —
// the reply's words where no model answered (503 `unanswered`), which mark a command in backticks
// the card draws as code. each refusal is held in state, taken from each new answer the fetcher
// lands, because the fetcher's answer outlives the panel; it is cleared by the next send or
// answers, so a refusal repeated word for word still reads as a new one, and by reopening the
// panel on one already read.
//
// suggestions are offered only while no card is live and a reply has changed the page: before
// that, the card is what drafts it, and a suggestion beside a card would skip it unanswered.
//
// **a page never drafted is `undrafted`**, the answer the editor's shell is drawn by
// (./editor-shell.tsx): the editor's loader read it before any hand edit or accepted turn
// (`drafted`), and no reply in the chat has changed it since. it is the routes' to hand the shell,
// and the panel is `alone` while it holds. until the chat has loaded it is the loader's answer
// alone, so the server draws the layout the chat will keep. the turn that first changes the page
// ends it in the render it lands in. from the wide breakpoint the panel stays open where it stood,
// now floating over the preview; below it the panel goes, the preview is shown, and a focus left on
// the document goes to the AI press (`ChatClosed`). an empty chat is asked its opening questions in
// the panel, and opens no sheet on arrival.
//
// the panel mounts once the chat has loaded rather than on an empty log: the log takes the chat it
// opens on as already read ($lib/admin/chat/chat-log.tsx), and would speak the whole history as it
// arrived. until then `ChatOpening` stands in the panel's place and holds the AI press busy
// (./editor-shell.tsx).
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
const changedPage = (turns: readonly ChatMessage[]) =>
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
			readonly reason?: 'stale' | 'failed' | 'answered' | 'unanswered' | 'refused_again';
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
function answersRefusal(answer: Refused): string {
	switch (answer.reason) {
		case 'answered':
			return 'These questions are no longer the latest in the chat. Reload the editor to see where it stands.';
		case 'stale':
			return 'The page was saved while this was being written, so nothing changed. Send your answers again.';
		case 'failed':
			return 'That didn’t go through. Send your answers again.';
		case 'refused_again':
			return 'Couldn’t update the page from your answers. Send them again.';
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

/**
 * `drafted` is the editor's loader's answer: the page had been drafted, by hand or by an accepted
 * turn, when it was read. absent, the page is taken as drafted.
 */
export function useEditorChat(
	url: string,
	drafted = true
): {
	open: () => void;
	panel: ReactNode;
	sheet: ReactNode;
	undrafted: boolean;
} {
	const wide = useWide();
	const [open, setOpen] = useState(false);
	/**
	 * the panel was up and went, so `ChatClosed` stands in its place: what hands the focus to the AI
	 * press when the panel took it down with it.
	 */
	const [went, setWent] = useState(false);
	/** a turn landed while the panel was closed, and it has not been opened since. */
	const [unread, setUnread] = useState(false);
	const history = useFetcher<History>();
	const turn = useFetcher<TurnAnswer>();
	const opener = useFetcher<TurnAnswer>();
	const undrafted = !drafted && (history.data === undefined || !changedPage(history.data.turns));
	const [wasUndrafted, setWasUndrafted] = useState(undrafted);
	if (undrafted !== wasUndrafted) {
		setWasUndrafted(undrafted);
		setUnread(false);
		setOpen(!undrafted && wide);
		setWent(!undrafted && !wide);
	}
	/** the page never drafted and its chat read empty on arrival: this visit asks the opening. */
	const [asksOpening, setAsksOpening] = useState(false);
	const [arrived, setArrived] = useState(false);
	if (!arrived && history.data !== undefined) {
		setArrived(true);
		if (!drafted && history.data.turns.length === 0) setAsksOpening(true);
	}
	/** the last post: a send's words, for the box to take back if nothing is stored from it. */
	const [sent, setSent] = useState<{ answers: boolean; text: string }>({
		answers: false,
		text: ''
	});
	const [unsent, setUnsent] = useState<ChatUnsent | undefined>(undefined);
	const [answerRefusal, setAnswerRefusal] = useState<string | undefined>(undefined);
	const [answered, setAnswered] = useState(turn.data);
	const upload = useFetcher<UploadAnswer>();
	const [photo, setPhoto] = useState<Photo | undefined>(undefined);
	/** the size of the photo being posted, for its row's detail once it is stored. */
	const [postedBytes, setPostedBytes] = useState(0);
	const [uploadAnswered, setUploadAnswered] = useState(upload.data);
	if (turn.data !== answered) {
		setAnswered(turn.data);
		// `wasUndrafted` is the panel alone, shown, as the turn landed.
		if (turn.data !== undefined && !open && !wasUndrafted) setUnread(true);
		if (turn.data !== undefined && 'error' in turn.data) {
			if (sent.answers) setAnswerRefusal(answersRefusal(turn.data));
			else setUnsent({ text: sent.text, reason: unsentReason(turn.data) });
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
		setAnswerRefusal(undefined);
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
		setAnswerRefusal(undefined);
		turn.submit(
			{ intent: 'answers', answers: JSON.stringify(answers), timeZone: zone() },
			{ method: 'post', action: url }
		);
	};

	const close = () => {
		if (!open) return;
		setOpen(false);
		setWent(true);
	};

	const running = turn.state !== 'idle';
	const sheet = undrafted ? null : (
		<>
			<AiLayer open={open} unread={unread} onClose={close} />
			{open ? history.data === undefined ? <ChatOpening /> : null : went ? <ChatClosed /> : null}
		</>
	);
	const turns = history.data?.turns;
	const panel =
		turns === undefined ? null : (
			<AiPanel
				messages={inFlight(turns, turn.formData)}
				isRunning={running}
				onSend={send}
				onAnswer={answer}
				open={open}
				onDismiss={close}
				alone={undrafted}
				opening={opening}
				suggestions={liveAsk(turns) === null && changedPage(turns) ? SUGGESTIONS : []}
				imageSrc={imageSrc}
				unsent={unsent}
				answerRefusal={answerRefusal}
				attachment={photo && { ...photo, onRemove: remove }}
				attach={({ held }) => <AttachControl held={held} onPicked={picked} onResized={resized} />}
			/>
		);

	return {
		open: () => {
			if (!unread) {
				setUnsent(undefined);
				setAnswerRefusal(undefined);
			}
			setUnread(false);
			setWent(false);
			setOpen(true);
		},
		panel,
		sheet,
		undrafted
	};
}
