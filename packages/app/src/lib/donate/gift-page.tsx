import registryBadge from '@better-giving/operator/registry/styles/badge-css.css?url';
import registryNoticeCard from '@better-giving/operator/registry/styles/notice-card-css.css?url';
import registryTextButton from '@better-giving/operator/registry/styles/text-button-css.css?url';
import { amountAfterRefunds } from '@better-giving/emails';
import { GLYPHS as FORM_GLYPHS } from '@better-giving/form/glyph';
import { MAX_EMPLOYER } from '@better-giving/form/v1';
import { type RefObject, useEffect, useId, useRef, useState } from 'react';
import { Form, useNavigation } from 'react-router';
import { formatMinor } from '../donations/money';
import { imageSrc } from '../page/image-src';
import type { GiftPageView } from '../server/matching/views';
import { usePressOnce } from '../supporter/area/use-press-once';
import * as copy from './copy';
import { PageRoot } from './page-root';
import { initials, isWordmark, type PageLogo, type PageLook } from './page-view';
import { donorPageLinks } from './plain-page';
import { ProfileMark } from './sections/profile';
import { SETTLE_MS } from './sections/share';

// the donor's own page for one gift, at /gift/{token}: the details their employer's giving portal
// asks for, the employer they named, and that they filed it. no sign-in: the token is the key.
//
// a sibling of the plain donor pages in ./plain-page.tsx — the page root, its wash and the profile
// head's identity row — at the ended page's reading column, with the registry's notice card, badge
// and text button linked beside the donor sheets (`giftPageLinks`).
//
// what renders is read off the stamps alone: the details unless the gift was refunded; the
// employer card on a live gift, one neither refunded nor voided, while its match is open or an
// employer is named, since a matched gift takes no new name (the action refuses it CLOSED); the
// filed card while nothing is filed, matched or voided, and a status row in its place once it is.
// a voided gift states that the request is closed and never why — the view carries no reason.
//
// both posts are `<Form method="post">` to the page's own address with a flat `intent` field, and
// work without script: `employer` with one `employer` box, `filed` with nothing else. with script,
// a press whose post is out is held — `aria-disabled` and `aria-busy`, so it keeps the focus — and
// its form refuses a second submit until the page the answer leads to is drawn; a blank Save is
// refused here, under the box, with the sentence the action refuses one with.

/** what the action answers a post with. `intent` places a refusal at the control that was pressed. */
export type GiftPageResult =
	| { readonly done: 'employer' | 'filed' }
	| { readonly intent: 'employer' | 'filed'; readonly error: string };

export type GiftPageProps = {
	/** the organisation's display name; the filing rows carry its legal name. */
	readonly orgName: string;
	readonly logo: PageLogo | null;
	readonly look: PageLook;
	readonly gift: GiftPageView;
	readonly result?: GiftPageResult | undefined;
};

/** the donor sheets, with the registry's notice card, badge and text button before the page's own. */
export function giftPageLinks() {
	return donorPageLinks([registryNoticeCard, registryBadge, registryTextButton]);
}

// a gift's day as the copied details spell it (`formatDate` in packages/emails/src/format.ts): en-US
// and in UTC, the zone every stored instant is in, so the page and the pasted text name one day.
const DAY = new Intl.DateTimeFormat('en-US', {
	day: 'numeric',
	month: 'long',
	year: 'numeric',
	timeZone: 'UTC'
});
const DAY_IN_YEAR = new Intl.DateTimeFormat('en-US', {
	day: 'numeric',
	month: 'long',
	timeZone: 'UTC'
});
const day = (at: Date): string => DAY.format(at);
const dayInYear = (at: Date): string => DAY_IN_YEAR.format(at);

// the gift's amount in `giftAmount`'s words and rule (packages/emails/src/templates/gift-amount.ts),
// as the copied details and the mails state it, with the figures spelled the way a screen spells money.
function amountStated({ amountMinor, givenMinor, currency }: GiftPageView['filing']): string {
	const left = formatMinor(amountMinor, currency);
	return amountMinor < givenMinor
		? amountAfterRefunds(left, formatMinor(givenMinor, currency))
		: left;
}

