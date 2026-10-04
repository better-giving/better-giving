import {
	type AppendMessage,
	AssistantRuntimeProvider,
	type ThreadMessageLike,
	useExternalStoreRuntime
} from '@assistant-ui/react';
import { Sheet } from '@better-giving/operator/components/shell/Sheet';
import { type ReactNode, useId, useState } from 'react';
import { useWide } from '../editor/wide';
import { ChatComposer } from './chat-composer';
import { ChatLog, liveAsk } from './chat-log';
import type { CardAnswer, CardQuestion } from './question-card';

/**
 * one turn of a page's chat, as its `chat_turn` row holds it.
 *
 * `note` marks an assistant turn the log draws a line under: `fell-back` when the chosen model did
 * not answer and the default model wrote it, `refused` when the reply did not fit the page and nothing
 * changed, `starter` when the AI did not answer the opening and the page's usual questions were
 * asked instead. `unanswered` marks a turn no model answered, whose words say so; no line is drawn.
 */
export interface ChatMessage {
	readonly id: string;
	readonly role: 'operator' | 'assistant';
	readonly text: string;
	readonly imageIds?: readonly string[] | undefined;
	readonly note?: 'fell-back' | 'refused' | 'starter' | 'unanswered' | undefined;
	/** an assistant turn that asks: its words are `text` and these are put under them as a card. */
	readonly questions?: readonly CardQuestion[] | undefined;
	/** an operator turn that answered a card: each question answered, and the answer in words. */
	readonly answers?: readonly AnsweredQuestion[] | undefined;
}

/** one answered question as the log draws it: the question's prompt, and the answer as words. */
export interface AnsweredQuestion {
	readonly id: string;
	readonly prompt: string;
	readonly words: string;
}

/** what a send carries: the words, and the photo that landed with them. either may be empty. */
export interface ChatSend {
	readonly text: string;
	readonly imageIds: readonly string[];
}

/**
 * the photo on its way into the chat, as the attach control reports it. Send waits while it is
 * `resizing` or `uploading`, carries `imageId` once it is `ready`, and leaves it behind when it is
 * `refused`.
 */
export type ChatAttachment = {
	readonly name: string;
	/** a picture of it for the thumbnail. absent, the thumbnail draws the image mark. */
	readonly previewSrc?: string | undefined;
	readonly onRemove: () => void;
} & (
	| { readonly state: 'resizing' | 'uploading' }
	| {
			readonly state: 'ready';
			readonly imageId: string;
			/** its size once resized, e.g. `1600 × 1200, 480 KB`. */
			readonly detail: string;
	  }
	| { readonly state: 'refused'; readonly reason: string }
);

/**
 * a send the route could not take, handed back: the words the operator sent and why they did not
 * go, as a sentence the operator reads.
 */
export interface ChatUnsent {
	readonly text: string;
	readonly reason: string;
}

export interface AiPanelProps {
	readonly messages: readonly ChatMessage[];
	readonly isRunning: boolean;
	readonly onSend: (send: ChatSend) => void;
	/** the answers a question card sent, or none from its skip press. */
	readonly onAnswer: (answers: readonly CardAnswer[]) => void;
	/** below the wide breakpoint, whether the sheet is up. the docked column ignores it. */
	readonly open: boolean;
	/** the sheet's X and Escape, below the wide breakpoint. */
	readonly onDismiss: () => void;
	readonly suggestions: readonly string[];
	/** the url a stored photo is served at. */
	readonly imageSrc: (imageId: string) => string;
	/** set while the opening questions are being asked for; `messages` is empty until they land. */
	readonly opening?: boolean | undefined;
	readonly attachment?: ChatAttachment | undefined;
	/** the attach press, drawn at the start of the composer's row. `held` while a reply is written. */
	readonly attach?: ((composer: { held: boolean }) => ReactNode) | undefined;
	/**
	 * the last send refused. a value is new when its words or its reason differ from the one before,
	 * so the route may build a fresh object on every render; to hand back the same refusal twice, pass
	 * `undefined` while the second send is in flight.
	 */
	readonly unsent?: ChatUnsent | undefined;
}

