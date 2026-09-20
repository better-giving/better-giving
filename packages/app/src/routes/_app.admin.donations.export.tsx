import { Button } from '@better-giving/operator/components/controls/Button';
import { DateRangeField } from '@better-giving/operator/components/forms/DateRangeField';
import { Column, Stack } from '@better-giving/operator/components/shell/Layout';
import { PageHeader } from '@better-giving/operator/components/shell/PageHeader';
import { Brand, type BrandName } from '@better-giving/operator/components/status/Brand';
import { getFormProps } from '@conform-to/react';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { Form, href } from 'react-router';
import { uuidv7 } from 'uuidv7';
import { z } from 'zod';
import type { CrumbHandle } from '$lib/admin/crumbs';
import { screenTitle } from '$lib/admin/screen-title';
import { boxProps, useAdminForm } from '$lib/admin/use-admin-form';
import { defineForm } from '$lib/forms/definition';
import {
	JOURNAL_PRESS_COOKIE,
	JOURNAL_PRESS_FIELD,
	JOURNAL_RANGE_FIELDS,
	JOURNAL_REFUSAL_FIELD,
	JOURNAL_TARGET_LABELS,
	JOURNAL_TARGETS_OFFERED,
	type JournalProblem,
	RANGE_REVERSED,
	readJournalProblem,
	REFUSAL_ON_SCREEN
} from '$lib/ledger/journal-range';
import type { Route } from './+types/_app.admin.donations.export';

// the way out of this deployment's books: a range of days, as the file one accounting package
// imports.
//
// a page of its own under Gifts, reached from the gifts list, because that is where the operator
// asking for it comes from — the gifts are what fills these books, and the books screen is where a
// correction is posted against an entry rather than where the books are read out. **what the file
// holds is every entry the range covers**: the income, the processor's cut and the money received
// per gift, and those corrections beside them.
//
// **the target rides on the press rather than in a box.** one submit per accounting system, each
// carrying its own value under the same wire name, so a package is never something the browser fell
// to: a file is shaped for one importer and named after it, and a target nobody chose is a file
// that imports into the other one as unmatched accounts. the presses are drawn from
// `JOURNAL_TARGETS_OFFERED`, so a third package is a third press and no edit here.
//
// **a press downloads.** the form submits at the file's own address as a document navigation, so
// the browser takes the answer as the download and leaves the operator standing here. nothing is
// checked first and nothing is counted: this screen reads no books at all.
//
// **which is also why the press is held here by hand.** the router is not in that navigation, so
// nothing it offers — `useNavigation`, the bar ./_app.tsx draws — reports a press that is in
// flight, and a live press is the same range read out of the books again. the hold is released by
// the file itself, through the token the press mints and the journal route echoes back as a cookie
// (`$lib/ledger/journal-range.ts`), and it is bounded so an answer that never comes cannot leave
// the press dead.
//
// **so the two kinds of problem reach an operator by two different roads.** the boxes hold what the
// boxes can know — a day missing, the two days the wrong way round — and `RANGE_FORM` below refuses
// a press over either before it is made. everything else is a fact about the books rather than
// about the range, and is only knowable once the file has been asked for: a range holding no entry,
// one longer than a file holds, one holding two currencies.
// ./_app.admin.donations.export_.journal.ts finds those, and sends the operator back here with the
// reason — `problemWords` below is what words it, and the sentence stands under the press it is
// about, described by it, until either end of the range is written in. the reader is put on that
// press where the refusal is an answer to a press of their own, which the press's own token and
// the cookie it comes back with are what say; a refusal merely present on an address moves nobody,
// because an address carrying one is pasted as easily as pressed.
//
// what a range and a target are, and how a refusal travels back, is
// `$lib/ledger/journal-range.ts`; what a file holds is `$lib/server/ledger/journal-file.ts`; and
// the file itself is ./_app.admin.donations.export_.journal.ts's.

/** the address the file is served at, which is where this screen's form submits (./_app.admin.donations.export_.journal.ts). */
const JOURNAL = href('/admin/donations/export/journal');

/** the screen's own name: the heading it draws, the document title, and the last crumb. */
const SCREEN_TITLE = 'Export';

