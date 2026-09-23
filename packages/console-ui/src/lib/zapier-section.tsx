import { Modal } from '@better-giving/operator/behaviour/Dialog';
import { Button } from '@better-giving/operator/components/controls/Button';
import { CodeSlab } from '@better-giving/operator/components/data/CodeSlab';
import { Field } from '@better-giving/operator/components/forms/Field';
import { FieldMessage } from '@better-giving/operator/components/forms/FieldMessage';
import { Section, Stack } from '@better-giving/operator/components/shell/Layout';
import type { MarkName } from '@better-giving/operator/components/status/Mark';
import { Mark } from '@better-giving/operator/components/status/Mark';
import type { ZapierPress, ZapierReport } from '@better-giving/operator/console/zapier';
import type { ReactNode } from 'react';
import { useId, useState } from 'react';
import type { ZapierRead } from '../api/types';
import { noAnswer } from './processor-screen';
import type { ZapierAnswer, ZapierTrigger } from './zapier-standing';
import {
	TRIGGER_NAME,
	UNKNOWN,
	deliveriesSay,
	freshKey,
	listeningSays,
	listeningTotal,
	pressTrouble,
	replaceCosts
} from './zapier-standing';

// what the Better Giving Zapier app notifies an operator about — its two triggers and the Zaps
// listening on each — and what it requires: this deployment's address and the one key Zapier
// presents to it, with the two presses over the key.
//
// **it is the screen's body and not its route**, ./quickbooks-section.tsx's arrangement: every read
// it draws was taken by whatever mounts it and each press is a callback answered there.
//
// **it is not a processor and not a set-up job** (packages/operator/src/console/zapier.ts), so a
// deployment with no key draws the two things asked for and nothing more — no Zap listens without
// one.

/** the invite to the private app, which is how an operator reaches it at all while it is unlisted. */
const ZAPIER_APP_INVITE =
	'https://zapier.com/developer/public-invite/246638/803637a3b082236c496f23f989243a87/';

/* the page this section is drawn on names an answer by the type it is handed
   (./zapier-standing.ts), so the two spell one thing once. */
export type { ZapierAnswer } from './zapier-standing';

export type ZapierSectionProps = {
	/** where the key stands, as the route resolved it. */
	zapier: ZapierRead;
	/** how the last press was answered, or `null` where none has been made. */
	answer: ZapierAnswer | null;
	/** the press in flight, or `null` where none is. */
	pending: ZapierPress | null;
	/** where this deployment answers, which Zapier asks for beside the key. */
	address: string;
	onPress: (press: ZapierPress) => void;
};

export function ZapierSection({
	zapier,
	answer,
	pending,
	address,
	onPress
}: ZapierSectionProps): ReactNode {
	if (zapier.kind === 'unread')
		return <Section>{noAnswer(zapier.read, 'it can’t say whether there is a key')}</Section>;
	const report = zapier.report;
	const made = freshKey(answer);
	return (
		<Section>
			{/* no gap of its own: the step between the two groups is `.adm-named`'s alone. */}
			<div>
				<Stack tight>
					<p className="adm-prose">
						The{' '}
						<a href={ZAPIER_APP_INVITE} target="_blank" rel="noreferrer">
							Better Giving Zapier app
						</a>{' '}
						notifies you about
					</p>
					<div className="adm-cardpair adm-cardpair--even">
						<Trigger trigger="newDonor" report={report} />
						<Trigger trigger="newGift" report={report} />
					</div>
				</Stack>
				<div className="adm-named">
					<p className="adm-prose">and requires:</p>
					{/* unnumbered: the app asks for both, in no order. the base reset takes the list's
					    markers and indent, so the items stand on the edge "and requires:" stands on. */}
					<ul>
						<li>
							<Asked label="Your deployment address">
								<CodeSlab oneline copyable content={address} copyLabel="Copy address" />
							</Asked>
						</li>
						<li>
							{made === null ? (
								<Asked label="Your authentication key">
									<KeyPress report={report} pending={pending} onPress={onPress} />
									<Trouble answer={answer} />
									<Deliveries report={report} />
								</Asked>
							) : (
								<div className="adm-stated">
									<KeyInHand made={made} pending={pending} />
									<Deliveries report={report} />
								</div>
							)}
						</li>
					</ul>
				</div>
			</div>
		</Section>
	);
}

const TRIGGER_MARK: Record<ZapierTrigger, MarkName> = {
	newDonor: 'user-plus',
	newGift: 'hand-coins'
};

/**
 * one trigger the app hands a Zap, as a card of one row: its mark, its name, and its listeners at
 * the trailing end where there are any. with no key nothing can listen, whatever the rows hold.
 *
 * the row is `RecordCard`'s marked head written out, since that component's name is a link and its
 * body is a record's origins, and this card has neither.
 */
