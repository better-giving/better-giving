import { SaveButton } from '@better-giving/operator/components/controls/SaveButton';
import { Section } from '@better-giving/operator/components/shell/Layout';
import { Banner } from '@better-giving/operator/components/status/Banner';
import { MarkedText } from '@better-giving/operator/marked-text.react';
import { useSaveState } from '@better-giving/operator/save-state.react';
import type { getFormProps } from '@conform-to/react';
import { type ReactNode, type SubmitEvent, useState } from 'react';
import { Form, useActionData, useFormAction, useNavigation } from 'react-router';
import { buttonState } from '../save-button-state';
import { useReportChanged } from './edit-tabs';
import { type AdminActionData, recordVersion, resultFor, whichForm } from '../use-admin-form';
import { WHICH_FORM } from '$lib/forms/definition';

// one section card on a page's edit screen: its own `<form>`, its heading, its boxes, and its own
// Save at its foot. every card posts to the screen's one action under its form id
// ($lib/page/edit-forms.ts), against the version the screen was drawn at, and the save writes the
// draft alone ($lib/server/pages/section-saves.ts).
//
// the Save is offered only while the card holds something its save would write (`changed`, read by
// the card as the save stores each box, ./changed.ts) and nothing holds it (`held`: a photo still
// uploading). beside an offered Save stands "Unsaved changes". while any write from the screen is
// in flight every card's Save is held: the version each card carries is the page's, so a second
// press before the first lands would carry the version the first moved past and be refused.
//
// a card standing in a tab tells it whether it holds unsaved edits, which draws the tab's dot.
//
// a save that landed answers `{ saved: <form id> }`, which draws the tick on this card's Save alone.
// the Save's name carries the card's — "Save general" — in words a reader hears and the eye skips,
// so the name always holds what the button shows.

/** what a landed save says: it is saved, and reaches donors at Publish. */
export const PUBLISH_NOTE = 'Saved. Donors see your changes once you publish.';

/** the screen's writes as the cards read them: whether one is in flight, and which form posted it. */
export function useScreenWrite() {
	const navigation = useNavigation();
	const here = useFormAction();
	const writing = navigation.state !== 'idle' && navigation.formAction === here;
	const posted = writing ? navigation.formData?.get(WHICH_FORM) : null;
	return { writing, posted: typeof posted === 'string' ? posted : null };
}

/** the answer the screen's action came back with. */
export function useScreenAnswer(): AdminActionData {
	return useActionData() as AdminActionData;
}

/** the last answer's refusal of `form` that no box carries, or null. */
export function formRefusal(form: { readonly id: string }, answer: AdminActionData) {
	return resultFor(form, answer)?.error?.['']?.at(-1) ?? null;
}

/**
 * state seeded from `seed` and put back on it whenever the seed changes, which is what a landed
 * save's revalidation brings. a card whose seed did not move keeps what is typed in it.
 */
export function useSeeded<T>(seed: unknown, init: () => T): [T, (next: T) => void] {
	const key = JSON.stringify(seed);
	const [held, setHeld] = useState(() => ({ key, value: init() }));
	if (held.key !== key) {
		const next = { key, value: init() };
		setHeld(next);
		return [next.value, (value) => setHeld({ key, value })];
	}
	return [held.value, (value) => setHeld({ key, value })];
}

type SectionCardProps = {
	/** conform's form props (`getFormProps`), for the form the card mounted through `useAdminForm`. */
	readonly form: ReturnType<typeof getFormProps>;
	readonly title: string;
	/** the title is read and not drawn: a tab already names the card on the screen (./edit-tabs.tsx). */
	readonly titleHidden?: boolean | undefined;
	/** the word the Save is named by: "general" names it "Save general". */
	readonly saveName: string;
	/** the page's version the screen was drawn at. */
	readonly version: number;
	/** the card holds something its save would write. */
	readonly changed: boolean;
	/** something the card waits on before it may save — a photo uploading. */
	readonly held?: boolean | undefined;
	/**
	 * what the confirmation says after "Saved" about the rest of the page. the default is true of
	 * every card's save: it is in the draft, and donors see it at Publish.
	 */
	readonly saved?: string | undefined;
	/** run before conform's pass, with the form about to post: the end date's time zone. */
	readonly beforeSubmit?: ((form: HTMLFormElement) => void) | undefined;
	readonly hint?: ReactNode;
	readonly children: ReactNode;
};

export function SectionCard({
	form,
	title,
	titleHidden = false,
	saveName,
	version,
	changed,
	held = false,
	beforeSubmit,
	saved = PUBLISH_NOTE,
	hint,
	children
}: SectionCardProps) {
	const { writing, posted } = useScreenWrite();
	const answer = useScreenAnswer();
	const pending = posted === form.id;
	const save = useSaveState({
		landed: answer?.saved === form.id,
		changed: changed && !held,
		pending
	});
	const state = buttonState(save);
	useReportChanged(changed);
	const refusal = formRefusal(form, answer);
	const submit = (event: SubmitEvent<HTMLFormElement>) => {
		beforeSubmit?.(event.currentTarget);
		form.onSubmit(event);
	};

	return (
		<Form method="post" {...form} onSubmit={submit}>
			<input {...whichForm(form.id)} />
			<input {...recordVersion(version)} />
			<Section card>
				<h2 className={titleHidden ? 'adm-vh' : undefined}>{title}</h2>
				{hint ? <p className="adm-hint">{hint}</p> : null}
				{children}
				{refusal === null ? null : (
					<Banner tone="blocker" word="Not saved">
						<MarkedText text={refusal} />
					</Banner>
				)}
				<div className="adm-actions">
					<SaveButton
						label={
							<>
								Save<span className="adm-vh"> {saveName}</span>
							</>
						}
						doneLabel={
							<>
								Saved<span className="adm-vh"> {saveName}</span>
							</>
						}
						elsewhere={saved}
						state={state}
						disabled={writing && !pending}
					/>
					{state === 'idle' ? <p className="adm-hint">Unsaved changes</p> : null}
					{state === 'done' ? <p className="adm-hint">{saved}</p> : null}
				</div>
			</Section>
		</Form>
	);
}
