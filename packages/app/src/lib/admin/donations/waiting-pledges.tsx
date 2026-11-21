import { Modal } from '@better-giving/operator/behaviour/Dialog';
import { Button } from '@better-giving/operator/components/controls/Button';
import { Field } from '@better-giving/operator/components/forms/Field';
import { FieldMessage } from '@better-giving/operator/components/forms/FieldMessage';
import { Section } from '@better-giving/operator/components/shell/Layout';
import { StatusWord } from '@better-giving/operator/components/status/StatusWord';
import { getFormProps } from '@conform-to/react';
import { useId, useRef, useState } from 'react';
import { type FetcherWithComponents, useFetcher } from 'react-router';
import { MARK_RECEIVED_FORM_ID, MARK_RECEIVED_INPUT } from '$lib/donations/pledge-forms';
import { FORM_CURRENCY } from '$lib/forms/amounts';
import { defineForm, type FormRejection } from '$lib/forms/definition';
import { MoneyField } from '../page-edit/money-field';
import { boxProps, useAdminForm, whichForm } from '../use-admin-form';

// the "Waiting to arrive" card on the Gifts screen (../../../routes/_app.admin.donations._index.tsx,
// whose action is Mark received): the stock and IRA (QCD) pledges donors made and staff have not yet
// marked received. a pledge is never a row of the gifts table; Mark received is what makes it one,
// at the value and on the day staff enter in the dialog.

/** one waiting pledge, as the loader projects it. */
export type WaitingPledge = {
	readonly id: string;
	readonly method: 'stock' | 'ira_qcd';
	readonly donorName: string;
	/** null where the donor gave none. */
	readonly donorEmail: string | null;
	/** what was pledged, in words: `50 shares of AAPL`, `$5,000.00 from Fidelity Investments`. */
	readonly pledged: string;
	readonly reference: string;
	/** whether the donor pressed the button saying it is sent. */
	readonly told: boolean;
};

export type WaitingCardProps = {
	readonly waiting: { readonly total: number; readonly pledges: readonly WaitingPledge[] };
};

/** what Mark received answers, or its refusal. */
type ReceivedAnswer = {
	readonly form?: FormRejection;
	readonly received?: { readonly pledgeId: string };
};

/** where Mark received posts: the Gifts screen's index route, whatever route this card is drawn on. */
const RECEIVED_ACTION = '/admin/donations?index';

const MARK_RECEIVED_FORM = defineForm({ id: MARK_RECEIVED_FORM_ID, schema: MARK_RECEIVED_INPUT });

