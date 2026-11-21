import { Button } from '@better-giving/operator/components/controls/Button';
import { Field } from '@better-giving/operator/components/forms/Field';
import { FieldMessage } from '@better-giving/operator/components/forms/FieldMessage';
import { Section } from '@better-giving/operator/components/shell/Layout';
import { StatusWord } from '@better-giving/operator/components/status/StatusWord';
import { getFormProps } from '@conform-to/react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { type FetcherWithComponents, useFetcher } from 'react-router';
import { defineForm, type FormRejection } from '$lib/forms/definition';
import {
	DISABLE_RAIL_INPUT,
	IRA_QCD_RAIL_INPUT,
	PLEDGE_RAIL_FORMS,
	STOCK_RAIL_INPUT
} from '$lib/payments/pledge-rail-forms';
import { boxProps, resultFor, useAdminForm, whichForm } from '../use-admin-form';

// the Stocks and IRA (QCD) cards on /admin/payments (../../../routes/_app.admin.payments.tsx, whose
// action answers each press). a rail that is off is one row: its heading and a switch. turning the
// switch on only opens the card; nothing is live until Save lands with every box filled. Disable is
// a plain button posting through its own fetcher, never a submit of the Save form, and it keeps the
// details the rail was saved with; on a card switched on and never saved it closes the card alone.

/** one rail as the loader hands it: whether donors are offered it, and each box's stored value. */
export type PledgeRail<Details> = {
	readonly enabled: boolean;
	readonly details: Details;
};

export type PledgeRailsProps = {
	readonly rails: {
		readonly stock: PledgeRail<{
			readonly brokerage_name: string;
			readonly dtc_number: string;
			readonly account_number: string;
			readonly account_name: string;
		}>;
		readonly ira_qcd: PledgeRail<{
			readonly payee_name: string;
			readonly mailing_address: string;
		}>;
	};
};

/** what a Save or Disable press answers, or the refusal of one that never reached the server. */
type RailAnswer = {
	readonly form?: FormRejection;
	readonly pledgeRail?: {
		readonly rail: 'stock' | 'ira_qcd';
		readonly outcome: 'saved' | 'disabled';
	};
};

const STOCK_FORM = defineForm({ id: PLEDGE_RAIL_FORMS.stock, schema: STOCK_RAIL_INPUT });
const IRA_QCD_FORM = defineForm({ id: PLEDGE_RAIL_FORMS.iraQcd, schema: IRA_QCD_RAIL_INPUT });
const STOCK_OFF_FORM = defineForm({ id: PLEDGE_RAIL_FORMS.stockOff, schema: DISABLE_RAIL_INPUT });
const IRA_QCD_OFF_FORM = defineForm({
	id: PLEDGE_RAIL_FORMS.iraQcdOff,
	schema: DISABLE_RAIL_INPUT
});

export function PledgeRails({ rails }: PledgeRailsProps) {
	return (
		<>
			<StockRail rail={rails.stock} />
			<IraQcdRail rail={rails.ira_qcd} />
		</>
	);
}

function StockRail({ rail }: { readonly rail: PledgeRailsProps['rails']['stock'] }) {
	const save = useFetcher<RailAnswer>();
	const [form, fields] = useAdminForm(STOCK_FORM, save.data, { defaultValue: rail.details });
	return (
		<RailCard
			heading="Stocks"
			intro="Donors give shares by ticker and are shown where to send them."
			live="You mark each gift received when the shares arrive."
			disable="Disable stocks"
			offForm={STOCK_OFF_FORM}
			enabled={rail.enabled}
			save={save}
			form={getFormProps(form)}
			refusal={form.errors?.[0]}
			firstBox={fields.brokerage_name.id}
		>
			<div className="adm-pair adm-pair--side">
				<Field label="Brokerage name" aria-required {...boxProps(fields.brokerage_name)} />
				<Field label="DTC number" aria-required {...boxProps(fields.dtc_number)} />
			</div>
			<div className="adm-pair adm-pair--side">
				<Field label="Account number" aria-required {...boxProps(fields.account_number)} />
				<Field label="Account name" aria-required {...boxProps(fields.account_name)} />
			</div>
		</RailCard>
	);
}

