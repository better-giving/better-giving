import { Modal } from '@better-giving/operator/behaviour/Dialog';
import { Button } from '@better-giving/operator/components/controls/Button';
import { CodeSlab } from '@better-giving/operator/components/data/CodeSlab';
import { Field } from '@better-giving/operator/components/forms/Field';
import { FieldMessage } from '@better-giving/operator/components/forms/FieldMessage';
import { Section, Stack } from '@better-giving/operator/components/shell/Layout';
import type { MarkName } from '@better-giving/operator/components/status/Mark';
import { Banner } from '@better-giving/operator/components/status/Banner';
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
	keyStanding,
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

/** the operator's own Zaps at Zapier, where a delivery that went wrong is mended. */
const ZAPIER_ZAPS = 'https://zapier.com/app/zaps';

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
	return (
		<Section>
			{/* no gap of its own: the step between the blocks is `.adm-named`'s alone, and the first
			    block takes it only when the deliveries' strip stands over it. */}
			<div>
				<Deliveries report={report} />
				<div className="adm-named">
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
				</div>
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
							<KeyItem report={report} answer={answer} pending={pending} onPress={onPress} />
						</li>
					</ul>
				</div>
			</div>
		</Section>
	);
}

const TRIGGER_MARK: Record<ZapierTrigger, MarkName> = {
	newDonor: 'user-plus',
	newGift: 'stamp'
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
				<span className="adm-record__mark adm-record__mark--bare">
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
	return (
		<div className="adm-named">
			{trouble.kind === 'refused' ? (
				<FieldMessage>{trouble.detail}</FieldMessage>
			) : (
				noAnswer(trouble.read, UNKNOWN[trouble.press])
			)}
		</div>
	);
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
			{/* the field's label face, so this caption reads as the `<label>` the key's box carries
			    once there is a key to show. */}
			<span className="adm-field__label" id={id}>
				{label}
			</span>
			{children}
		</div>
	);
}

type KeyProps = {
	report: ZapierReport;
	pending: ZapierPress | null;
	onPress: (press: ZapierPress) => void;
};

/**
 * the key's item in whichever of its three standings ./zapier-standing.ts reads.
 *
 * a press's trouble stands under it a named block's step away (`.adm-named`, in a parent with no
 * gap of its own): it reports the press, and drawn closer it reads as part of the box or the press
 * over it.
 */
function KeyItem({ answer, ...props }: KeyProps & { answer: ZapierAnswer | null }): ReactNode {
	const standing = keyStanding(props.report, answer);
	if (standing.kind === 'known')
		return (
			<div className="adm-stated">
				<div>
					<Stack tight>
						<KeyBox keyText={standing.key} pending={props.pending} />
						<KeyPress press="replace" {...props} />
					</Stack>
					<Trouble answer={answer} />
				</div>
			</div>
		);
	return (
		<Asked label="Your authentication key">
			<div>
				<KeyPress press={standing.kind === 'none' ? 'make' : 'replace'} {...props} />
				<Trouble answer={answer} />
			</div>
		</Asked>
	);
}

/** the key, drawn as every stored credential on the console is: a masked box. */
function KeyBox({ keyText, pending }: { keyText: string; pending: ZapierPress | null }): ReactNode {
	const id = useId();
	return (
		<Field
			id={id}
			label="Your authentication key"
			code
			masked
			copyable
			copyLabel="Copy key"
			readOnly
			value={keyText}
			autoComplete="off"
			spellCheck={false}
			// closed under the page's press as every box is (../closed-while-writing.spec.ts): a replace
			// in flight ends the key it shows.
			disabled={pending !== null}
		/>
	);
}

/** the press over the key: make where there is none, replace where one stands. */
function KeyPress({
	press,
	report,
	pending,
	onPress
}: KeyProps & { press: ZapierPress }): ReactNode {
	const [asking, setAsking] = useState(false);
	if (press === 'make')
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
 * the deliveries, where they are worth a word, as a strip over the whole section and nothing where
 * they are not. they are about the feed rather than about a press, so they stand apart from the
 * key's own trouble. a gift given up on is a failure and takes the blocker tone; a queue running
 * late is waiting on somebody and takes attention, the tones as `StatusWord`'s props name them
 * (packages/operator/src/components/status/StatusWord.jsx).
 */
function Deliveries({ report }: { report: ZapierReport }): ReactNode {
	const said = deliveriesSay(report, new Date());
	if (said.length === 0) return null;
	return (
		<Banner tone={report.deliveries.failed > 0 ? 'blocker' : 'attention'}>
			{said.join(' ')} Check{' '}
			<a href={ZAPIER_ZAPS} target="_blank" rel="noreferrer">
				your Zaps on Zapier
			</a>
			.
		</Banner>
	);
}
