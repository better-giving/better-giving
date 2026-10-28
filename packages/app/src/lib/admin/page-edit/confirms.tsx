import { Modal } from '@better-giving/operator/behaviour/Dialog';
import { SettingRow } from '@better-giving/operator/components/data/SettingRow';
import { StatusWord } from '@better-giving/operator/components/status/StatusWord';
import { useId } from 'react';

// the edit screens' questions, each a card over the screen that the caller puts up and takes down.
//
// Reset to default and Discard changes destroy work, so each is the danger card, listing only what
// the press replaces. the act stands first, and Escape or a press on the ground is the way out the
// card names.
//
// the act holds its focus while it is in flight — `aria-disabled` and the press turned away, never
// `disabled` — and a refusal it comes back with is said inside the card, in a region that is there
// before it speaks and that the act is described by: the card is a modal, so anything said behind it
// is behind an inert page.

/** a pressed act's props, held while its write is in flight. */
function held(busy: boolean, act: () => void, describedBy: string | undefined) {
	return {
		type: 'button' as const,
		'aria-busy': busy,
		'aria-disabled': busy || undefined,
		'aria-describedby': describedBy,
		onClick: () => {
			if (!busy) act();
		}
	};
}

/** the refusal an act came back with, in the region that was waiting for it. */
function Refusal({ id, text }: { readonly id: string; readonly text: string | null | undefined }) {
	return (
		<p className="adm-dialog__refusal" id={id} role="status">
			{text ? (
				<StatusWord register="momentary" blocked mark="circle-alert">
					{text}
				</StatusWord>
			) : null}
		</p>
	);
}

type ResetConfirmProps = {
	readonly resetting: boolean;
	readonly onReset: () => void;
	readonly onCancel: () => void;
	readonly refusal?: string | null | undefined;
};

/** the Donation page's Reset to default: what it replaces, one row each, and that it is final. */
export function ResetConfirm({ resetting, onReset, onCancel, refusal }: ResetConfirmProps) {
	const refusalId = useId();
	return (
		<Modal
			title="Reset the Donation page to default?"
			danger="Reset to default"
			dangerProps={held(resetting, onReset, refusal ? refusalId : undefined)}
			cancel="Cancel"
			cancelProps={{ type: 'button', onClick: onCancel }}
			onDismiss={onCancel}
		>
			<div>
				<SettingRow label="Your draft" value="Replaced" />
				<SettingRow label="The published page at /donate" value="Replaced" />
			</div>
			<p className="adm-prose">This can’t be undone.</p>
			<Refusal id={refusalId} text={refusal} />
		</Modal>
	);
}

type DiscardConfirmProps = {
	readonly discarding: boolean;
	readonly onDiscard: () => void;
	readonly onCancel: () => void;
	readonly refusal?: string | null | undefined;
};

/** Discard changes: the draft goes back to what is live. */
export function DiscardConfirm({ discarding, onDiscard, onCancel, refusal }: DiscardConfirmProps) {
	const refusalId = useId();
	return (
		<Modal
			title="Discard changes?"
			danger="Discard changes"
			dangerProps={held(discarding, onDiscard, refusal ? refusalId : undefined)}
			cancel="Cancel"
			cancelProps={{ type: 'button', onClick: onCancel }}
			onDismiss={onCancel}
		>
			<div>
				<SettingRow label="Your draft" value="Back to the live page" />
			</div>
			<Refusal id={refusalId} text={refusal} />
		</Modal>
	);
}