export function GiftPage({ orgName, logo, look, gift, result }: GiftPageProps) {
	const refunded = gift.refundedAt !== null;
	const live = !refunded && gift.voidedAt === null;
	// matched counts as filed, and its row says the money arrived.
	const filedLine =
		gift.matchedAt !== null
			? copy.matchArrived(gift.employer, day(gift.matchedAt))
			: gift.filedAt !== null
				? copy.markedFiled(day(gift.filedAt))
				: null;
	const filed = filedLine !== null;
	const { filing } = gift;
	const refusal = result !== undefined && 'error' in result ? result : null;
	const saved =
		result !== undefined && 'done' in result && result.done === 'employer' ? result : null;
	const navigation = useNavigation();
	// a press is held until the page the answer leads to is drawn: the router keeps the post's
	// body through `loading`, so a press stays held between the answer and the reload it carries.
	const posting = (intent: 'employer' | 'filed') =>
		navigation.state !== 'idle' && navigation.formData?.get('intent') === intent;

	const employerShown = useRef<HTMLDivElement | null>(null);
	const employerBox = useRef<HTMLInputElement | null>(null);
	const filedRow = useRef<HTMLDivElement | null>(null);
	// a post's answer moves the caret to what it changed, or to the box it refused; a refused filed
	// press leaves it on the press, which the refusal describes.
	useEffect(() => {
		if (result === undefined) return;
		if ('done' in result) {
			(result.done === 'filed' ? filedRow : employerShown).current?.focus();
		} else if (result.intent === 'employer') employerBox.current?.focus();
	}, [result]);

	return (
		<PageRoot brandColour={look.brandColour} layout="plain">
			<main className="stage gift">
				<div className="page-profile-id">
					<ProfileMark
						name={orgName}
						logo={
							logo === null
								? null
								: { src: imageSrc(logo.imageId), width: logo.width, height: logo.height }
						}
						wide={logo !== null && isWordmark(logo)}
						letters={initials(orgName)}
					/>
					<div className="page-profile-names">
						<p className="gift-org">{orgName}</p>
						{filing.ein === null ? null : (
							<p className="page-profile-ein">
								EIN <span className="page-profile-ein-number">{filing.ein}</span>
							</p>
						)}
					</div>
				</div>
				<header className="gift-head">
					<h1 className="gift-title">{copy.GIFT_HEADING}</h1>
					<p className="gift-sum">
						<span>
							{copy.giftSummary(
								// a gift refunded whole has nothing left to state beside the Refunded badge.
								refunded ? formatMinor(filing.givenMinor, filing.currency) : amountStated(filing),
								day(filing.givenAt)
							)}
						</span>
						{refunded ? (
							<span className="ds-badge ds-badge-outline">{copy.GIFT_REFUNDED_BADGE}</span>
						) : null}
					</p>
				</header>
				{gift.refundedAt !== null ? (
					<Notice
						tone="warning"
						title={copy.GIFT_REFUNDED_TITLE}
						body={copy.giftRefundedBody(orgName, day(gift.refundedAt))}
					/>
				) : gift.voidedAt !== null ? (
					<Notice tone="info" title={copy.GIFT_CLOSED_TITLE} body={copy.giftClosedBody(orgName)} />
				) : null}
				{refunded ? null : <FilingCard gift={gift} orgName={orgName} />}
				{live && (gift.matchedAt === null || gift.employer !== null) ? (
					<EmployerCard
						gift={gift}
						filed={filed}
						refusal={refusal?.intent === 'employer' ? refusal.error : null}
						saved={saved}
						pending={posting('employer')}
						result={result}
						shownRef={employerShown}
						boxRef={employerBox}
					/>
				) : null}
				{live && filedLine !== null ? (
					<FiledRow
						line={filedLine}
						seen={gift.matchedAt === null ? copy.orgCanSee(orgName) : null}
						rowRef={filedRow}
					/>
				) : null}
				{live && filedLine === null ? (
					<FiledCard
						orgName={orgName}
						refusal={refusal?.intent === 'filed' ? refusal.error : null}
						pending={posting('filed')}
						result={result}
					/>
				) : null}
			</main>
		</PageRoot>
	);
}

/** lucide's `info` and `triangle-alert` (https://lucide.dev, ISC), which the form's set does not carry. */
const GLYPHS = {
	...FORM_GLYPHS,
	info: ['M2 12a10 10 0 1 0 20 0a10 10 0 1 0 -20 0', 'M12 16v-4', 'M12 8h.01'],
	warning: [
		'm21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3',
		'M12 9v4',
		'M12 17h.01'
	]
} as const;

