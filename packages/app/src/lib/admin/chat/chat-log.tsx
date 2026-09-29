import {
	MessagePrimitive,
	type MessageState,
	type TextMessagePartProps,
	ThreadPrimitive
} from '@assistant-ui/react';
import { Mark } from '@better-giving/operator/components/status/Mark';
import { MarkedText } from '@better-giving/operator/marked-text.react';
import { useEffect, useRef, useState } from 'react';
import type { ChatMessage, ChatWaiting } from './chat-sheet';

const FELL_BACK = 'Your chosen model didn’t answer, so the free model wrote this reply.';
const REFUSED =
	'That reply didn’t fit the page, so nothing changed. Ask again, or say it another way.';

const noteOf = (message: ChatMessage) =>
	message.note === 'fell-back' ? FELL_BACK : message.note === 'refused' ? REFUSED : null;

function Text({ text }: TextMessagePartProps) {
	return <p>{text}</p>;
}

/* a reply's words, with a backticked span drawn as code: the fix-it sentences the server answers
   with mark a command or a name that way ($lib/server/ai/generate.ts). an operator's own words
   are drawn as typed, backticks and all. */
function ReplyText({ text }: TextMessagePartProps) {
	return (
		<p>
			<MarkedText text={text} />
		</p>
	);
}

function OperatorTurn({
	message,
	imageSrc
}: {
	message: ChatMessage;
	imageSrc: (id: string) => string;
}) {
	return (
		<MessagePrimitive.Root className="adm-chat__turn">
			{message.imageIds?.map((id) => (
				<img key={id} className="adm-chat__photo" src={imageSrc(id)} alt="Sent by you" />
			))}
			{message.text === '' ? null : (
				<div className="adm-chat__mine">
					<MessagePrimitive.Parts components={{ Text }} />
				</div>
			)}
		</MessagePrimitive.Root>
	);
}

function AssistantTurn({ message }: { message: ChatMessage }) {
	return (
		<MessagePrimitive.Root className="adm-chat__turn">
			<MessagePrimitive.Parts components={{ Text: ReplyText }} />
			{message.note === 'fell-back' ? (
				<p className="adm-chat__note">
					<Mark name="info" />
					{FELL_BACK}
				</p>
			) : message.note === 'refused' ? (
				<p className="adm-momentary adm-momentary--blocked">
					<Mark name="circle-alert" />
					{REFUSED}
				</p>
			) : null}
		</MessagePrimitive.Root>
	);
}

/* the sheet's body: every turn, the one being written, and what a screen reader is told.

   the turns are thread and message primitives over the runtime's copy of `messages`, and each
   draws its photos and note from the prop's row with its id.

   what is announced is two regions mounted with the log and never hidden, so the first thing either
   says is a change to a region rather than a region arriving. the log speaks each assistant reply
   that arrives after the sheet opened — the history it opened on is read, not announced, which is
   why that history's ids are taken once, on mount. the status says a reply is being written and
   falls silent when it lands; the visible line saying the same is kept out of the tree so it is not
   read twice.

   the sheet's body is the scroller, not the viewport, so the viewport's own scrolling is off and the
   newest turn is brought into view here, on the turn that arrived or the wait that began. */
export function ChatLog({
	messages,
	running,
	waiting,
	imageSrc
}: {
	messages: readonly ChatMessage[];
	running: boolean;
	waiting: ChatWaiting | undefined;
	imageSrc: (imageId: string) => string;
}) {
	const [history] = useState(
		() => new Set(messages.flatMap((m) => (m.role === 'assistant' ? [m.id] : [])))
	);
	const replies = messages.filter((m) => m.role === 'assistant' && !history.has(m.id));
	const byId = new Map(messages.map((m) => [m.id, m]));
	const writing = !running
		? ''
		: waiting === undefined
			? 'Writing a reply'
			: 'Writing the first draft';

	const log = useRef<HTMLDivElement>(null);
	const newest = messages.at(-1)?.id;
	useEffect(() => {
		log.current?.lastElementChild?.scrollIntoView({ block: 'end' });
	}, [newest, running]);

	const turn = ({ message }: { message: MessageState }) => {
		const row = byId.get(message.id);
		if (row === undefined) return null;
		return row.role === 'operator' ? (
			<OperatorTurn message={row} imageSrc={imageSrc} />
		) : (
			<AssistantTurn message={row} />
		);
	};

	return (
		<>
			<ThreadPrimitive.Viewport ref={log} className="adm-chat__log" autoScroll={false}>
				{waiting === undefined ? null : (
					<div className="adm-chat__turn">
						<div className="adm-chat__mine">
							<strong>{waiting.title}</strong>
							<span>{waiting.purpose}</span>
						</div>
					</div>
				)}
				<ThreadPrimitive.Messages>{turn}</ThreadPrimitive.Messages>
				{writing === '' ? null : (
					<div className="adm-chat__turn" aria-hidden="true">
						<p className="adm-chat__waiting">
							{writing}
							<Mark name="grip-vertical" className="adm-dots" />
						</p>
					</div>
				)}
			</ThreadPrimitive.Viewport>
			<div className="adm-vh">
				<div role="log" aria-live="polite">
					{replies.map((m) => (
						<p key={m.id}>
							<MarkedText text={[m.text, noteOf(m)].filter(Boolean).join(' ')} />
						</p>
					))}
				</div>
				<p role="status">{writing}</p>
			</div>
		</>
	);
}