/**
 * the one thing this screen cannot show and an operator has to know before they press.
 *
 * nothing records what a range handed out and nothing is going to, so the same days asked for
 * twice are the same entries handed out twice — into books that may already carry them.
 * `journalNo` in `$lib/server/ledger/journal-file.ts` is what makes the second import visible in
 * the target, and it is visible only there.
 */
const REPEATS =
	'Nothing here records which days have already been exported, so asking for the same days twice hands out the same entries twice.';

/** how often the screen looks for the file's own answer while a press is held. */
const PRESS_LOOK_MS = 150;

/**
 * the longest a press is ever held.
 *
 * the answer it waits for is one round trip over a read bounded at the target's cap, so this is
 * not a timeout in any useful sense — what it is is the floor under an answer that never comes at
 * all, so the worst a dropped request costs is a press that goes again.
 */
const PRESS_HOLD_MS = 20_000;

/**
 * whether the deployment has answered the press called `token`, and the cookie it sent is the whole
 * of the evidence either way: a file carries one to release the press, and a refusal carries one to
 * say a press caused the document that came back.
 *
 * spent as it is read, which is what makes it one press: a reload of the same address a moment
 * later is somebody opening an address rather than pressing. the drop names the same path the
 * journal route wrote it under, because a cookie is only replaceable at its own path — so it is
 * invisible to a spec serving this screen at the document root, where the read above still works.
 *
 * a press with no token is no press: the empty string would otherwise match a cookie left standing
 * with no value.
 */
function pressAnswered(token: string): boolean {
	if (token === '') return false;
	const held = `${JOURNAL_PRESS_COOKIE}=${token}`;
	if (!document.cookie.split('; ').includes(held)) return false;
	// biome-ignore lint/suspicious/noDocumentCookie: the Cookie Store API the rule points at is not in every browser an operator opens /admin in, and the drop has to land wherever the read above just did.
	document.cookie = `${JOURNAL_PRESS_COOKIE}=; Path=${href('/admin/donations/export')}; Max-Age=0; SameSite=Lax`;
	return true;
}

/**
 * what a required box left blank is told, in the shape `REQUIRED` in `$lib/forms/input-schema.ts`
 * states for every field message: the predicate of the label over it, and never the label.
 *
 * the word is stated here rather than imported, the arrangement `$lib/ledger/input-schema.ts` and
 * `$lib/contacts/input-schema.ts` are under: these schemas import from nothing in common.
 */
const REQUIRED = 'required';

/** what the two date boxes hold, as `reversedRangeRule` reads them. */
type RangeBoxes = Record<(typeof JOURNAL_RANGE_FIELDS)['from' | 'to'], string>;

/**
 * refuses a range whose far end stands before its near one, under the far end.
 *
 * under `to` and with `RANGE_REVERSED`'s own sentence, so the box is told the same thing here as
 * `readJournalRange` tells the address — one wording for a refusal that is reachable both ways.
 *
 * the two days are compared as the text the boxes hold. `DateRangeField` submits a day as
 * `YYYY-MM-DD` or nothing at all, and for that shape the lexical order is the calendar order, so
 * reading either one into a `Date` first would buy nothing this rule asks about.
 *
 * an object-level check rather than a field rule, because the rule reads two siblings and a
 * `.check()` on the key cannot — the arrangement `sameAccountRule` in `$lib/ledger/input-schema.ts`
 * is under. it needs no guard of its own for a half-filled range: the `abort` below stops a blank
 * box's field there, and zod skips an object check over an aborted field — so an operator who has
 * written neither day is asked for them rather than told the two days they have not written are
 * the wrong way round.
 */
const reversedRangeRule = z.superRefine<RangeBoxes>((boxes, ctx) => {
	if (boxes[JOURNAL_RANGE_FIELDS.to] < boxes[JOURNAL_RANGE_FIELDS.from]) {
		ctx.addIssue({
			code: 'custom',
			input: boxes[JOURNAL_RANGE_FIELDS.to],
			path: [JOURNAL_RANGE_FIELDS.to],
			message: RANGE_REVERSED
		});
	}
});