/** a mark beside words that name what it means, so out of the reading. */
function Mark({
	name,
	className
}: {
	readonly name: keyof typeof GLYPHS;
	readonly className?: string;
}) {
	return (
		<svg
			className={className}
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
			focusable="false"
		>
			{GLYPHS[name].map((d) => (
				<path key={d} d={d} />
			))}
		</svg>
	);
}

/** the registry's notice card, on the page from its first paint and so with no role (its usage note). */
function Notice({
	tone,
	title,
	body
}: {
	readonly tone: 'info' | 'warning';
	readonly title: string;
	readonly body: string;
}) {
	const titleId = useId();
	return (
		<section className={`ds-notice-card ds-notice-card-${tone}`} aria-labelledby={titleId}>
			<span className="ds-notice-card-icon">
				<Mark name={tone} className="gift-notice-mark" />
			</span>
			<div className="ds-notice-card-content">
				<div className="ds-notice-card-text">
					<h2 className="ds-notice-card-title" id={titleId}>
						{title}
					</h2>
					<p className="ds-notice-card-body">{body}</p>
				</div>
			</div>
		</section>
	);
}

function CardHead({
	id,
	title,
	hint,
	hintId
}: {
	readonly id: string;
	readonly title: string;
	readonly hint?: string | undefined;
	readonly hintId?: string | undefined;
}) {
	return (
		<div className="gift-card-head">
			<h2 className="gift-card-title" id={id}>
				{title}
			</h2>
			{hint === undefined ? null : (
				<p className="gift-hint" id={hintId}>
					{hint}
				</p>
			)}
		</div>
	);
}

type Copied = 'idle' | 'copied' | 'failed';

const COPY_MARK = { idle: 'copy', copied: 'tick', failed: 'alert' } as const satisfies Record<
	Copied,
	keyof typeof GLYPHS
>;
const COPY_WORDS: Record<Copied, string> = {
	idle: copy.COPY_DETAILS,
	copied: copy.DETAILS_COPIED,
	failed: copy.DETAILS_NOT_COPIED
};

/**
 * the paperwork, as rows and as the text Copy details writes. a row with no value is left out, as
 * `filingDetailsText` leaves it out of that text — the mailing address the one that ordinarily is.
 */
function FilingCard({ gift, orgName }: { readonly gift: GiftPageView; readonly orgName: string }) {
	const headingId = useId();
	const { filing } = gift;
	const receipt =
		filing.receiptSentAt === null
			? null
			: filing.receiptEmail === null
				? copy.receiptSent(day(filing.receiptSentAt))
				: copy.receiptEmailed(filing.receiptEmail, day(filing.receiptSentAt));
	const rows: [string, string | null, boolean][] = [
		[copy.FILING_LABELS.nonprofit, filing.nonprofit, false],
		[copy.FILING_LABELS.ein, filing.ein, true],
		[copy.FILING_LABELS.mailingAddress, filing.mailingAddress, false],
		[copy.FILING_LABELS.amount, amountStated(filing), false],
		[copy.FILING_LABELS.date, day(filing.givenAt), false],
		[copy.FILING_LABELS.receipt, receipt, false]
	];

	// the outcome is the press's own words and mark, as Copy link's is (./sections/share.tsx), and is
	// said in a polite region rendered empty from the first paint, keyed by the press so a second
	// press inside the first one's moment is said too; both settle after `SETTLE_MS`.
	const [copied, setCopied] = useState<Copied>('idle');
	const [press, setPress] = useState(0);
	const settle = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	useEffect(() => () => clearTimeout(settle.current), []);
	const copyDetails = async () => {
		let landed: Copied;
		try {
			await navigator.clipboard.writeText(gift.copyText);
			landed = 'copied';
		} catch {
			landed = 'failed';
		}
		setCopied(landed);
		setPress((at) => at + 1);
		clearTimeout(settle.current);
		settle.current = setTimeout(() => setCopied('idle'), SETTLE_MS);
	};

	return (
		<section className="gift-card" aria-labelledby={headingId}>
			<CardHead id={headingId} title={copy.FILING_HEADING} hint={copy.filingHint(orgName)} />
			<dl className="gift-details">
				{rows.map(([label, value, mono]) =>
					value === null ? null : (
						<div className="gift-detail" key={label}>
							<dt>{label}</dt>
							<dd className={mono ? 'gift-mono' : undefined}>{value}</dd>
						</div>
					)
				)}
			</dl>
			<button type="button" className="ds-btn ds-btn-secondary" onClick={copyDetails}>
				<Mark name={COPY_MARK[copied]} />
				{COPY_WORDS[copied]}
			</button>
			<p className="vh" role="status">
				{copied === 'idle' ? null : (
					<span key={press}>
						{copied === 'copied' ? copy.DETAILS_COPIED : copy.DETAILS_NOT_COPIED}
					</span>
				)}
			</p>
		</section>
	);
}