function Trigger({ trigger, report }: { trigger: ZapierTrigger; report: ZapierReport }): ReactNode {
	const listening = report.key === null ? null : listeningSays(report.listening[trigger]);
	return (
		<div className="adm-record">
			<div className="adm-record__head adm-record__head--marked">
				<span className="adm-record__mark">
					<Mark name={TRIGGER_MARK[trigger]} />
				</span>
				<h2 className="adm-record__title">{TRIGGER_NAME[trigger]}</h2>
				{listening === null ? null : <span className="adm-prose">{listening}</span>}
			</div>
		</div>
	);
}

/** one press, held with `aria-disabled` and guarded behind it for ./quickbooks-section.tsx's reason. */
function Press({
	press,
	variant,
	pending,
	onPress,
	children
}: {
	press: ZapierPress;
	variant: 'primary' | 'danger';
	pending: ZapierPress | null;
	onPress: (press: ZapierPress) => void;
	children: ReactNode;
}): ReactNode {
	return (
		<Button
			type="button"
			variant={variant}
			onClick={() => {
				if (pending !== null) return;
				onPress(press);
			}}
			aria-disabled={pending !== null || undefined}
			aria-busy={pending === press || undefined}
		>
			{children}
		</Button>
	);
}

/** what stands under the key's press after an answer that did not land. */
function Trouble({ answer }: { answer: ZapierAnswer | null }): ReactNode {
	const trouble = pressTrouble(answer);
	if (trouble === null) return null;
	// the deployment's refusal is a sentence written for a reader and naming the press to make, so
	// it is drawn as one rather than quoted.
	if (trouble.kind === 'refused') return <FieldMessage>{trouble.detail}</FieldMessage>;
	return noAnswer(trouble.read, UNKNOWN[trouble.press]);
}

/**
 * one thing the app asks for, named by the caption over it — a group because the one-line slab
 * carries no caption of its own.
 */
function Asked({ label, children }: { label: string; children: ReactNode }): ReactNode {
	const id = useId();
	return (
		/* biome-ignore lint/a11y/useSemanticElements: a fieldset groups fields under a legend and this
		   holds none — a value and the control that copies it, or a press, named by the caption. */
		<div className="adm-stated" role="group" aria-labelledby={id}>
			<span className="adm-stated__label" id={id}>
				{label}
			</span>
			{children}
		</div>
	);
}

/**
 * the key the last press made, drawn as every stored credential on the console is: a masked box.
 *
 * it wins over the reading, which is why the section asks for it first: after a replace, the
 * reading that has not landed yet still says a key stands.
 */
function KeyInHand({ made, pending }: { made: string; pending: ZapierPress | null }): ReactNode {
	const id = useId();
	return (
		<Field
			id={id}
			label="Your authentication key"
			hint="It isn’t shown again."
			code
			masked
			readOnly
			value={made}
			autoComplete="off"
			spellCheck={false}
			// closed under the page's press as every box is (../closed-while-writing.spec.ts), though
			// none is drawn beside a key in hand.
			disabled={pending !== null}
		/>
	);
}

/** the press over a key that is not in hand: make where there is none, replace where one stands. */
function KeyPress({
	report,
	pending,
	onPress
}: {
	report: ZapierReport;
	pending: ZapierPress | null;
	onPress: (press: ZapierPress) => void;
}): ReactNode {
	const [asking, setAsking] = useState(false);
	if (report.key === null)
		return (
			<div className="adm-actions">
				<Press press="make" variant="primary" pending={pending} onPress={onPress}>
					Create key
				</Press>
			</div>
		);
	return (
		<>
			<div className="adm-actions">
				<Press press="replace" variant="danger" pending={pending} onPress={() => setAsking(true)}>
					Replace key
				</Press>
			</div>
			{asking ? (
				<Modal
					title="Replace the key?"
					onDismiss={() => setAsking(false)}
					danger="Replace key"
					dangerProps={{
						type: 'button' as const,
						disabled: pending !== null || undefined,
						onClick: () => {
							setAsking(false);
							onPress('replace');
						}
					}}
					cancel="Go back"
					cancelProps={{ type: 'button' as const, onClick: () => setAsking(false) }}
				>
					<ul className="adm-list">
						{replaceCosts(listeningTotal(report)).map((line) => (
							<li key={line}>{line}</li>
						))}
					</ul>
				</Modal>
			) : null}
		</>
	);
}

/**
 * the deliveries, under the key they go out on, where they are worth a word, and nothing where
 * they are not.
 */
function Deliveries({ report }: { report: ZapierReport }): ReactNode {
	const said = deliveriesSay(report, new Date());
	if (said.length === 0) return null;
	return <FieldMessage>{said.join(' ')}</FieldMessage>;
}