/**
 * the range, as the browser checks it before a press navigates.
 *
 * this screen's own and nothing reads it twice: there is no action here, so the statement a form
 * usually makes for both halves is made for one. what the *server* reads the same three values
 * against is `readJournalRange`, which answers an address rather than a body.
 *
 * the boxes are keyed off `JOURNAL_RANGE_FIELDS` rather than spelled again, because conform names
 * each control from the schema's own key — a name written twice is a box the loader never looks at.
 * the target is not among them: it is the pressed button's own value rather than a box, so there is
 * nothing on the screen for a refusal about it to sit under, and a press is the only way to send
 * one.
 */
const RANGE_FORM = defineForm({
	id: 'journal-range',
	schema: z
		.object({
			[JOURNAL_RANGE_FIELDS.from]: z
				.string({ error: REQUIRED })
				.min(1, { error: REQUIRED, abort: true }),
			[JOURNAL_RANGE_FIELDS.to]: z
				.string({ error: REQUIRED })
				.min(1, { error: REQUIRED, abort: true })
		})
		.check(reversedRangeRule)
});

/**
 * what a range the file could not be made of is told, beside the press that asked for it.
 *
 * the screen's words and never the route's: what comes back from ./_app.admin.donations.export_.journal.ts
 * is a code out of a closed set, so the sentence an operator reads is written where the rest of this
 * screen's copy is. each one names what to change about the range, because the range is the two
 * boxes directly above the press.
 *
 * none of the three carries a figure. the cap is the accounting package's own and the currencies are
 * whatever the books hold, and knowing either changes nothing the operator can do: it is a shorter
 * range or a range holding one currency either way. the currencies are still named in the route's
 * text answer for whoever asked it for the file directly; how many lines a range holds is named
 * nowhere at all, because the read stops one line past the cap and nothing counts them
 * (`$lib/server/ledger/queries.ts`).
 *
 * `label` is the package as the press names it, so the sentence and the press it answers say the
 * same word.
 */
function problemWords(problem: JournalProblem, label: string): string {
	switch (problem) {
		case 'nothing_posted':
			return 'Nothing was posted to the books between those two days.';
		case 'too_many_rows':
			return `That range is longer than one ${label} file holds. Ask for a shorter range.`;
		case 'mixed_currency':
			return 'That range holds entries in more than one currency, and one file holds one currency. Ask for a range holding one.';
	}
}

/**
 * the element a refusal's sentence stands in.
 *
 * derived from the target it is about, so a refusal over one package can never be read as the
 * other's. it has to be stable and it has to be this screen's: the press points at it with
 * `aria-describedby`, which is what carries the reason to a reader along with the press's own name
 * the moment it takes focus — the sentence stands under the row both presses are on, so nothing
 * about where it sits says which of them answered.
 */
function refusalId(target: string): string {
	return `export-refusal-${target}`;
}

/**
 * the mark a press draws, per package.
 *
 * written out rather than handed the target's own value, and the two being spelled alike is a
 * coincidence: the packages this app shapes a file for and the brands an operator surface may draw
 * are two separate sets. so a third target added to `JOURNAL_TARGET_LABELS` is a key missing here —
 * a type error — rather than a press quietly wearing another company's logo or none at all.
 */
const TARGET_BRANDS: Record<keyof typeof JOURNAL_TARGET_LABELS, BrandName> = {
	quickbooks: 'quickbooks',
	xero: 'xero'
};

export const handle = {
	crumbs: ({ pathname }) => [
		{ href: href('/admin/donations'), label: 'Gifts' },
		{ href: pathname, label: SCREEN_TITLE }
	]
} satisfies CrumbHandle;

export function meta({ matches }: Route.MetaArgs): Route.MetaDescriptors {
	return [{ title: screenTitle(SCREEN_TITLE, matches) }];
}