/** drawn only while something waits: the screen mounts it when `total` is above zero. */
export function WaitingCard({ waiting }: WaitingCardProps) {
	const headingId = useId();
	const fetcher = useFetcher<ReceivedAnswer>();
	// the pledge whose dialog is up, and the one the last press was about with the answer in hand as
	// it was made: an answer is shown only in the dialog of the pledge it answered, and the answer in
	// hand at the press is the press before it, which may have been another pledge's.
	const [opened, setOpened] = useState<string | null>(null);
	const [pressed, setPressed] = useState<{
		readonly pledgeId: string;
		readonly over: ReceivedAnswer | undefined;
	} | null>(null);

	// a landed press closes its dialog on the render the revalidated list drops the pledge.
	const landed = fetcher.state === 'idle' ? fetcher.data?.received?.pledgeId : undefined;
	if (opened !== null && landed === opened) setOpened(null);

	const pledge = waiting.pledges.find((one) => one.id === opened);
	const count = `${waiting.total} ${waiting.total === 1 ? 'pledge' : 'pledges'}`;
	return (
		<Section card>
			<div className="adm-record__head">
				<h2 id={headingId} tabIndex={-1}>
					Waiting to arrive
				</h2>
				<StatusWord tone="attention">{count}</StatusWord>
			</div>
			<p className="adm-hint">
				Stocks and IRA (QCD) that donors have pledged. They count toward your totals once you mark
				them received.
			</p>
			{/* biome-ignore lint/a11y/noRedundantRoles: base.css takes the marker off every list, which stops a browser reporting this as a list. */}
			<ul role="list" aria-labelledby={headingId}>
				{waiting.pledges.map((one) => (
					<li key={one.id} className="adm-pledges__row">
						<div>
							<p className="adm-pledges__lead">{one.donorName}</p>
							{one.donorEmail === null ? null : <p className="adm-hint">{one.donorEmail}</p>}
						</div>
						<div>
							<p className="adm-pledges__lead">{one.pledged}</p>
							{one.method === 'ira_qcd' ? <p className="adm-hint">IRA (QCD)</p> : null}
						</div>
						<div>
							<p className="adm-pledges__ref">{one.reference}</p>
							<p className="adm-hint">{one.told ? 'Donor says it’s sent' : 'Instructions shown'}</p>
						</div>
						<Button type="button" onClick={() => setOpened(one.id)}>
							Mark received
							<span className="adm-vh">
								, {one.donorName}, {one.pledged}
							</span>
						</Button>
					</li>
				))}
			</ul>
			{pledge === undefined ? null : (
				<MarkReceivedDialog
					key={pledge.id}
					pledge={pledge}
					fetcher={fetcher}
					answer={
						pressed?.pledgeId === pledge.id && fetcher.data !== pressed.over
							? fetcher.data
							: undefined
					}
					onPress={() => setPressed({ pledgeId: pledge.id, over: fetcher.data })}
					onClose={() => setOpened(null)}
					// the pressed row's button goes with the pledge it marked: back to this card while it
					// stands, else to the gifts table, the screen's one scroll plane.
					fallback={{
						get current() {
							return (
								document.getElementById(headingId) ??
								document.querySelector<HTMLElement>('section.adm-plane')
							);
						}
					}}
				/>
			)}
		</Section>
	);
}

type MarkReceivedDialogProps = {
	readonly pledge: WaitingPledge;
	readonly fetcher: FetcherWithComponents<ReceivedAnswer>;
	/** the last answer, where it answered a press on this pledge. */
	readonly answer: ReceivedAnswer | undefined;
	readonly onPress: () => void;
	readonly onClose: () => void;
	readonly fallback: { readonly current: HTMLElement | null };
};

function MarkReceivedDialog({
	pledge,
	fetcher,
	answer,
	onPress,
	onClose,
	fallback
}: MarkReceivedDialogProps) {
	const [form, fields] = useAdminForm(MARK_RECEIVED_FORM, answer, {
		defaultValue: { pledge_id: pledge.id, value: '', received_on: '' }
	});
	const valueBox = useRef<HTMLInputElement>(null);
	const busy = fetcher.state !== 'idle';
	const refusal = form.errors?.[0];
	const formProps = getFormProps(form);
	return (
		<fetcher.Form
			method="post"
			action={RECEIVED_ACTION}
			{...formProps}
			onSubmit={(event) => {
				onPress();
				formProps.onSubmit(event);
			}}
		>
			<input {...whichForm(MARK_RECEIVED_FORM.id)} />
			<input type="hidden" name={fields.pledge_id.name} value={pledge.id} />
			<Modal
				title="Mark received"
				commit="Mark received"
				commitProps={{
					type: 'submit',
					'aria-busy': busy || undefined,
					'aria-disabled': busy || undefined,
					onClick: (event) => {
						if (busy) event.preventDefault();
					}
				}}
				cancel="Cancel"
				cancelProps={{ type: 'button', onClick: onClose }}
				onDismiss={() => {
					if (!busy) onClose();
				}}
				initialFocus={valueBox}
				fallbackFocus={fallback}
			>
				<p>
					{pledge.pledged} from {pledge.donorName}, reference {pledge.reference}.
				</p>
				<MoneyField
					id={fields.value.id}
					name={fields.value.name}
					defaultValue=""
					currency={FORM_CURRENCY}
					label="Value received"
					hint="Dollar value on the day they arrived."
					affix="$"
					affixAt="start"
					error={fields.value.errors?.[0]}
					inputRef={valueBox}
				/>
				<Field label="Date received" type="date" {...boxProps(fields.received_on)} />
				{refusal === undefined ? null : <FieldMessage>{refusal}</FieldMessage>}
			</Modal>
		</fetcher.Form>
	);
}
