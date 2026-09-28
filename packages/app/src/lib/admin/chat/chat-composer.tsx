import { ComposerPrimitive, ThreadPrimitive, useAui, useAuiState } from '@assistant-ui/react';
import { Button } from '@better-giving/operator/components/controls/Button';
import { Mark } from '@better-giving/operator/components/status/Mark';
import { StatusWord } from '@better-giving/operator/components/status/StatusWord';
import {
	type FormEvent,
	type KeyboardEvent,
	type ReactNode,
	useEffect,
	useId,
	useRef
} from 'react';
import type { ChatAttachment, ChatUnsent } from './chat-sheet';

function stateOf(attachment: ChatAttachment) {
	switch (attachment.state) {
		case 'resizing':
			return 'Resizing';
		case 'uploading':
			return 'Uploading';
		case 'ready':
			return attachment.detail;
		case 'refused':
			return attachment.reason;
	}
}

function Attachment({
	attachment,
	onRemove
}: {
	attachment: ChatAttachment;
	onRemove: () => void;
}) {
	const busy = attachment.state === 'resizing' || attachment.state === 'uploading';
	return (
		<div
			className={
				attachment.state === 'refused' ? 'adm-attachment adm-attachment--refused' : 'adm-attachment'
			}
		>
			{attachment.previewSrc === undefined ? (
				<span className="adm-attachment__thumb">
					<Mark name="image" />
				</span>
			) : (
				<img className="adm-attachment__thumb" src={attachment.previewSrc} alt="" />
			)}
			<span className="adm-attachment__text">
				<span className="adm-attachment__name">{attachment.name}</span>
				<span className="adm-attachment__state">
					{attachment.state === 'refused' ? <Mark name="circle-alert" /> : null}
					{stateOf(attachment)}
					{busy ? <Mark name="grip-vertical" className="adm-dots" /> : null}
				</span>
			</span>
			<Button
				type="button"
				variant="quiet"
				size="sm"
				mark="x"
				aria-label="Remove photo"
				onClick={onRemove}
			/>
		</div>
	);
}

/* the sheet's foot: suggestions, the photo on its way, and the box with its Send.

   while a reply is written the box keeps its words and its focus and Send is held with
   `aria-disabled`, so the press the operator is standing on is not taken out from under them. the
   runtime's own Send button would go natively `disabled`, and its own send refuses a photo with no
   words — this photo is the attach control's, not a runtime attachment — so the press and the
   submit are drawn here and send through the thread's `append`, which reaches the sheet's `onNew`.

   a suggestion sends its own words and leaves a draft in the box alone. the suggestions go while a
   reply is written, so the press puts the focus in the box before it sends, which is where the
   reader is left when the row they pressed in is gone; Remove on a photo does the same.

   a refused send puts its words back only into an empty box — whatever was typed while it was
   away is the newer draft — and moves the focus into the box, where its reason under it is read
   out with it. that region is on the page before it has anything to say, so it is announced when
   it does. */
export function ChatComposer({
	running,
	suggestions,
	attachment,
	attach,
	unsent,
	reason
}: {
	running: boolean;
	suggestions: readonly string[];
	attachment: ChatAttachment | undefined;
	attach: ((composer: { held: boolean }) => ReactNode) | undefined;
	/** the refused send, the same object until its words or its reason change. */
	unsent: ChatUnsent | undefined;
	/** why the last send was refused, or empty once another send leaves. */
	reason: string;
}) {
	const aui = useAui();
	const text = useAuiState((s) => s.composer.text).trim();
	const input = useRef<HTMLTextAreaElement>(null);
	const focusBox = () => input.current?.focus();
	const reasonId = useId();

	useEffect(() => {
		if (unsent === undefined) return;
		if (aui.composer.getState().text.trim() === '') aui.composer.setText(unsent.text);
		input.current?.focus();
	}, [aui, unsent]);

	const landing = attachment?.state === 'resizing' || attachment?.state === 'uploading';
	const canSend = !running && !landing && (text !== '' || attachment?.state === 'ready');

	const submit = (event: FormEvent) => {
		event.preventDefault();
		if (!canSend) return;
		aui.thread.append({ content: text === '' ? [] : [{ type: 'text', text }] });
		aui.composer.setText('');
	};

	// a held Enter inserts nothing rather than the newline the runtime lets through while it runs.
	const holdEnter = (event: KeyboardEvent) => {
		if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && !canSend)
			event.preventDefault();
	};

	return (
		<div className="adm-chat__foot">
			{running || attachment !== undefined || suggestions.length === 0 ? null : (
				<div className="adm-chat__suggestions">
					{suggestions.map((prompt) => (
						<ThreadPrimitive.Suggestion
							key={prompt}
							prompt={prompt}
							send
							clearComposer={false}
							onClick={focusBox}
							asChild
						>
							<Button variant="soft" size="sm">
								{prompt}
							</Button>
						</ThreadPrimitive.Suggestion>
					))}
				</div>
			)}
			{attachment === undefined ? null : (
				<Attachment
					attachment={attachment}
					onRemove={() => {
						attachment.onRemove();
						focusBox();
					}}
				/>
			)}
			<ComposerPrimitive.Root className="adm-composer" onSubmit={submit}>
				<ComposerPrimitive.Input
					ref={input}
					className="adm-composer__input"
					aria-label="Message"
					placeholder="Ask for a change"
					aria-describedby={reason === '' ? undefined : reasonId}
					onKeyDown={holdEnter}
				/>
				<div className="adm-composer__row">
					{attach?.({ held: running })}
					<Button
						type="submit"
						variant="primary"
						size="sm"
						mark="arrow-up"
						aria-label="Send"
						aria-disabled={!canSend || undefined}
						className="adm-composer__send"
						onClick={(event) => {
							if (!canSend) event.preventDefault();
						}}
					/>
				</div>
			</ComposerPrimitive.Root>
			<p className="adm-chat__refusal" id={reasonId} role="status">
				{reason === '' ? null : (
					<StatusWord register="momentary" blocked mark="circle-alert">
						{reason}
					</StatusWord>
				)}
			</p>
			<p className="adm-vh" role="status">
				{attachment === undefined ? '' : stateOf(attachment)}
			</p>
		</div>
	);
}