// the address and nothing else: this screen reads no books at all. a press goes straight at the
// file, so the only thing left to answer here is what a refused press was sent back with.
export function loader({ request }: Route.LoaderArgs) {
	const params = new URL(request.url).searchParams;

	return {
		// the range as it was asked about, echoed so the boxes go back to holding it and a refusal
		// stands beside the press it came from. the text and never a read value: the boxes take the
		// same `YYYY-MM-DD` the file's own route reads off the address, and a string naming no day
		// opens its box empty.
		asked: {
			from: params.get(JOURNAL_RANGE_FIELDS.from) ?? '',
			to: params.get(JOURNAL_RANGE_FIELDS.to) ?? '',
			target: params.get(JOURNAL_RANGE_FIELDS.target) ?? ''
		},
		// read against the closed set rather than taken off the address, so the screen can only draw
		// a sentence it wrote itself.
		problem: readJournalProblem(params),
		// the press this load is the answer to, as the address names it. it is read against the
		// cookie that came back with it rather than believed: the component is where that happens,
		// because what it decides is where the reader is put.
		answering: params.get(JOURNAL_PRESS_FIELD) ?? '',
		// one press per accounting system, worded here because a component cannot import a value
		// from `$lib/server/**` and `JournalTarget` is that module's. the mark the press draws
		// travels the same way, as the brand's own name rather than as the target's.
		targets: JOURNAL_TARGETS_OFFERED.map((target) => ({
			value: target,
			label: JOURNAL_TARGET_LABELS[target],
			brand: TARGET_BRANDS[target]
		}))
	};
}