/** a Change press: the name it was pressed beside, and the saved answer standing when it was. */
type Changing = { readonly employer: string; readonly savedUnder: GiftPageResult | null };

/**
 * the employer: a box to name them where nobody is named, and the name with its emails line where
 * someone is. Change opens the box over the name until a filed or matched gift, after which the
 * name stands as it is; Cancel closes it on the saved name.
 */
function EmployerCard({
	gift,
	filed,
	refusal,
	saved,
	pending,
	result,
	shownRef,
	boxRef
}: {
	readonly gift: GiftPageView;
	readonly filed: boolean;
	readonly refusal: string | null;
	/** the action's answer to a saved employer, a new object on every save. */
	readonly saved: GiftPageResult | null;
	readonly pending: boolean;
	/** the action's last answer, whichever post it was to, which lets a held press go. */
	readonly result: GiftPageResult | undefined;
	readonly shownRef: RefObject<HTMLDivElement | null>;
	readonly boxRef: RefObject<HTMLInputElement | null>;
}) {
	const headingId = useId();
	const { employer } = gift;
	// the box stays open over the name Change was pressed beside until a save answers — a new name,
	// or a fresh saved answer for the same one — while a refusal keeps it open to be corrected.
	const [changing, setChanging] = useState<Changing | null>(null);
	const editing =
		employer === null ||
		(!filed &&
			changing?.employer === employer &&
			(refusal !== null || saved === changing.savedUnder));
	// the box takes the caret on the press that opened it, and Change takes it back on Cancel; never
	// on a first paint, and never on a save, whose answer GiftPage moves the caret for.
	const opened = useRef(false);
	const cancelled = useRef(false);
	const change = useRef<HTMLButtonElement | null>(null);
	useEffect(() => {
		if (editing && opened.current) {
			opened.current = false;
			boxRef.current?.focus();
		} else if (!editing && cancelled.current) {
			cancelled.current = false;
			change.current?.focus();
		}
	}, [editing, boxRef]);

	if (!editing) {
		const remindOn =
			gift.reminderDueAt !== null && gift.remindedAt === null && !filed
				? dayInYear(gift.reminderDueAt)
				: null;
		return (
			<section className="gift-card" aria-labelledby={headingId}>
				<CardHead id={headingId} title={copy.EMPLOYER_HEADING} />
				<div className="gift-employer" tabIndex={-1} ref={shownRef}>
					<span className="gift-employer-name">{employer}</span>
					{/* read with the row when a save's answer puts the caret on it; the row closing over
					    the name is what a sighted donor sees. */}
					{saved === null ? null : <span className="vh">{copy.EMPLOYER_SAVED}</span>}
					{filed ? null : (
						<button
							ref={change}
							type="button"
							className="ds-text-btn ds-text-btn-primary"
							aria-label={copy.CHANGE_EMPLOYER_NAME}
							onClick={() => {
								opened.current = true;
								setChanging({ employer, savedUnder: saved });
							}}
						>
							{copy.CHANGE_EMPLOYER}
						</button>
					)}
				</div>
				{gift.packSentAt === null ? null : (
					<p className="gift-hint">{copy.employerEmailed(dayInYear(gift.packSentAt), remindOn)}</p>
				)}
			</section>
		);
	}

	return (
		<EmployerForm
			key={employer ?? ''}
			headingId={headingId}
			named={employer}
			refusal={refusal}
			pending={pending}
			result={result}
			boxRef={boxRef}
			onCancel={
				employer === null
					? null
					: () => {
							cancelled.current = true;
							setChanging(null);
						}
			}
		/>
	);
}

