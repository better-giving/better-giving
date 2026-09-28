import { Button } from '@better-giving/operator/components/controls/Button';
import { Sheet } from '@better-giving/operator/components/shell/Sheet';
import { StatusWord } from '@better-giving/operator/components/status/StatusWord';
import {
	type ComponentPropsWithoutRef,
	type ReactNode,
	type RefObject,
	useEffect,
	type SubmitEvent,
	useId
} from 'react';

// the editor's sheets have no Save. a picture or a look control applies the moment it is picked; a
// sheet of typed values has one Done, which applies what it holds to the draft, and the caller
// closes the sheet when the apply lands. nothing a sheet applies reaches donors until Publish. the
// one sheet that keeps Save is a campaign's address (./address-sheet.tsx), because an address takes
// effect at once rather than at Publish.
//
// the form holds the sheet's boxes and nothing else, and Done in the foot is its submit through the
// `form` attribute, so Enter in a box presses Done — as long as no submit button sits inside the
// form ahead of it, because the platform's default button is the first in tree order (a row
// editor's Add and Remove answer that in ../forms/giving-fields.tsx). what is handed in as `lead`
// stands in the body above the form and outside it — a block's variant pictures, which apply on
// pick and are never posted with the words. the form draws no box of its own (`.adm-sheet__form`),
// so its boxes are spaced as the body's own parts.
//
// the sheet reads its form one of two ways. handed `onDone`, it keeps the submit and passes the
// form over. handed `formProps` — a form library's own (conform's `getFormProps`, with its id and
// `onSubmit`) — that form *is* the sheet's, and Done submits it natively: the library's list
// presses and its validation run in its own `onSubmit`, and where the submit goes is that
// `onSubmit`'s to say.
//
// Done holds its focus while its apply is in flight — `aria-disabled` and the press turned away,
// never `disabled`, which would drop the caret on the document. a refusal no box carries — the draft
// changed under the sheet, say — is drawn at Done, in a region that is there before it speaks.

/** a form the caller's own library states, spread whole onto the sheet's `<form>`. */
type SheetFormProps = Omit<ComponentPropsWithoutRef<'form'>, 'id' | 'className' | 'children'> & {
	readonly id: string;
};

/** who submits: the sheet, handing the form to `onDone`, or the form's own `onSubmit`. */
type Submits =
	| {
			/** Done was pressed, or Enter in a box, and no apply is in flight. */
			readonly onDone: (form: HTMLFormElement) => void;
			/** the form's id, for a caller whose form library names it. */
			readonly formId?: string | undefined;
			readonly formProps?: undefined;
	  }
	| {
			/** the form Done submits; its `onSubmit` runs only while no apply is in flight. */
			readonly formProps: SheetFormProps;
			readonly onDone?: undefined;
			readonly formId?: undefined;
	  };

type DoneSheetProps = Submits & {
	readonly title: string;
	/** what stands above the boxes and is not posted with them. */
	readonly lead?: ReactNode;
	/** the boxes Done applies. */
	readonly children: ReactNode;
	/** X or Escape. */
	readonly onDismiss: () => void;
	/** Done's apply is in flight. */
	readonly applying: boolean;
	/** the refusal of the last apply that no box carries. */
	readonly refusal?: string | null | undefined;
	/** another press in the foot, before Done. */
	readonly aside?: ReactNode;
	readonly stacked?: boolean;
	readonly wide?: boolean;
	readonly tall?: boolean;
};

export function DoneSheet({
	title,
	lead,
	children,
	onDismiss,
	onDone,
	formProps,
	applying,
	refusal,
	aside,
	formId,
	stacked = false,
	wide = false,
	tall = false
}: DoneSheetProps) {
	const minted = useId();
	const form = formProps?.id ?? formId ?? `${minted}-form`;
	const refusalId = `${minted}-refusal`;
	const submit = (event: SubmitEvent<HTMLFormElement>) => {
		if (applying) {
			event.preventDefault();
			return;
		}
		if (formProps) {
			formProps.onSubmit?.(event);
			return;
		}
		event.preventDefault();
		onDone(event.currentTarget);
	};
	return (
		<Sheet
			title={title}
			onDismiss={onDismiss}
			stacked={stacked}
			wide={wide}
			tall={tall}
			foot={
				<>
					<p id={refusalId} role="status">
						{refusal ? (
							<StatusWord register="momentary" blocked mark="circle-alert">
								{refusal}
							</StatusWord>
						) : null}
					</p>
					{aside}
					<Button
						type="submit"
						form={form}
						variant="primary"
						aria-busy={applying}
						aria-disabled={applying || undefined}
						aria-describedby={refusal ? refusalId : undefined}
					>
						Done
					</Button>
				</>
			}
		>
			{lead}
			<form noValidate {...formProps} id={form} className="adm-sheet__form" onSubmit={submit}>
				{children}
			</form>
		</Sheet>
	);
}

/**
 * the box a refusal names takes the focus on the render the refusal arrives in, and on no other:
 * keyed to the message changing, so a sheet redrawn under a standing refusal leaves the caret where
 * the reader put it. the box is a ref, or the id a control that holds no ref of its own is found by.
 */
export function useFocusOnRefusal(
	message: string | null | undefined,
	box: RefObject<HTMLElement | null> | string
): void {
	useEffect(() => {
		if (!message) return;
		const target = typeof box === 'string' ? document.getElementById(box) : box.current;
		target?.focus();
	}, [message, box]);
}