function IraQcdRail({ rail }: { readonly rail: PledgeRailsProps['rails']['ira_qcd'] }) {
	const save = useFetcher<RailAnswer>();
	const [form, fields] = useAdminForm(IRA_QCD_FORM, save.data, { defaultValue: rail.details });
	return (
		<RailCard
			heading="IRA (QCD)"
			intro="Donors pledge a gift from their IRA and are shown who to make the check out to."
			live="You mark each gift received when the check arrives."
			closing="Only public charities can receive a QCD, not private foundations or supporting organizations."
			disable="Disable IRA (QCD)"
			offForm={IRA_QCD_OFF_FORM}
			enabled={rail.enabled}
			save={save}
			form={getFormProps(form)}
			refusal={form.errors?.[0]}
			firstBox={fields.payee_name.id}
		>
			<div className="adm-pair adm-pair--side">
				<Field label="Payee name" aria-required {...boxProps(fields.payee_name)} />
				<Field
					label="Mailing address"
					as="textarea"
					rows={3}
					aria-required
					{...boxProps(fields.mailing_address)}
				/>
			</div>
		</RailCard>
	);
}

type RailCardProps = {
	readonly heading: string;
	readonly intro: string;
	/** the sentence the intro gains once the rail is live. */
	readonly live: string;
	/** the sentence that ends the intro whether or not the rail is live, after `live` where it shows. */
	readonly closing?: string;
	readonly disable: string;
	/** the Disable press's form, which states no box. */
	readonly offForm: { readonly id: string };
	readonly enabled: boolean;
	readonly save: FetcherWithComponents<RailAnswer>;
	/** conform's form props (`getFormProps`), for the Save form the rail mounted. */
	readonly form: ReturnType<typeof getFormProps>;
	/** the form-level refusal: a press that never reached the server. */
	readonly refusal: string | undefined;
	/** the first box, where focus lands when the switch that opened the card goes. */
	readonly firstBox: string;
	readonly children: ReactNode;
};

