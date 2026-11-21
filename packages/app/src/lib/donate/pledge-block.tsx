import { part, partWhen, REGISTRY_CLASS } from '@better-giving/form/parts';
import { useState, type RefObject } from 'react';
import * as copy from './copy';
import type { FieldProps } from './normalize';
import type { PledgeRow } from './pledge';
import { Glyph } from './sections/glyph';

// a saved pledge's block on the full-card screen, and the IRA (QCD) option's box and benefits panel,
// in packages/form/src/pledge-screen.ts's and ira-panel.ts's trees, so the form's sheets that draw the
// element's draw these (`.pledge`, `.pledge-list`, `.benefits` and `.ira-panel` in
// packages/form/src/styles/parts.css and layout.css; the notice is the registry's notice-card-css).
//
// the order is the screen's: the info notice heads the thank-you, and the error notice stands under
// the benefits panel, directly over the press it asks the donor to make again.

/** a notice the registry's notice card draws (notice-card-css.usage.md). */
export type PledgeNotice = {
	readonly tone: 'info' | 'destructive';
	readonly title: string;
	readonly body: string;
};

/** the block's words for one screen. */
export type PledgeScreen = {
	readonly notice: PledgeNotice | null;
	readonly summary: readonly PledgeRow[];
	/** where the gift is sent, `null` on the thank-you, which lists what was pledged alone. */
	readonly details: readonly PledgeRow[] | null;
	readonly benefits: copy.Benefits | null;
};

/**
 * the benefits panel: a title, the claim and the fine print. a heading at `level`, so it sits one
 * rank under whatever heading the panel stands below.
 */
export function BenefitsPanel({
	benefits,
	level
}: {
	readonly benefits: copy.Benefits;
	readonly level: 'h3' | 'h4';
}) {
	const Title = level;
	return (
		<div className="benefits">
			<Title className="benefits-title">{benefits.title}</Title>
			<p className="benefits-body">{benefits.body}</p>
			<p className="benefits-fine">{benefits.fine}</p>
		</div>
	);
}

/**
 * one notice, in its tone, and no live region of its own, as `notice` in
 * packages/form/src/pledge-screen.ts draws the element's. a role set on the commit that shows the
 * screen is a region created and filled in one breath, which assistive technology drops (./announce.tsx);
 * its words are said by the card's own region instead (`announce` and `arrival` in `pledgedScreen`,
 * ./takeover.tsx). always rendered, hidden while there is none.
 */
function Notice({ id, notice }: { readonly id: string; readonly notice: PledgeNotice | null }) {
	const titleId = `${id}-title`;
	return (
		<section
			className={
				notice === null ? 'ds-notice-card' : `ds-notice-card ds-notice-card-${notice.tone}`
			}
			aria-labelledby={titleId}
			hidden={notice === null}
		>
			<span className="ds-notice-card-icon" aria-hidden="true">
				{notice === null ? null : (
					<Glyph name={notice.tone === 'info' ? 'info' : 'alert'} className="notice-glyph" />
				)}
			</span>
			<div className="ds-notice-card-content">
				<div className="ds-notice-card-text">
					<p className="ds-notice-card-title" id={titleId}>
						{notice?.title ?? ''}
					</p>
					<div className="ds-notice-card-body">{notice?.body ?? ''}</div>
				</div>
			</div>
		</section>
	);
}

/** what a Copy last reported, as `data-outcome` on it, which picks the face it shows. */
type CopyOutcome = 'ready' | 'copied' | 'failed';

/**
 * the control that copies one value: the copy mark alone, named `Copy {noun}` and described by the
 * value. it reports its outcome in place — a tick, or the danger mark with the value selected so it
 * can be copied by hand — and on the card's region through `onCopied`, and is ready again once the
 * caret leaves it. the same control and sentences as the address screen's.
 */
function CopyButton({
	noun,
	value,
	valueId,
	onCopied
}: {
	readonly noun: string;
	readonly value: string;
	readonly valueId: string;
	readonly onCopied: (words: string) => void;
}) {
	const [outcome, setOutcome] = useState<CopyOutcome>('ready');
	const failed = (): void => {
		setOutcome('failed');
		onCopied(copy.pledgeNotCopied(noun));
		const node = document.getElementById(valueId);
		const selection = document.getSelection();
		if (node === null || selection === null) return;
		const range = document.createRange();
		range.selectNodeContents(node);
		selection.removeAllRanges();
		selection.addRange(range);
	};
	return (
		<button
			type="button"
			className="copy"
			part={part('action-quiet')}
			data-outcome={outcome}
			aria-label={copy.copyNamed(noun)}
			aria-describedby={valueId}
			onClick={() => {
				const clipboard = navigator.clipboard;
				if (clipboard === undefined) {
					failed();
					return;
				}
				clipboard.writeText(value).then(() => {
					setOutcome('copied');
					onCopied(copy.pledgeCopied(noun));
				}, failed);
			}}
			onBlur={() => setOutcome('ready')}
		>
			<span className="copy-face ready">
				<Glyph name="copy" className="copy-glyph" />
			</span>
			<span className="copy-face copied">
				<Glyph name="tick" className="copy-glyph" />
			</span>
			<span className="copy-face failed">
				<Glyph name="alert" className="copy-glyph" />
			</span>
		</button>
	);
}

