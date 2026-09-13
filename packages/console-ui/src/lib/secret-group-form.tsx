import { Button } from '@better-giving/operator/components/controls/Button';
import { SaveButton } from '@better-giving/operator/components/controls/SaveButton';
import { SettingRow } from '@better-giving/operator/components/data/SettingRow';
import { Field } from '@better-giving/operator/components/forms/Field';
import { useSavedFormState } from '@better-giving/operator/saved-form-state.react';
import type { FormEvent, ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { Form } from 'react-router';
import type { ValuesRefusal, VarsWritten } from '../api/types';
import type { HeldValues } from './held-values';
import { withheldInGroup } from './held-values';
import { refusalIn } from './secret-trouble';
import type { SecretGroup } from './secret-groups';
import { VALUE_FIELD, groupIntent, isMasked, typedNames } from './secret-groups';
import { WithheldValues } from './withheld-values';

// one group of credentials, drawn wherever the act it belongs to is carried out.
//
// it is here rather than beside one screen because more than one draws it: a group is the unit an
// operator commits (./secret-groups.ts), so the screen that owns an act owns the group whose names
// that act needs — and a second copy of this is how two of them come to disagree about what an
// emptied box means.
//
// **it draws no band of its own.** what names the block is the caller's: a screen holding one group
// names it in its own heading, and a screen holding several bands each of them. a band written here
// would be a second name over the first wherever there is only one.
//
// **it mounts no form layer, because nothing about a credential is decidable in the browser.** what
// a value may be is the deployment's, and the one rule anything here states about one — the
// dashboard password's length (`readAdminPassword` in packages/operator/src/admin-password.ts) — is
// read at the press by ./secret-edits.ts, over the act the boxes add up to rather than over a box:
// an empty box is a removal where the deployment holds a value and nothing at all where it does
// not. so this form goes through no schema and through no seam, and what it takes is the save-state
// half alone (`@better-giving/operator/saved-form-state.react`).
//
// **what that leaves this component holding is the answer's own refusal**, keyed by the name of the
// box at fault. it stands under the box it names until the next answer, because it is about a value
// the deployment turned down and nothing on this page can re-derive it. two things hang off that
// and both are below: the operator is put in the first box named when the answer arrives, and a
// press over a box still holding exactly what was turned down never starts.

/** what the last press did to one group, as a screen reads it back. */
export type GroupReport =
	/** the boxes came back refused, keyed by the name of the box at fault. */
	{ group: string; errors: Record<string, string> } | { group: string; written: VarsWritten };

/** the id the box for one credential carries. */
export const secretBox = (name: string): string => `set-${name}`;

/** no box named, as one value: a new empty array every render would be a new state every render. */
const NONE: readonly string[] = [];

/**
 * one group of credentials: what the deployment holds in each slot, the boxes it opens onto, and
 * the save that reports itself.
 *
 * a component of its own because each group keeps three things a group beside it must not see — the
 * flag saying whether there is anything in it to save, the form element a landed save empties, and
 * whether its boxes are open.
 */
export function SecretGroupForm({
	group,
	values,
	report,
	busy,
	pending,
	revalidating,
	trouble,
	note,
	consequence,
	startOpen = false,
	rows = true,
	boxLabel = (name) => `New value for ${name}`,
	boxHint,
	withheldSays,
	withheldWritten = null,
	freeing = false,
	generated = []
}: {
	group: SecretGroup;
	/**
	 * what Cloudflare said this deployment is holding: what each box is drawn with, and what each
	 * row reads back (`heldValues` in ./held-values.ts).
	 */
	values: HeldValues;
	report: GroupReport | null;
	/** something else on the screen is writing, which holds every control on it closed. */
	busy: boolean;
	pending: boolean;
	/**
	 * the router is re-reading the page, which is the half of a press where the answer has already
	 * landed and the one thing `pending` cannot say. what this form reads off it is {@link closed}.
	 */
	revalidating: boolean;
	/** what a failed write says, in the words the screen holding the account name has for it. */
	trouble: (written: ValuesRefusal) => ReactNode;
	/** what this group says beyond its rows, where storing here is less than the errand it belongs to. */
	note?: ReactNode;
	/**
	 * what storing this costs, drawn between the boxes and the save.
	 *
	 * it differs from {@link note} in where it stands and therefore in what it may say. `note` is
	 * over the rows and reads as an introduction to the group — what an operator meets before they
	 * have decided to change anything. this stands beside the press whose damage it describes, which
	 * is where a consequence is read: the last thing before the button, by somebody who has already
	 * typed.
	 */
	consequence?: ReactNode;
	/**
	 * the boxes are already open, and no control to open them is drawn at all.
	 *
	 * the closed state is for a group standing among other things: what an operator opened the fold
	 * for may be nothing to do with these boxes, and the shut state is what keeps the act one press
	 * away rather than always underfoot. a group that is the whole of what its fold holds has none
	 * of that — there is nothing else in there to have come for, so whatever opened it was opened
	 * over this one act and a second press is friction. ./password-fold.tsx is the one that turns
	 * this on, and its header says why.
	 */
	startOpen?: boolean;
	/**
	 * whether the group states its slots: one row per name in it, saying whether the deployment is
	 * holding that name. on wherever the names are values an operator supplied and can check them
	 * against, and off where they are this console's own machinery — ./password-fold.tsx is the
	 * one that turns it off, and its header says why.
	 */
	rows?: boolean;
	/**
	 * what the box for one name is labelled, where the name itself is not what to put in front of an
	 * operator. the same question {@link rows} answers for the group, asked of the one box that is
	 * left when the rows are off.
	 *
	 * it is the box's whole accessible name and is reached without the heading over it, so what it
	 * returns has to say which credential it is for on its own.
	 *
	 * **the default names the variable, and every caller so far states something else.** it is the
	 * default because this component is handed a group out of an enumeration and knows nothing about
	 * what the names in it mean, and the variable name is the one thing that is certainly true of a
	 * box — a group added to ./secret-groups.ts draws boxes an operator can at least match against
	 * their deployment rather than boxes labelled by a guess. it is not what a screen should ship
	 * with: a fundraiser meeting `SMTP_PASSWORD` has to work out that it is the password from their
	 * mail provider, and the fold that knows which credential it is asking for can say so. so a
	 * screen states its own — ./password-fold.tsx does, and ./smtp-fold.tsx and ./stripe-section.tsx
	 * draw their boxes by hand under the same rule.
	 */
	boxLabel?: (name: string) => string;
	/**
	 * what the box for one name says about what it will take, over the box rather than under it.
	 *
	 * a rule the deployment states about a value is one an operator has to be able to meet on the
	 * first press, and `readAdminPassword` in packages/operator/src/admin-password.ts argues what a
	 * group that only answers afterwards costs. `undefined` is a name the deployment states no rule
	 * about, which is most of them — a hint over a box that takes anything is a line saying nothing.
	 *
	 * the fold states it for the same reason it states {@link boxLabel}: this component is handed a
	 * group out of an enumeration and knows nothing about what the names in it mean.
	 * ./password-fold.tsx is the one that has a rule to state.
	 */
	boxHint?: (name: string) => ReactNode;
	/**
	 * the names in this group the console mints for itself and never takes a value for. they get no
	 * box at all: one whose only correct answer is a random string is one an operator fills with a
	 * word they can remember. whether the name is stated at all is {@link rows}'s and a separate
	 * question.
	 * `packages/console/internal/first` argues it for `BETTER_AUTH_SECRET`, which is the one it names.
	 *
	 * it cannot cover every name in a group — a group with nothing to type is a group with no act in
	 * it — so the block draws no control at all rather than one that opens nothing.
	 */
	generated?: readonly string[];
	/**
	 * what this deployment stops doing between freeing a value held in a form nothing can read back
	 * and the next save, in the fold's own words. `undefined` draws no such block at all, which is
	 * a fold that would have nothing true to put in one.
	 */
	withheldSays?: ReactNode;
	/** how the last press that frees those values went, or `null` (./withheld-values.tsx). */
	withheldWritten?: VarsWritten | null;
	/** the press that frees those values is the one in flight (./withheld-values.tsx). */
	freeing?: boolean;
}) {
	const errors = report !== null && 'errors' in report ? report.errors : null;
	const written = report !== null && 'written' in report ? report.written : null;
	/* the failure inside that answer, or nothing: four of the write's arms are not one, and
	   `withheld` is drawn at the box it is about rather than under the press (./secret-trouble.ts). */
	const failure = written === null ? null : refusalIn(written);
	/* the names this block is an act over — the group less whatever this console mints for itself.
	   every count and every label below reads off this rather than off the group. */
	const typed = typedNames(group, generated);
	const firstTyped = typed[0];
	/* the boxes this group's last answer named, and which of them the operator has since typed in.
	   state rather than a ref because the press is drawn from it: a box put right is a box the press
	   is no longer held back over, and one that only lifted at the next press would be a correction
	   an operator makes and is then refused for. */
	const [fixed, setFixed] = useState<readonly string[]>(NONE);
	/* the boxes closed, which is not the reading either flag the page hands down takes on its own.
	   a press is two router phases and the answer lands between them (./stripe-press.ts), so `busy`
	   and `pending` alike stay true for the whole of the re-read this group's own press sets off —
	   and that re-read is every reading of the deployment, which takes seconds. a press that was
	   turned down began nothing and what has to change is a box, so those are seconds an operator
	   would spend in front of a sentence about a box they cannot edit. what is left closing them is
	   the request carrying them being in flight, and another press on the page writing.

	   it is also the whole of why the answer can place focus at all: a disabled box takes none, and
	   the move below runs on the render the answer arrives in. */
	const closed = pending ? !revalidating : busy;
	const named = errors === null ? NONE : Object.keys(errors);
	const unfixed = fixed.length === 0 ? named : named.filter((name) => !fixed.includes(name));

	const { form, state, onInput, onSubmit, reset } = useSavedFormState({
		report,
		landed: written?.kind === 'set',
		busy,
		pending,
		/* every box over a stored value arrives full, so what counts as an edit is a box differing
		   from the mark it was drawn with rather than a box holding anything. this block mounts no
		   form layer, so the reading is taken off the element at every keystroke — the folds that
		   mount one hand the answer over instead (`SavedFormInputs.changed` in
		   packages/operator/src/saved-form-state.react.ts). */
		changed: (element) =>
			typed.some((name) => {
				const box = element.elements.namedItem(VALUE_FIELD(name));
				const value = box instanceof HTMLInputElement ? box.value : '';
				return value !== (values.seeds[name] ?? '');
			}),
		/* a box still holding exactly what the answer turned down is a press whose outcome is already
		   on the screen, so nothing starts at all: no run is made, the button never draws `Saving`
		   over it, and the operator is put back in the first box named — a press answered by nothing
		   moving is one they make again. */
		press: () => {
			const first = unfixed[0];
			if (first === undefined) return true;
			document.getElementById(secretBox(first))?.focus();
			return false;
		}
	});

	/* the operator left standing in the first box the answer named, which is where the sentence about
	   it is. the answer itself is a dependency beside the names so that a second refusal over the
	   same box moves focus again: the press before it left focus on the button, and a run keyed on
	   the names alone would leave it there with the sentence elsewhere on the screen. the names are
	   the variable names a group is made of and hold no spaces, so one string stands for the set —
	   `errors` is built at every render, and a run keyed on the object would pull focus back out of
	   wherever the operator had moved it on every keystroke. */
	const refused = named.join(' ');
	useEffect(() => {
		setFixed(NONE);
		const first = refused === '' ? undefined : refused.split(' ')[0];
		if (first !== undefined) document.getElementById(secretBox(first))?.focus();
	}, [report, refused]);

	/* every keystroke, and the one box it was made in: what that box holds now is not what was turned
	   down, so the press over it is the deployment's to answer again. compared by the id the answer
	   is found through rather than by the box's `name`, which carries the field's own shape. */
	const typedInto = (event: FormEvent<HTMLFormElement>) => {
		const box = event.target;
		const put =
			box instanceof HTMLElement ? unfixed.find((name) => secretBox(name) === box.id) : undefined;
		if (put !== undefined) setFixed([...fixed, put]);
		onInput();
	};

	// shut until Change, and open on this group's own answer whatever it says: a refusal names a box
	// and leaves the operator standing in it (the effect above), which is nowhere at all while the
	// boxes are not on the screen, and a landed save reports at the button that carried it.
	const [opened, setOpened] = useState(false);
	const open = startOpen || opened || report !== null;

	// the control that was pressed is replaced by the boxes it opened, so the operator is left in the
	// first of them rather than at the top of a group that changed shape under them. it runs on the
	// press alone: a group opened by its own answer is one the refusal above has already placed focus
	// in, and a group that starts open has no press of its own to follow — what was pressed there is
	// the fold, and focus belongs on the control that opened it.
	useEffect(() => {
		if (!opened) return;
		if (firstTyped !== undefined) document.getElementById(secretBox(firstTyped))?.focus();
	}, [opened, firstTyped]);

	/* a group put away is a group at rest: the boxes shut again and whatever was typed into them
	   gone. a box left holding a credential behind something closed is one the next press on it
	   hands back in the clear, and a block whose act has been opened once has no other way back to
	   the shape an operator meets it in.

	   what closes over this group is the fold it stands in, and a fold is a `details` that stays
	   mounted however it is standing (packages/operator/src/components/status/StatusLine.jsx) —
	   nothing is unmounted and nothing resets itself, so shutting one is this block's own to answer.
	   it is answered for a group that starts open as well: `opened` is already false there, and what
	   the shut is for is `reset` — the boxes are on screen the moment the fold is, so what was typed
	   into them has to go when it closes. the element is found rather than handed down: what shuts
	   is several components above this one, and a flag threaded through each of them would be a prop
	   every fold states and nothing else reads. */
	useEffect(() => {
		const fold = form.current === null ? null : form.current.closest('details');
		if (fold === null) return;
		const shut = () => {
			if (fold.open) return;
			setOpened(false);
			reset();
		};
		fold.addEventListener('toggle', shut);
		return () => fold.removeEventListener('toggle', shut);
	}, [form, reset]);

	return (
		<Form
			className="adm-stack"
			method="post"
			preventScrollReset
			ref={form}
			onInput={typedInto}
			onSubmit={onSubmit}
		>
			{rows ? (
				<div>
					{/* the name and what is in the slot, in the row every other value on this screen is
					    read in. wherever an operator supplied the names, the rows are what the group is
					    for and the boxes below are the change. */}
					{group.names.map((name) => (
						<SettingRow
							key={name}
							label={name}
							reading={values.held.has(name) ? 'stored' : 'unset'}
						/>
					))}
				</div>
			) : null}

			{note}

			{firstTyped === undefined ? null : open ? (
				<>
					{/* the boxes stand away from the rows they change, so each one carries the name it
					    is for rather than borrowing the row above it. two names side by side at the
					    reading width and stacked below it — the pair is one decision either way, since
					    one press stores both. */}
					<div
						className={['adm-pair', typed.length > 1 ? 'adm-pair--side' : '']
							.filter(Boolean)
							.join(' ')}
					>
						{typed.map((name) => (
							<div key={name}>
								<Field
									id={secretBox(name)}
									name={VALUE_FIELD(name)}
									label={boxLabel(name)}
									hint={boxHint?.(name)}
									// the code face. these are literals an operator checks character for
									// character against another screen.
									code
									// which of the names in a group arrives masked is ./secret-groups.ts's.
									masked={isMasked(name)}
									autoComplete="off"
									spellCheck={false}
									// what the deployment is holding under this name, so a box nobody edits is
									// a box that asks for nothing (./secret-edits.ts).
									defaultValue={values.seeds[name] ?? ''}
									// closed while the press that reads them is in flight, and while another press
									// on the page writes ({@link closed}): the press reads these boxes once, and a
									// value typed into one behind it is a credential the operator believes they
									// stored.
									disabled={closed}
									error={errors?.[name]}
								/>
							</div>
						))}
					</div>

					{/* the names of this group the deployment holds in a form nothing can read back, which
					    are the boxes drawn empty over a value that is there and every name in the group
					    that has no box at all. a fold with nothing true to say about what freeing them
					    costs states none and this draws nothing. */}
					{withheldSays === undefined ? null : (
						<WithheldValues
							names={withheldInGroup(values, group)}
							all={values.withheld}
							consequence={withheldSays}
							written={withheldWritten}
							trouble={trouble}
							busy={busy}
							freeing={freeing}
						/>
					)}

					{consequence}

					<div className="adm-actions">
						{/* the three words are the button's own defaults
						    (`@better-giving/operator/components/controls/SaveButton`): the fold this press
						    stands in already names what is being saved, so a label saying it again is the
						    card's own row read twice — and one word covers a group of one and a group of
						    five alike. */}
						<SaveButton name="intent" value={groupIntent(group)} state={state} />
						{pending ? (
							// said at the control while it waits, because this press takes seconds where a save
							// usually takes a moment. what it says is where the value is going and how long, and
							// never what Cloudflare is doing to get it there — an operator waiting cannot act on
							// the mechanism and every other wait on this console is worded the same way.
							<p className="adm-hint">Storing it on your deployment. A few seconds.</p>
						) : null}
					</div>
				</>
			) : (
				<div className="adm-actions">
					{/* `type="button"` because it stands inside the form it opens: a press that
					    submitted would post a group with nothing typed in it. */}
					<Button
						type="button"
						variant="quiet"
						size="sm"
						mark="pencil"
						disabled={busy}
						onClick={() => setOpened(true)}
					>
						{typed.length === 1 ? 'Change this' : 'Change these'}
					</Button>
				</div>
			)}

			{failure === null ? null : trouble(failure)}
		</Form>
	);
}
