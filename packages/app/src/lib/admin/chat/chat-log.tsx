import {
	MessagePrimitive,
	type MessageState,
	type TextMessagePartProps,
	ThreadPrimitive
} from '@assistant-ui/react';
import { Mark } from '@better-giving/operator/components/status/Mark';
import { MarkedText } from '@better-giving/operator/marked-text.react';
import { Fragment, useEffect, useRef, useState } from 'react';
import type { ChatMessage } from './ai-panel';
import { type CardAnswer, QuestionCard, type QuestionRound, STARTER_NOTE } from './question-card';

const FELL_BACK = 'Your chosen model didn’t answer, so the default model wrote this reply.';
const REFUSED =
	'That reply didn’t fit the page, so nothing changed. Ask again, or say it another way.';

const noteOf = (message: ChatMessage) => {
	switch (message.note) {
		case 'fell-back':
			return FELL_BACK;
		case 'refused':
			return REFUSED;
		case 'starter':
			return STARTER_NOTE;
		default:
			return null;
	}
};

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

/* an operator turn that answered a card is drawn as what was answered, a prompt over each answer's
   words, rather than as the words the server composed for the model from them. one that answered
   nothing is its words — `Skipped the questions.` */
function OperatorTurn({
	message,
	imageSrc
}: {
	message: ChatMessage;
	imageSrc: (id: string) => string;
}) {
	const answers = message.answers ?? [];
	return (
		<MessagePrimitive.Root className="adm-chat__turn">
			{message.imageIds?.map((id) => (
				<img key={id} className="adm-chat__photo" src={imageSrc(id)} alt="Sent by you" />
			))}
			{answers.length > 0 ? (
				<div className="adm-answers">
					<p className="adm-answers__title">Your answers</p>
					<dl className="adm-answers__list">
						{answers.map((answer) => (
							<Fragment key={answer.id}>
								<dt>{answer.prompt}</dt>
								<dd>{answer.words}</dd>
							</Fragment>
						))}
					</dl>
				</div>
			) : message.text === '' ? null : (
				<div className="adm-chat__mine">
					<MessagePrimitive.Parts components={{ Text }} />
				</div>
			)}
		</MessagePrimitive.Root>
	);
}

/** the card under an asked turn while it is the chat's last, and what it answers through. */
type Ask = {
	readonly round: QuestionRound;
	readonly onAnswer: (answers: readonly CardAnswer[]) => void;
	readonly busy: boolean;
	readonly refusal: string | undefined;
};

function AssistantTurn({ message, ask }: { message: ChatMessage; ask: Ask | null }) {
	const questions = message.questions ?? [];
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
			{ask === null || questions.length === 0 ? null : (
				<QuestionCard
					questions={questions}
					round={ask.round}
					onSubmit={ask.onAnswer}
					busy={ask.busy}
					starter={message.note === 'starter'}
					refusal={ask.refusal}
				/>
			)}
		</MessagePrimitive.Root>
	);
}

/** the asked turn whose card is live: the chat's last turn, where it asks. */
export function liveAsk(messages: readonly ChatMessage[]): ChatMessage | null {
	const last = messages.at(-1);
	return last?.role === 'assistant' && (last.questions?.length ?? 0) > 0 ? last : null;
}

/* the panel's body: every turn, the one being written, and what a screen reader is told.

   the turns are thread and message primitives over the runtime's copy of `messages`, and each
   draws its photos, its note, its answers and its questions from the prop's row with its id.

   an asked turn draws its question card only while it is the chat's last turn: a turn after it —
   the answers, or the operator's own words instead — is what the card was waiting for, and from
   then on the asked turn is its words alone. the card is the opening round's when the asked turn is
   the chat's first, and a follow-up's otherwise.

   what is announced is two regions mounted with the log and never hidden, so the first thing either
   says is a change to a region rather than a region arriving. the log speaks each assistant reply
   that arrives after the panel mounted — the history it mounted on is read, not announced, which is
   why that history's ids are taken once, on mount — with the line under it, the starter questions'
   included. the status says the opening questions are being read or a reply is being written, and
   falls silent when it lands; the visible line saying the same is kept out of the tree so it is not
   read twice.

   the panel's body is the scroller, not the viewport, so the viewport's own scrolling is off and the
   newest turn is brought into view here, on the turn that arrived or the wait that began. */
export function ChatLog({
	messages,
	running,
	opening,
	imageSrc,
	onAnswer,
	answering,
	answerRefusal
}: {
	messages: readonly ChatMessage[];
	running: boolean;
	/** the opening questions are being read; `messages` is empty until they land. */
	opening: boolean;
	imageSrc: (imageId: string) => string;
	onAnswer: (answers: readonly CardAnswer[]) => void;
	/** answers sent from the card are on their way. */
	answering: boolean;
	/** why the card's last answers were not taken. */
	answerRefusal: string | undefined;
}) {
	const [history] = useState(
		() => new Set(messages.flatMap((m) => (m.role === 'assistant' ? [m.id] : [])))
	);
	const replies = messages.filter((m) => m.role === 'assistant' && !history.has(m.id));
	const byId = new Map(messages.map((m) => [m.id, m]));
	const asking = liveAsk(messages)?.id;
	const round: QuestionRound = messages[0]?.id === asking ? 'opening' : 'follow-up';
	const writing = opening ? 'Reading your page' : running ? 'Writing a reply' : '';
	// the status takes its words a commit after the log mounts: the log mounts in the same render
	// that starts the opening, and a region that arrives already holding words is not announced.
	const [spoken, setSpoken] = useState('');
	useEffect(() => setSpoken(writing), [writing]);

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
			<AssistantTurn
				message={row}
				ask={
					row.id === asking ? { round, onAnswer, busy: answering, refusal: answerRefusal } : null
				}
			/>
		);
	};

	return (
		<>
			<ThreadPrimitive.Viewport ref={log} className="adm-chat__log" autoScroll={false}>
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
				<p role="status">{spoken}</p>
			</div>
		</>
	);
}
