import { Modal } from '@better-giving/operator/behaviour/Dialog';
import { Button } from '@better-giving/operator/components/controls/Button';
import { CodeSlab } from '@better-giving/operator/components/data/CodeSlab';
import { FieldMessage } from '@better-giving/operator/components/forms/FieldMessage';
import { StatedValue } from '@better-giving/operator/components/forms/StatedValue';
import { Section } from '@better-giving/operator/components/shell/Layout';
import type { ZapierPress, ZapierReport } from '@better-giving/operator/console/zapier';
import type { ReactNode } from 'react';
import { useId, useState } from 'react';
import type { ZapierRead } from '../api/types';
import { noAnswer } from './processor-screen';
import type { ZapierAnswer } from './zapier-standing';
import {
	UNKNOWN,
	deliveriesSay,
	freshKey,
	listeningTotal,
	madeOn,
	pressTrouble,
	replaceCosts
} from './zapier-standing';

// the one key Zapier presents to this deployment, the Zaps listening on it, and the two presses
// over it.
//
// **it is the screen's body and not its route**, ./quickbooks-section.tsx's arrangement: every read
// it draws was taken by whatever mounts it and each press is a callback answered there.
//
// **it is not a processor and not a set-up job** (packages/operator/src/console/zapier.ts), so a
// deployment with no key draws one press and nothing else.

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
	const trouble = <Trouble answer={answer} />;
	// the answer's instant before the reading's: after a replace, the reading that has not landed
	// yet still carries the old key's.
	const madeAt = made?.madeAt ?? report.key?.madeAt ?? null;
	return (
		<Section>
			{madeAt === null ? (
				<div className="adm-named">
					<div className="adm-actions">
						<Press press="make" variant="primary" pending={pending} onPress={onPress}>
							Make key
						</Press>
					</div>
					{trouble}
				</div>
			) : (
				<Standing
					report={report}
					madeAt={madeAt}
					keyText={made?.key ?? null}
					address={address}
					pending={pending}
					onPress={onPress}
					trouble={trouble}
				/>
			)}
			<Deliveries report={report} />
		</Section>
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

/** what stands under the one press on the section after an answer that did not land. */
function Trouble({ answer }: { answer: ZapierAnswer | null }): ReactNode {
	const trouble = pressTrouble(answer);
	if (trouble === null) return null;
	// the deployment's refusal is a sentence written for a reader and naming the press to make, so
	// it is drawn as one rather than quoted.
	if (trouble.kind === 'refused') return <FieldMessage>{trouble.detail}</FieldMessage>;
	return noAnswer(trouble.read, UNKNOWN[trouble.press]);
}

/**
 * one value an operator copies into Zapier, named by the caption over it.
 *
 * a group because the one-line slab carries no caption of its own, and two copy controls both
 * called Copy need the name of what they copy from somewhere.
 */
function Copyable({
	label,
	content,
	children
}: {
	label: string;
	content: string;
	children?: ReactNode;
}): ReactNode {
	const id = useId();
	return (
		/* biome-ignore lint/a11y/useSemanticElements: a fieldset groups form controls under a legend
		   and this holds none — a value and the control that copies it, named by the caption. */
		<div className="adm-stated" role="group" aria-labelledby={id}>
			<span className="adm-stated__label" id={id}>
				{label}
			</span>
			<CodeSlab oneline copyable content={content} />
			{children ? <p className="adm-hint">{children}</p> : null}
		</div>
	);
}

/**
 * the key that exists, what Zapier asks for to connect with it, what listens on it, and the way to
 * a new one.
 *
 * **one layout whether the key was made a moment ago or long before**, so the reading that lands
 * after a make moves nothing: the key's own row is the one thing the press adds, and it goes with
 * the answer that carried it.
 */
function Standing({
	report,
	madeAt,
	keyText,
	address,
	pending,
	onPress,
	trouble
}: {
	report: ZapierReport;
	madeAt: string;
	/** the key the last press made, or `null` where it is no longer in hand. */
	keyText: string | null;
	address: string;
	pending: ZapierPress | null;
	onPress: (press: ZapierPress) => void;
	trouble: ReactNode;
}): ReactNode {
	const [asking, setAsking] = useState(false);
	const listening = listeningTotal(report);
	return (
		<div className="adm-named">
			<Copyable label="Deployment address" content={address} />
			{keyText === null ? null : (
				<Copyable label="Key" content={keyText}>
					It isn’t shown again.
				</Copyable>
			)}
			<p className="adm-prose">
				<a href={ZAPIER_APP_INVITE} target="_blank" rel="noreferrer">
					Open Better Giving Self-Hosted on Zapier
				</a>
			</p>
			<StatedValue label="Key made" value={madeOn(madeAt) ?? madeAt} />
			{/* no `num`: its figure set draws a slashed zero, which reads as a literal to retype. */}
			<StatedValue label="Zaps listening for new gifts" value={report.listening.newGift} />
			<StatedValue label="Zaps listening for new donors" value={report.listening.newDonor} />
			<div className="adm-actions">
				<Press press="replace" variant="danger" pending={pending} onPress={() => setAsking(true)}>
					Replace key
				</Press>
			</div>
			{trouble}
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
						{replaceCosts(listening).map((line) => (
							<li key={line}>{line}</li>
						))}
					</ul>
				</Modal>
			) : null}
		</div>
	);
}

/** the deliveries, where they are worth a word, and nothing where they are not. */
function Deliveries({ report }: { report: ZapierReport }): ReactNode {
	const said = deliveriesSay(report, new Date());
	if (said.length === 0) return null;
	return (
		<div className="adm-named">
			<FieldMessage>{said.join(' ')}</FieldMessage>
		</div>
	);
}
