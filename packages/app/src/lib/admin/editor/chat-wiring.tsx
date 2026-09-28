import { type ReactNode, useEffect, useRef, useState } from 'react';
import { useFetcher, useSearchParams } from 'react-router';
import { describeResized, type Resized } from '$lib/images/resize';
import { imageSrc } from '$lib/page/image-src';
import { AttachControl, attachRefusal } from '../chat/attach-control';
import {
	type ChatAttachment,
	type ChatMessage,
	type ChatSend,
	ChatSheet,
	type ChatUnsent
} from '../chat/chat-sheet';
import { postPhoto, type UploadAnswer } from './photo-upload';

// the Chat sheet as both editors mount it: `open` for the Chat entry, and the sheet while it is
// open. the chat is the page's chat route's (src/routes/_app.admin.pages.$pageId.chat.ts), asked
// by two fetchers — one loading the chat as the sheet opens, one posting each turn — both held by
// the editor rather than the sheet, so a turn sent and closed on still lands.
//
// a turn is the three boxes that route takes: the words, the photos as a JSON array, and the
// browser's zone, which an end date the operator names is a day in. while it runs the words stand
// in the log as sent and the sheet holds Send. once it lands, the revalidation that follows every
// fetcher post reads the chat again with both new turns, and reads the editor's own loader, whose
// version the preview is keyed on — so the preview redraws on an accepted turn, the one that moves
// the draft, and on no other.
//
// a send nothing was stored from comes back as `unsent`: its words, for the box to take back, and
// the operator's line for why, worded here off the answer's `reason` (a 400 or 404 names none and
// is said in its own `error`). the refusal is held in state, taken from each new answer the fetcher
// lands, because the fetcher's answer outlives the sheet; it is cleared by the next send, so a
// refusal repeated word for word still reads as a new one, and by reopening the sheet.
//
// the sheet mounts once the chat has loaded rather than on an empty log: the log takes the chat it
// opens on as already read ($lib/admin/chat/chat-log.tsx), and would speak the whole history as it
// arrived.
//
// a photo is attached by the sheet's attach press, which resizes it in the browser and reports
// here; the resized photo is posted at once to the images route (./photo-upload.ts) by a third
// fetcher, whose answer is the stored id the next send carries — the sheet puts a ready photo's id
// in `imageIds` itself. an upload's answer is taken only while its photo is still `uploading`, so
// one landing after Remove or after a new pick is dropped. the photo stays attached through a send
// nothing was stored from, so the resend carries it, and goes once a turn carrying it lands.
//
// `?chat` opens it on arrival. the create action lands a campaign made with a "What's it for?"
// line there, its first turn already answered (`createCampaign` in $lib/server/pages/campaign.ts
// runs it before the redirect). closing drops the flag, so a reload opens the editor bare.

const SUGGESTIONS = ['Tell donors what each amount buys', 'Add a FAQ', 'Shorten the story'];

/** the search param that opens the chat on arrival. */
export const CHAT_PARAM = 'chat';

/** what the chat route's loader answers. */
type History = { readonly turns: readonly ChatMessage[] };

/** what the chat route's action answers: the turn stored, or why nothing was. */
type TurnAnswer =
	| { readonly outcome: string; readonly turns: readonly ChatMessage[] }
	| { readonly error: string; readonly reason?: 'stale' | 'failed' };

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
function unsentReason(answer: Extract<TurnAnswer, { error: string }>): string {
	switch (answer.reason) {
		case 'stale':
			return 'The page was saved while this was being written, so nothing changed. Send it again.';
		case 'failed':
			return 'That didn’t go through. Send it again.';
		default:
			return answer.error;
	}
}

/** the chat with the message being answered after it, until the chat that stores it lands. */
function inFlight(
	turns: readonly ChatMessage[],
	sent: FormData | undefined
): readonly ChatMessage[] {
	if (sent === undefined) return turns;
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

export function useEditorChat(url: string): { open: () => void; sheet: ReactNode } {
	const [params, setParams] = useSearchParams();
	const [open, setOpen] = useState(() => params.has(CHAT_PARAM));
	const history = useFetcher<History>();
	const turn = useFetcher<TurnAnswer>();
	/** the words of the last send, for the box to take back if nothing is stored from it. */
	const [sentText, setSentText] = useState('');
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
			setUnsent({ text: sentText, reason: unsentReason(turn.data) });
		} else if (turn.data !== undefined) {
			setPhoto(undefined);
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
		if (open) load(url);
	}, [open, load, url]);

	const send = ({ text, imageIds }: ChatSend) => {
		setSentText(text);
		setUnsent(undefined);
		turn.submit(
			{
				message: text,
				imageIds: JSON.stringify(imageIds),
				timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
			},
			{ method: 'post', action: url }
		);
	};

	const dismiss = () => {
		setOpen(false);
		if (params.has(CHAT_PARAM)) {
			setParams(
				(next) => {
					next.delete(CHAT_PARAM);
					return next;
				},
				{ replace: true, preventScrollReset: true }
			);
		}
	};

	const running = turn.state !== 'idle';
	const sheet =
		open && history.data !== undefined ? (
			<ChatSheet
				messages={inFlight(history.data.turns, turn.formData)}
				isRunning={running}
				onSend={send}
				onDismiss={dismiss}
				suggestions={SUGGESTIONS}
				imageSrc={imageSrc}
				unsent={unsent}
				attachment={photo && { ...photo, onRemove: remove }}
				attach={({ held }) => <AttachControl held={held} onPicked={picked} onResized={resized} />}
			/>
		) : null;

	return {
		open: () => {
			setUnsent(undefined);
			setOpen(true);
		},
		sheet
	};
}