function RailCard({
	heading,
	intro,
	live,
	closing,
	disable,
	offForm,
	enabled,
	save,
	form,
	refusal,
	firstBox,
	children
}: RailCardProps) {
	const off = useFetcher<RailAnswer>();
	// the switch is a request to open the card and is never posted: the rail goes live at Save.
	const [turnedOn, setTurnedOn] = useState(false);
	// the answer that may no longer say Saved: one standing over a card reopened after Disable is a
	// claim the rail is live. it returns only with the next answer.
	const [spent, setSpent] = useState<RailAnswer | undefined>(undefined);
	// the boxes as the last Save sent them, and whether they still read so: a Saved standing over a
	// box edited since, during the Save included, is a claim the edit is stored.
	const sent = useRef<Boxes | null>(null);
	// the boxes as the last keystroke or Save left them, read before a reset puts them back.
	const typed = useRef<Boxes | null>(null);
	const [edited, setEdited] = useState(false);
	const headingRef = useRef<HTMLHeadingElement>(null);
	const switchRef = useRef<HTMLInputElement>(null);

	// a Disable in flight collapses the card at once; one refused before reaching the server opens
	// it again over its message, since the rail is still live.
	const expanded = turnedOn || (enabled && off.state === 'idle');
	const answer = save.state === 'idle' ? save.data : undefined;
	const saved = answer?.pledgeRail?.outcome === 'saved' && spent !== answer && !edited;
	const busy = save.state !== 'idle';
	const disableRefused =
		off.state === 'idle' ? resultFor(offForm, off.data)?.error?.['']?.[0] : undefined;

	useFocusWhenGone(!expanded, () => document.getElementById(firstBox));
	useFocusWhenGone(expanded, () => switchRef.current);
	useFocusWhenGone(!saved, () => headingRef.current);

	const headingId = `${form.id}-heading`;
	if (!expanded) {
		return (
			<Section card>
				<div className="ds-switch-field">
					<h2 id={headingId}>{heading}</h2>
					<input
						ref={switchRef}
						type="checkbox"
						// biome-ignore lint/a11y/useAriaPropsForRole: a native checkbox carries its checked state itself, and the registry's switch writes no `aria-checked` (switch-css.usage.md).
						role="switch"
						className="ds-switch"
						aria-labelledby={headingId}
						checked={false}
						onChange={(event) => {
							if (event.currentTarget.checked) setTurnedOn(true);
						}}
					/>
				</div>
				{disableRefused === undefined ? null : <FieldMessage>{disableRefused}</FieldMessage>}
			</Section>
		);
	}

	return (
		<Section card>
			<h2 id={headingId} ref={headingRef} tabIndex={-1}>
				{heading}
			</h2>
			<p className="adm-hint">
				{[intro, enabled ? live : null, closing].filter((sentence) => sentence != null).join(' ')}
			</p>
			<save.Form
				method="post"
				className="adm-stack"
				{...form}
				onSubmit={(event) => {
					form.onSubmit(event);
					// conform's own validation passes are submits it cancels; only one it lets through posts.
					if (event.defaultPrevented) return;
					sent.current = boxesOf(event.currentTarget);
					typed.current = sent.current;
					setEdited(false);
				}}
				onInput={(event) => {
					const now = boxesOf(event.currentTarget);
					typed.current = now;
					setEdited(!sameBoxes(now, sent.current));
				}}
				// a landed Save that moved the record resets the boxes onto it (`useAdminForm`); a box
				// edited since the press is put back as it was typed, and the rest keep the stored value.
				onReset={(event) => {
					const kept = editedSince(typed.current, sent.current);
					typed.current = null;
					setEdited(false);
					if (kept.length === 0) return;
					const saveForm = event.currentTarget;
					// after the reset itself, which a browser runs once this event is dispatched.
					queueMicrotask(() => retype(saveForm, kept));
				}}
			>
				<input {...whichForm(form.id)} />
				{children}
				<div className="adm-actions">
					{saved ? null : (
						<Button
							type="submit"
							variant="primary"
							aria-busy={busy || undefined}
							aria-disabled={busy || undefined}
							onClick={(event) => {
								if (busy) event.preventDefault();
							}}
						>
							Save
						</Button>
					)}
					{/* mounted in every state, so the word arriving in it is a change a reader is told. */}
					<p role="status">{saved ? <StatusWord register="momentary">Saved</StatusWord> : null}</p>
					<button
						type="button"
						className="ds-text-btn ds-text-btn-sm adm-actions__end"
						onClick={() => {
							setTurnedOn(false);
							setSpent(save.data);
							// a rail switched on and never saved is off on the server already: the press
							// closes the card and posts nothing. one whose Save is out is posted, since
							// that Save may land.
							if (!enabled && !busy) return;
							const body = new FormData();
							const which = whichForm(offForm.id);
							body.set(which.name, which.value);
							off.submit(body, { method: 'post' });
						}}
					>
						{disable}
					</button>
				</div>
				{refusal === undefined ? null : <FieldMessage>{refusal}</FieldMessage>}
				{disableRefused === undefined ? null : <FieldMessage>{disableRefused}</FieldMessage>}
			</save.Form>
		</Section>
	);
}

/** what a Save form's boxes hold, by name. */
type Boxes = Readonly<Record<string, string>>;

function boxesOf(form: HTMLFormElement): Boxes {
	return Object.fromEntries([...new FormData(form)].map(([name, value]) => [name, String(value)]));
}

function sameBoxes(left: Boxes, right: Boxes | null): boolean {
	return right !== null && Object.entries(left).every(([name, value]) => right[name] === value);
}

/** each box holding something other than the Save sent, as its name and what it holds. */
function editedSince(typed: Boxes | null, sent: Boxes | null): [string, string][] {
	if (typed === null || sent === null) return [];
	return Object.entries(typed).filter(([name, value]) => sent[name] !== value);
}

/**
 * each box written back as it was typed, with the `input` a keystroke fires, so conform's value and
 * the form's own `onInput` read it as typed.
 */
function retype(form: HTMLFormElement, boxes: readonly [string, string][]): void {
	for (const [name, value] of boxes) {
		const box = form.elements.namedItem(name);
		if (!(box instanceof HTMLInputElement || box instanceof HTMLTextAreaElement)) continue;
		box.value = value;
		box.dispatchEvent(new Event('input', { bubbles: true }));
	}
}

/**
 * focus moved to `target` on the render `present` turns false — the control the reader was on went
 * with the state it drew — where the reader was left on the document. keyed on the change, so a
 * page opened in that state takes no focus.
 */
function useFocusWhenGone(present: boolean, target: () => HTMLElement | null) {
	const was = useRef(present);
	const find = useRef(target);
	find.current = target;
	useEffect(() => {
		const went = was.current && !present;
		was.current = present;
		if (!went) return;
		const active = document.activeElement;
		if (active === null || active === document.body) find.current()?.focus();
	}, [present]);
}