function EmployerForm({
	headingId,
	named,
	refusal,
	pending,
	result,
	boxRef,
	onCancel
}: {
	readonly headingId: string;
	readonly named: string | null;
	readonly refusal: string | null;
	readonly pending: boolean;
	readonly result: GiftPageResult | undefined;
	readonly boxRef: RefObject<HTMLInputElement | null>;
	/** closes the box on the saved name; `null` where nobody is named yet. */
	readonly onCancel: (() => void) | null;
}) {
	const boxId = useId();
	const hintId = useId();
	const refusalId = useId();
	const [typed, setTyped] = useState(named ?? '');
	const blank = typed.trim() === '';
	// a blank Save marks the box, and from then on the mark follows what is typed.
	const [checked, setChecked] = useState(false);
	const problem = checked && blank ? copy.EMPLOYER_BLANK : refusal;
	const press = usePressOnce(pending, result);
	// the hint is the no-employer card's; a donor changing a named employer has read it.
	const hint = named === null ? copy.EMPLOYER_HINT : undefined;
	const described = [hint === undefined ? null : hintId, problem === null ? null : refusalId]
		.filter((id) => id !== null)
		.join(' ');
	return (
		<Form
			method="post"
			className="gift-card"
			aria-labelledby={headingId}
			// a blank box is refused here with the caret put in it, and the action refuses one that
			// arrives without script; a second submit is refused until the first one's page is drawn.
			onSubmit={(event) => {
				if (blank) {
					event.preventDefault();
					setChecked(true);
					boxRef.current?.focus();
				} else if (!press.claim()) event.preventDefault();
			}}
		>
			<CardHead id={headingId} title={copy.EMPLOYER_HEADING} hint={hint} hintId={hintId} />
			<input type="hidden" name="intent" value="employer" />
			<div className="ds-field">
				<label className="ds-label" htmlFor={boxId}>
					{copy.EMPLOYER_LABEL}
				</label>
				<input
					ref={boxRef}
					className="ds-field-input"
					id={boxId}
					name="employer"
					autoComplete="organization"
					maxLength={MAX_EMPLOYER}
					value={typed}
					onChange={(event) => setTyped(event.target.value)}
					aria-describedby={described === '' ? undefined : described}
					aria-invalid={problem === null ? undefined : true}
				/>
				{problem === null ? null : (
					<p className="ds-field-err" id={refusalId}>
						{problem}
					</p>
				)}
			</div>
			<div className="gift-presses">
				{/* `aria-disabled` rather than `disabled` while a post is out, so Save keeps the focus. */}
				<button
					type="submit"
					className="ds-btn ds-btn-primary"
					aria-disabled={pending || undefined}
					aria-busy={pending || undefined}
				>
					{copy.SAVE_EMPLOYER}
				</button>
				{onCancel === null ? null : (
					<button type="button" className="ds-btn ds-btn-secondary" onClick={onCancel}>
						{copy.CANCEL_EMPLOYER}
					</button>
				)}
			</div>
		</Form>
	);
}

function FiledCard({
	orgName,
	refusal,
	pending,
	result
}: {
	readonly orgName: string;
	readonly refusal: string | null;
	readonly pending: boolean;
	readonly result: GiftPageResult | undefined;
}) {
	const headingId = useId();
	const refusalId = useId();
	const press = usePressOnce(pending, result);
	return (
		<Form
			method="post"
			className="gift-card"
			aria-labelledby={headingId}
			onSubmit={(event) => {
				if (!press.claim()) event.preventDefault();
			}}
		>
			<CardHead id={headingId} title={copy.FILED_HEADING} hint={copy.filedHint(orgName)} />
			<input type="hidden" name="intent" value="filed" />
			<button
				type="submit"
				className="ds-btn ds-btn-primary"
				aria-disabled={pending || undefined}
				aria-busy={pending || undefined}
				aria-describedby={refusal === null ? undefined : refusalId}
			>
				{copy.MARK_FILED}
			</button>
			{refusal === null ? null : (
				<p className="gift-refusal" id={refusalId}>
					{refusal}
				</p>
			)}
		</Form>
	);
}

/** the filed card once filed, or matched, which counts as filed. */
function FiledRow({
	line,
	seen,
	rowRef
}: {
	readonly line: string;
	/** who can see the stamp, under a filed one; a match is the organisation's own news. */
	readonly seen: string | null;
	readonly rowRef: RefObject<HTMLDivElement | null>;
}) {
	return (
		<div className="gift-card">
			<div className="gift-done" role="status" tabIndex={-1} ref={rowRef}>
				<Mark name="done" className="gift-done-mark" />
				<div className="gift-card-head">
					<p className="gift-done-line">{line}</p>
					{seen === null ? null : <p className="gift-hint">{seen}</p>}
				</div>
			</div>
		</div>
	);
}