// what this page owes is a range the browser can be trusted with, and a range that survives a
// refusal coming back over it with the reason beside the press that asked.
export default function ExportEntries({ loaderData }: Route.ComponentProps) {
	const { answering, asked, problem, targets } = loaderData;

	// no action on this route, so there is never a result to feed back: every refusal this form
	// reports is one the browser found before the press navigated.
	//
	// the seed is the range the address holds, which is what the boxes go back to holding when a
	// refused press sends the operator here over the range that caused it. the hook also resets the
	// form where that seed moves without a fresh document under it, so a range reached by a link
	// leaves the boxes holding it rather than whatever was last typed.
	const [form, fields] = useAdminForm(RANGE_FORM, undefined, {
		defaultValue: { [JOURNAL_RANGE_FIELDS.from]: asked.from, [JOURNAL_RANGE_FIELDS.to]: asked.to }
	});

	const formProps = getFormProps(form);

	/** the box the press's own token is written into on its way out. */
	const token = useRef<HTMLInputElement>(null);

	/**
	 * the refusal this address carries: the press it is about, and the words that stand under the
	 * row.
	 *
	 * read against the targets the loader offers rather than off `asked.target` alone, so an address
	 * naming a package this deployment shapes no file for words nothing and points at nothing.
	 */
	const askedFor = targets.find((target) => target.value === asked.target);
	const arrived =
		problem === null || askedFor === undefined
			? null
			: { target: askedFor.value, words: problemWords(problem, askedFor.label) };

	/**
	 * which refusal this is: the reason and the range it is about, as one value to compare.
	 *
	 * the reason alone is not enough. the same reason over two different ranges is two refusals, and
	 * telling them apart is what says a new one has arrived rather than one standing where it was.
	 */
	const arrivedAs =
		arrived === null ? null : `${problem} ${asked.target} ${asked.from} ${asked.to}`;

	/**
	 * the refusal as the screen holds it, which is until either end of the range is written in.
	 *
	 * it is state and not the loader's value read straight through, because it belongs to the range
	 * that produced it: narrowing the range leaves the sentence standing under the row, still tied
	 * to the press by `aria-describedby`, describing a range that is in neither box. every other
	 * refusal on this screen clears as its box is typed in — `useAdminForm` re-checks on every input
	 * — and this is the same reading with the same lifetime.
	 *
	 * the pair is what a refusal arriving over an open screen re-seeds through: a load carrying a
	 * different one puts the sentence back, and a load carrying the same one does not undo the drop.
	 * set during the render that reads it rather than in an effect, so the stale sentence is never
	 * drawn (https://react.dev/learn/you-might-not-need-an-effect).
	 */
	const [seen, setSeen] = useState(arrivedAs);
	const [standing, setStanding] = useState(arrivedAs !== null);
	if (seen !== arrivedAs) {
		setSeen(arrivedAs);
		setStanding(arrivedAs !== null);
	}
	const refusal = standing ? arrived : null;

	/**
	 * the press a refusal is about, put under the reader where that refusal is an answer to a press
	 * of theirs.
	 *
	 * the reason stands under the row, and a reader who cannot see it is told nothing at all until
	 * they happen to reach that press again — so they are put on it, and `aria-describedby` below is
	 * what reads the reason out with the press's own name.
	 *
	 * **and never on the presence of a refusal, which is the whole of the difference.** an address
	 * carrying one is pasted, bookmarked and restored from history as easily as it is arrived at,
	 * and the operator who opens it pressed nothing. so there are two ways a refusal is one of
	 * theirs and the first render is neither: it is the cookie the redirect carried, which only the
	 * browser that pressed receives and which `pressAnswered` spends
	 * (`$lib/ledger/journal-range.ts`), or it is the refusal *changing* under a screen already open.
	 *
	 * `landedOn` is `undefined` until the first look and the refusal it landed on after it, so the
	 * two readings are told apart without a second flag.
	 */
	const refused = useRef<HTMLButtonElement>(null);
	const landedOn = useRef<string | null | undefined>(undefined);
	useEffect(() => {
		const first = landedOn.current === undefined;
		const already = landedOn.current === arrivedAs;
		landedOn.current = arrivedAs;
		if (arrivedAs === null) return;
		if (first ? !pressAnswered(answering) : already) return;
		refused.current?.focus();
	}, [arrivedAs, answering]);

	/**
	 * the press in flight: the token it was minted with, and the package it asked for.
	 *
	 * the navigation is the browser's rather than the router's, so `useNavigation()` reports
	 * nothing about it and the bar ./_app.tsx draws is not drawn either — a press left to those
	 * would stay live under an operator's hand, and two presses are the same range read out of the
	 * books twice.
	 */
	const [pressed, setPressed] = useState<{ token: string; target: string } | null>(null);

	/**
	 * the hold, released by the file itself.
	 *
	 * a refusal needs nothing here: it redirects, and the hold goes with the document. a file is the
	 * other answer and navigates nothing at all, so what the screen has to read is the cookie the
	 * journal route echoes the press's own token back as — `$lib/ledger/journal-range.ts` argues
	 * that pair. it is looked for rather than waited on because a download raises no event on the
	 * page it was pressed from.
	 *
	 * and the look is bounded: a request that is dropped, refused outside this app or cancelled by
	 * the operator answers with no cookie at all, and a hold with nothing to end it is a press
	 * nobody can make again without reloading the screen.
	 */
	useEffect(() => {
		if (pressed === null) return;
		const release = () => setPressed(null);
		const looking = setInterval(() => {
			if (pressAnswered(pressed.token)) release();
		}, PRESS_LOOK_MS);
		const bound = setTimeout(release, PRESS_HOLD_MS);
		return () => {
			clearInterval(looking);
			clearTimeout(bound);
		};
	}, [pressed]);

	/**
	 * mints the press's own token and holds the press, or lets a press the boxes refuse go nowhere.
	 *
	 * conform's own handler runs first and is what marks the boxes, the arrangement
	 * ./_app.admin.books.tsx's submit is under; a press it stopped never happened and holds nothing.
	 * the token is written onto the box rather than rendered from state because the browser builds
	 * the body after this handler returns, and there is no render between a press and its
	 * navigation.
	 */
	function onSubmit(event: FormEvent<HTMLFormElement>) {
		if (pressed !== null) {
			event.preventDefault();
			return;
		}
		formProps.onSubmit(event);
		if (event.defaultPrevented) return;
		const minted = uuidv7();
		if (token.current !== null) token.current.value = minted;
		const submitter = (event.nativeEvent as SubmitEvent).submitter;
		setPressed({
			token: minted,
			target: submitter instanceof HTMLButtonElement ? submitter.value : ''
		});
	}

	return (
		// the narrow measure: every control here is a box or a press, and none of them is a table.
		<Column>
			{/* the screen's own `h1`: the frame draws the trail in its top strip for a screen stating
			    one and no heading beside it (./_app.tsx), so a screen that draws none has no heading
			    at all. the trail ends in this same word, which is what keeps this to the one word —
			    the standfirst is the only sentence on the screen, and it is there because the thing
			    it says is the one thing a range, a row of packages and a file leave no trace of. */}
			<PageHeader title={SCREEN_TITLE} standfirst={REPEATS} />
			{/* a `get` at the file's own address, and `reloadDocument` because the answer is a file
			    rather than a screen: react router would try to route to it
			    (react-router/docs/how-to/resource-routes.md), where the browser takes it as the
			    download and leaves the operator standing here. `discover="none"` for the same reason
			    one step earlier: the router would otherwise fetch this address's manifest entry on
			    render, for a route it is never going to be asked to draw. that is also why the box
			    below rides inside the form rather than in the `action` — a `get` form replaces the
			    whole query string of whatever it submits to, so an `action` carrying one would lose it.

			    `getFormProps` carries the form's own id and its `noValidate`, which is what takes the
			    browser's own bubble off the page and leaves `RANGE_FORM` above as the one thing
			    refusing a range before it is asked for. its submit handler is not spread on with the
			    rest: `onSubmit` above runs it first and reads what it did, and a press it refused
			    stops the browser's navigation exactly as it stopped the router's. */}
			<Form
				method="get"
				action={JOURNAL}
				reloadDocument
				discover="none"
				{...formProps}
				onSubmit={onSubmit}
				// the refusal above goes at the first day written into either end, which is the same
				// event `useAdminForm` re-checks the boxes on: `DateRangeField` writes a settled day
				// onto the control that end submits through and dispatches this from it, so what
				// reaches here is a day landing rather than a keystroke.
				onInput={() => setStanding(false)}
			>
				<Stack>
					{/* the two days as one question, named once above them, so each box says which end
					    of that range it is rather than naming the range again.

					    the pair's own message row goes undrawn: `error` here is an end's own. the one
					    refusal a range can be walked into is the far end standing before the near one, and
					    `reversedRangeRule` above puts that under `to`: the box that is wrong is the one the
					    operator changes. */}
					<DateRangeField
						id={`${form.id}-days`}
						legend="Date range"
						from={{ label: 'From', ...boxProps(fields.from) }}
						to={{ label: 'To', ...boxProps(fields.to) }}
					/>
					{/* what tells the file's route that this press was made on a screen, so a range no
					    file can be made of comes back here to be worded rather than being answered as
					    the text a hand-typed address gets. `$lib/ledger/journal-range.ts` argues it. */}
					<input type="hidden" name={JOURNAL_REFUSAL_FIELD} value={REFUSAL_ON_SCREEN} />
					{/* what this press is called, written by `onSubmit` above on the way out and echoed
					    back on the file as the cookie that lets the press go again. it is empty in the
					    markup and uncontrolled: a token rendered from state would be one minted before
					    anybody pressed. */}
					<input type="hidden" name={JOURNAL_PRESS_FIELD} ref={token} />
					{/* what the row does, written once over it rather than onto each press: the presses are
					    the packages, and a package named twice on one line is the same word read as two
					    different things. the run is tight, so the name, the presses and the sentence a refusal
					    leaves under them read as one block. */}
					<Stack tight>
						<p className="adm-caption">Export to</p>
						<div className="adm-actions">
							{targets.map((target) => {
								const answered = refusal?.target === target.value;
								return (
									<Button
										key={target.value}
										type="submit"
										name={JOURNAL_RANGE_FIELDS.target}
										value={target.value}
										ref={answered ? refused : undefined}
										// held while a file is on its way, with `aria-disabled` rather than
										// `disabled`: the press is where the reader is standing, and a
										// disabled control cannot keep focus or be read out. the press
										// that asked says so as well, which is what draws the dots.
										aria-busy={pressed?.target === target.value || undefined}
										aria-disabled={pressed !== null || undefined}
										// only where there is a sentence to read: a description resolving to the empty
										// string is one announced as nothing, which is a press that claims to be
										// explained and is not.
										aria-describedby={answered ? refusalId(target.value) : undefined}
									>
										{/* the package's own logo, and it takes no label: it stands beside that
										    company's own name in the press's own text, which is the case `BrandProps` in
										    packages/operator/src/components/status/Brand.jsx leaves unlabelled — with one,
										    the press announces the package twice. */}
										<Brand name={target.brand} />
										{target.label}
									</Button>
								);
							})}
						</div>
						{/* one sentence and never one per press: the range was shaped for one package, and the
						    same words under the other would be about a file nobody asked for. no live region
						    around it, and none is wanted: what reads it out is the press taking focus as the
						    refusal arrives, and a region would say the same words a second time. on the load
						    that merely carries one nothing is announced, because nothing happened — the
						    operator opened an address. */}
						{refusal === null ? null : (
							<span className="adm-hint" id={refusalId(refusal.target)}>
								{refusal.words}
							</span>
						)}
					</Stack>
				</Stack>
			</Form>
		</Column>
	);
}