const convertMessage = (message: ChatMessage): ThreadMessageLike => ({
	id: message.id,
	role: message.role === 'operator' ? 'user' : 'assistant',
	content: message.text === '' ? [] : [{ type: 'text', text: message.text }]
});

const textOf = (message: AppendMessage) =>
	message.content
		.flatMap((part) => (part.type === 'text' ? [part.text] : []))
		.join('\n')
		.trim();

/* the AI panel: the log in its body, suggestions and the composer in its foot. from the wide
   breakpoint (../editor/wide.ts) it is a column docked beside the preview, always there and never
   dismissed — non-modal, so the page and the panel are worked side by side. below it, it is a modal
   sheet, up while `open` and taken down by `onDismiss`. one body either way, so what the operator
   reads and types in is the same thing in both.

   assistant-ui's thread, message and composer primitives draw it, on an external-store runtime
   built from these props — the route owns the history and the run, and every send leaves through
   `onSend`, every card's answers through `onAnswer`. the runtime's provider stands outside the
   column and the sheet because their body and foot are two slots, and both read the one thread.

   a reply is being written while `isRunning` or `opening` is set. Send is held and the
   suggestions go, and that is all: the box keeps its words and its focus, which is why nothing here
   hands the runtime `isDisabled`. a live question card is held while `isRunning` and free words go
   beside it, which is what the box's placeholder says while one is up.

   a refused send comes back through `unsent`. its reason is drawn at the composer until the next
   send or answer, which every press reaches through `onNew` or the card, so that is where it is
   cleared; putting the words back and the focus in the box is the composer's, off the value this
   holds. */
export function AiPanel(props: AiPanelProps) {
	const wide = useWide();
	// the sheet's state goes with it: a sheet opened again is a sheet drawn afresh, with no refusal
	// held over from the last time it was up.
	return wide || props.open ? <Shown {...props} wide={wide} /> : null;
}

function Shown({
	messages,
	isRunning,
	onSend,
	onAnswer,
	onDismiss,
	suggestions,
	imageSrc,
	opening = false,
	attachment,
	attach,
	unsent,
	wide
}: AiPanelProps & { readonly wide: boolean }) {
	const heading = useId();
	const running = isRunning || opening;
	const imageIds = attachment?.state === 'ready' ? [attachment.imageId] : [];
	const [landed, setLanded] = useState(unsent);
	const [reason, setReason] = useState(unsent?.reason ?? '');
	if (unsent?.text !== landed?.text || unsent?.reason !== landed?.reason) {
		setLanded(unsent);
		if (unsent !== undefined) setReason(unsent.reason);
	}
	const runtime = useExternalStoreRuntime<ChatMessage>({
		messages,
		isRunning: running,
		convertMessage,
		onNew: async (message) => {
			setReason('');
			onSend({ text: textOf(message), imageIds });
		}
	});

	const log = (
		<ChatLog
			messages={messages}
			running={running}
			opening={opening}
			imageSrc={imageSrc}
			onAnswer={(answers) => {
				setReason('');
				onAnswer(answers);
			}}
			answering={isRunning}
		/>
	);
	const composer = (
		<ChatComposer
			running={running}
			suggestions={suggestions}
			attachment={attachment}
			attach={attach}
			unsent={landed}
			reason={reason}
			placeholder={liveAsk(messages) ? 'Or tell me in your own words' : 'Ask for a change'}
		/>
	);

	return (
		<AssistantRuntimeProvider runtime={runtime}>
			{wide ? (
				<aside className="adm-aipanel" aria-labelledby={heading}>
					<div className="adm-aipanel__head">
						<h2 id={heading}>AI</h2>
					</div>
					<div className="adm-aipanel__body">{log}</div>
					<div className="adm-aipanel__foot">{composer}</div>
				</aside>
			) : (
				<Sheet title="AI" tall onDismiss={onDismiss} foot={composer}>
					{log}
				</Sheet>
			)}
		</AssistantRuntimeProvider>
	);
}
