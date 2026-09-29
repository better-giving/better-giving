import { Modal } from '@better-giving/operator/behaviour/Dialog';
import { SettingRow } from '@better-giving/operator/components/data/SettingRow';
import { Field } from '@better-giving/operator/components/forms/Field';
import { SelectWithNote } from '@better-giving/operator/components/forms/SelectWithNote';
import { StatedValue } from '@better-giving/operator/components/forms/StatedValue';
import { StatusWord } from '@better-giving/operator/components/status/StatusWord';
import { useId, useState } from 'react';

// the editor's questions, each a card over the editor that the caller puts up and takes down.
//
// two arrangements, by what the press costs: Reset to default and Discard changes destroy work and
// are the danger card, listing only what the press replaces; a campaign's first Publish and the
// mission ask destroy nothing and are the commit card. the act stands first in both, and Escape or
// a press on the ground is the way out the card names.
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
				<SettingRow label="This page’s chat" value="Cleared" />
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

/** Discard changes: the draft goes back to what is live, and the chat with it. */
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
				<SettingRow label="This page’s chat" value="Cleared" />
			</div>
			<Refusal id={refusalId} text={refusal} />
		</Modal>
	);
}

type FirstPublishConfirmProps = {
	/** the campaign's name, which the question is asked about. */
	readonly name: string;
	/** where a gift may go: the active programs, as the caller words them. */
	readonly programs: readonly { readonly value: string; readonly label: string }[];
	/** the program the draft's donation settings give gifts to now. */
	readonly program: string;
	/** the address the campaign will take, as a path. */
	readonly address: string;
	/** the address the campaign asked for, where it was taken and `address` is the next free one. */
	readonly asked?: string | undefined;
	readonly publishing: boolean;
	/** Publish, with the program chosen here. */
	readonly onPublish: (program: string) => void;
	readonly onCancel: () => void;
	readonly refusal?: string | null | undefined;
};

/** a campaign's first Publish: where its gifts go, changeable here, and the address it takes. */
export function FirstPublishConfirm({
	name,
	programs,
	program,
	address,
	asked,
	publishing,
	onPublish,
	onCancel,
	refusal
}: FirstPublishConfirmProps) {
	const id = useId();
	const refusalId = `${id}-refusal`;
	const [chosen, setChosen] = useState(program);
	return (
		<Modal
			title={`Publish ${name}?`}
			commit="Publish"
			commitProps={held(publishing, () => onPublish(chosen), refusal ? refusalId : undefined)}
			cancel="Cancel"
			cancelProps={{ type: 'button', onClick: onCancel }}
			onDismiss={onCancel}
		>
			<SelectWithNote
				id={`${id}-program`}
				label="Gifts go to"
				options={programs}
				value={chosen}
				onValueChange={setChosen}
			/>
			<div className="adm-stack adm-stack--tight">
				<StatedValue label="Address" value={address} code />
				{asked ? (
					<p className="adm-hint">
						The address {asked} is taken, so this campaign takes the next free one.
					</p>
				) : null}
			</div>
			<Refusal id={refusalId} text={refusal} />
		</Modal>
	);
}

type MissionAskProps = {
	readonly saving: boolean;
	/** the mission as typed, trimmed; `''` when Save was pressed on an empty box. */
	readonly onSave: (mission: string) => void;
	/** Skip, Escape or a press on the ground: the ask is not made again. */
	readonly onSkip: () => void;
	readonly refusal?: string | null | undefined;
};

/**
 * the Donation page editor's first visit while the Organisation's mission is empty: asked once,
 * optional, saved verbatim to the Organisation page. every way out of the card is Skip.
 */
export function MissionAsk({ saving, onSave, onSkip, refusal }: MissionAskProps) {
	const id = useId();
	const refusalId = `${id}-refusal`;
	const [mission, setMission] = useState('');
	return (
		<Modal
			title="What’s your mission?"
			commit="Save"
			commitProps={held(saving, () => onSave(mission.trim()), refusal ? refusalId : undefined)}
			cancel="Skip"
			cancelProps={{ type: 'button', onClick: onSkip }}
			onDismiss={onSkip}
		>
			<Field
				id={`${id}-mission`}
				label="Mission"
				optional
				as="textarea"
				rows={4}
				hint="Saved to your Organisation page. Every page’s About us uses it."
				value={mission}
				onChange={(event) => setMission(event.target.value)}
			/>
			<Refusal id={refusalId} text={refusal} />
		</Modal>
	);
}
