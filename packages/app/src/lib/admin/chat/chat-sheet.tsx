import {
	type AppendMessage,
	AssistantRuntimeProvider,
	type ThreadMessageLike,
	useExternalStoreRuntime
} from '@assistant-ui/react';
import { Sheet } from '@better-giving/operator/components/shell/Sheet';
import type { ReactNode } from 'react';
import { ChatComposer } from './chat-composer';
import { ChatLog } from './chat-log';

/**
 * one turn of a page's chat, as its `chat_turn` row holds it.
 *
 * `note` marks an assistant turn the log draws a line under: `fell-back` when the chosen model did
 * not answer and the free model wrote it, `refused` when the reply did not fit the page and nothing
 * changed.
 */
export interface ChatMessage {
	readonly id: string;
	readonly role: 'operator' | 'assistant';
	readonly text: string;
	readonly imageIds?: readonly string[] | undefined;
	readonly note?: 'fell-back' | 'refused' | undefined;
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

/** a new campaign's first draft being written from its title and "What's it for?" line. */
export interface ChatWaiting {
	readonly title: string;
	readonly purpose: string;
}

export interface ChatSheetProps {
	readonly messages: readonly ChatMessage[];
	readonly isRunning: boolean;
	readonly onSend: (send: ChatSend) => void;
	readonly onDismiss: () => void;
	readonly suggestions: readonly string[];
	/** the url a stored photo is served at. */
	readonly imageSrc: (imageId: string) => string;
	/** set while a new campaign's first draft is written; `messages` is empty until it lands. */
	readonly waiting?: ChatWaiting | undefined;
	readonly attachment?: ChatAttachment | undefined;
	/** the attach press, drawn at the start of the composer's row. `held` while a reply is written. */
	readonly attach?: ((composer: { held: boolean }) => ReactNode) | undefined;
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

/* the chat sheet: the log in its body, suggestions and the composer in its foot. assistant-ui's
   thread, message and composer primitives draw it, on an external-store runtime built from these
   props — the route owns the history and the run, and every send leaves through `onSend`.

   the runtime's provider stands outside the sheet because the body and the foot are two slots of
   packages/operator/src/components/shell/Sheet.jsx, and both read the one thread.

   a reply is being written while `isRunning` or `waiting` is set. Send is held and the suggestions
   go, and that is all: the box keeps its words and its focus, which is why nothing here hands the
   runtime `isDisabled`. */
export function ChatSheet({
	messages,
	isRunning,
	onSend,
	onDismiss,
	suggestions,
	imageSrc,
	waiting,
	attachment,
	attach
}: ChatSheetProps) {
	const running = isRunning || waiting !== undefined;
	const imageIds = attachment?.state === 'ready' ? [attachment.imageId] : [];
	const runtime = useExternalStoreRuntime<ChatMessage>({
		messages,
		isRunning: running,
		convertMessage,
		onNew: async (message) => onSend({ text: textOf(message), imageIds })
	});

	return (
		<AssistantRuntimeProvider runtime={runtime}>
			<Sheet
				title="Chat"
				tall
				onDismiss={onDismiss}
				foot={
					<ChatComposer
						running={running}
						suggestions={suggestions}
						attachment={attachment}
						attach={attach}
					/>
				}
			>
				<ChatLog messages={messages} running={running} waiting={waiting} imageSrc={imageSrc} />
			</Sheet>
		</AssistantRuntimeProvider>
	);
}