/**
 * a list of rows, as `<dt>` and `<dd>` pairs in one `<div>` each.
 *
 * a row's `<div>` may hold its `<dt>` and `<dd>` and nothing else
 * (https://html.spec.whatwg.org/multipage/grouping-content.html#the-dl-element), so a Copy stands in
 * the `<dd>` after the value's own `<span>`, which is what the Copy is described by and selects, as
 * `list` in packages/form/src/pledge-screen.ts builds the element's.
 */
function PledgeList({
	rows,
	className,
	prefix,
	onCopied
}: {
	readonly rows: readonly PledgeRow[] | null;
	readonly className: string;
	readonly prefix: string;
	readonly onCopied: (words: string) => void;
}) {
	return (
		<dl className={`pledge-list ${className}`} hidden={rows === null}>
			{(rows ?? []).map((row, at) => {
				const valueId = `${prefix}-${at}`;
				return (
					<div className="pledge-row" key={row.label}>
						<dt className="pledge-label">{row.label}</dt>
						<dd className={row.mono === true ? 'pledge-value mono' : 'pledge-value'}>
							<span className="pledge-text" id={valueId}>
								{row.value}
							</span>
							{row.copy === undefined ? null : (
								<CopyButton
									noun={row.copy}
									value={row.value}
									valueId={valueId}
									onCopied={onCopied}
								/>
							)}
						</dd>
					</div>
				);
			})}
		</dl>
	);
}

/** the block, always rendered and hidden on a screen with no pledge, as the takeover's other parts are. */
export function PledgeBlock({
	screen,
	onCopied
}: {
	readonly screen: PledgeScreen | null;
	readonly onCopied: (words: string) => void;
}) {
	const notice = screen?.notice ?? null;
	return (
		<div className="pledge" hidden={screen === null}>
			<Notice id="pledge-notice-top" notice={notice?.tone === 'info' ? notice : null} />
			<PledgeList
				rows={screen?.summary ?? null}
				className="pledge-summary"
				prefix="pledge-summary"
				onCopied={onCopied}
			/>
			<PledgeList
				rows={screen?.details ?? null}
				className="pledge-details"
				prefix="pledge-detail"
				onCopied={onCopied}
			/>
			<div className="pledge-benefits" hidden={screen?.benefits == null}>
				{screen?.benefits == null ? null : <BenefitsPanel benefits={screen.benefits} level="h3" />}
			</div>
			<Notice id="pledge-notice-foot" notice={notice?.tone === 'destructive' ? notice : null} />
		</div>
	);
}

/**
 * what the IRA (QCD) option holds once it is open: the Custodian box and the benefits panel under
 * it. portalled by the card into the node the option stands in its row (`ira` on `Checkout` in
 * ./machine.ts), which is light DOM inside the card's `<form>`, so Enter in the box presses the
 * review step's Continue.
 *
 * the box is the card's floating-label field, drawn as the details step's name boxes are. `problem`
 * is `''` for nothing wrong; the card decides when there is one and where the caret goes.
 */
export function IraPanel({
	field,
	problem,
	inputRef
}: {
	readonly field: FieldProps;
	readonly problem: string;
	readonly inputRef: RefObject<HTMLInputElement | null>;
}) {
	const wrong = problem !== '';
	return (
		<div className="ira-panel">
			<div className="field-row floating">
				<label part={part('label')} htmlFor={CUSTODIAN_ID}>
					<span className="label-words">{copy.CUSTODIAN_LABEL}</span>
				</label>
				<input
					{...field.box}
					id={CUSTODIAN_ID}
					ref={inputRef}
					autoComplete="off"
					// blank on purpose: `:placeholder-shown` is how the floating label knows the box is
					// empty (`TextField` in ./steps/details.tsx).
					placeholder=" "
					part={partWhen('field', { invalid: wrong })}
					className={REGISTRY_CLASS.field}
					aria-invalid={wrong ? true : undefined}
					aria-describedby={wrong ? CUSTODIAN_PROBLEM_ID : undefined}
				/>
				<p className="message" id={CUSTODIAN_PROBLEM_ID} hidden={!wrong}>
					{problem}
				</p>
			</div>
			<BenefitsPanel benefits={copy.IRA_BENEFITS} level="h4" />
		</div>
	);
}

const CUSTODIAN_ID = 'custodian';
const CUSTODIAN_PROBLEM_ID = 'custodian-problem';
