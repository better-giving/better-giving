import { SaveButton } from '@better-giving/operator/components/controls/SaveButton';
import { Sheet } from '@better-giving/operator/components/shell/Sheet';
import { StatusWord } from '@better-giving/operator/components/status/StatusWord';
import { type FormEvent, type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { AffixedField } from './affixed-field';
import { useFocusOnRefusal } from './done-sheet';

// a campaign's address — the one sheet in the editor that keeps Save rather than Done, because an
// address is not page content: it takes effect the moment it is saved, not at Publish. whether a
// change asks first (a published campaign's old address stops answering; an ended campaign's
// address is taken over) is the caller's, which puts its confirm up over this sheet.
//
// the host stands on the box in front of what is typed, so the box holds the part an operator
// writes and nothing else.
//
// a refusal that is not about the address — the campaign changed under the sheet, the save did not
// land — is drawn at Save, in a region that is there before it speaks, and Save takes the focus
// when it arrives, as ./done-sheet.tsx draws one at Done.

type AddressSheetProps = {
	/** where every address on this deployment starts — `give.riverbanktrust.org/`. */
	readonly host: string;
	/** the campaign's address as stored, without the host. */
	readonly slug: string;
	/** a changed, non-empty address, trimmed. */
	readonly onSave: (slug: string) => void;
	/** the save is in flight. */
	readonly saving: boolean;
	/** the last save landed and nothing has been typed since. */
	readonly saved: boolean;
	/** the predicate the last save refused the address with. */
	readonly error?: string | null | undefined;
	/** the last save's refusal that is not about the address itself. */
	readonly refusal?: ReactNode;
	readonly onDismiss: () => void;
};

export function AddressSheet({
	host,
	slug,
	onSave,
	saving,
	saved,
	error,
	refusal,
	onDismiss
}: AddressSheetProps) {
	const id = useId();
	const form = `${id}-form`;
	const refusalId = `${id}-refusal`;
	const saveId = `${id}-save`;
	const box = useRef<HTMLInputElement>(null);
	const region = useRef<HTMLParagraphElement>(null);
	// keyed to the words the region holds rather than to `refusal`, whose identity a caller's
	// re-render renews: Save takes the focus when a refusal lands or changes, never on a redraw.
	const refusalSaid = useRef('');
	const [text, setText] = useState(slug);
	// the predicate a Save found the box empty with, until something is typed.
	const [empty, setEmpty] = useState(false);
	useFocusOnRefusal(error, box);
	useEffect(() => {
		const said = region.current?.textContent ?? '';
		if (said !== '' && said !== refusalSaid.current) document.getElementById(saveId)?.focus();
		refusalSaid.current = said;
	});

	const unchanged = text.trim() === slug;
	const submit = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (saving || unchanged) return;
		const trimmed = text.trim();
		if (trimmed === '') {
			setEmpty(true);
			box.current?.focus();
			return;
		}
		onSave(trimmed);
	};

	return (
		<Sheet
			title="Address"
			onDismiss={onDismiss}
			foot={
				<>
					<p id={refusalId} role="status" ref={region}>
						{refusal ? (
							<StatusWord register="momentary" blocked mark="circle-alert">
								{refusal}
							</StatusWord>
						) : null}
					</p>
					<SaveButton
						id={saveId}
						form={form}
						label="Save address"
						doneLabel="Saved"
						state={
							saving ? 'pending' : saved && unchanged ? 'done' : unchanged ? 'disabled' : 'idle'
						}
						aria-describedby={refusal ? refusalId : undefined}
					/>
				</>
			}
		>
			<form id={form} className="adm-sheet__form" noValidate onSubmit={submit}>
				<AffixedField
					id={id}
					label="Address"
					affix={host}
					affixAt="start"
					inputRef={box}
					value={text}
					onValueChange={(next) => {
						setText(next);
						if (empty && next.trim() !== '') setEmpty(false);
					}}
					error={empty ? 'required' : error}
				/>
			</form>
		</Sheet>
	);
}
