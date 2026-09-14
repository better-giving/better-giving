import { Modal } from '@better-giving/operator/behaviour/Dialog';
import { Button } from '@better-giving/operator/components/controls/Button';
import { EmptyState } from '@better-giving/operator/components/data/EmptyState';
import { CheckboxGroup } from '@better-giving/operator/components/forms/CheckboxGroup';
import { Field } from '@better-giving/operator/components/forms/Field';
import { PairedFieldset } from '@better-giving/operator/components/forms/PairedFieldset';
import { SelectWithNote } from '@better-giving/operator/components/forms/SelectWithNote';
import { Column, Stack } from '@better-giving/operator/components/shell/Layout';
import { PageHeader } from '@better-giving/operator/components/shell/PageHeader';
import { Banner } from '@better-giving/operator/components/status/Banner';
import { StatusWord } from '@better-giving/operator/components/status/StatusWord';
import { getFormProps } from '@conform-to/react';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { data, Form, href, Link, useFetcher, useNavigation } from 'react-router';
import { uuidv7 } from 'uuidv7';
import type { CrumbHandle } from '$lib/admin/crumbs';
import { screenTitle } from '$lib/admin/screen-title';
import { boxProps, useAdminForm } from '$lib/admin/use-admin-form';
import { CONTACT_FIELD_LABELS, MAX_DONOR_SEARCH } from '$lib/contacts/input-schema';
import { CONTACT_KINDS, type ContactKind, KIND_LABELS } from '$lib/contacts/kinds';
import { GIFT_FIELD_LABELS, GIFT_IN_HAND_INPUT } from '$lib/donations/input-schema';
import {
	IN_HAND_METHOD_LABELS,
	IN_HAND_METHOD_PHRASES,
	IN_HAND_METHODS,
	type InHandMethod
} from '$lib/donations/methods';
import { formatMinor } from '$lib/donations/money';
import { FORM_CURRENCY, readAmount } from '$lib/forms/amounts';
import { defineForm } from '$lib/forms/definition';
import { readAccountingDate } from '$lib/ledger/input-schema';
import { parseContact } from '$lib/server/contacts/contact-input';
import { findContactById } from '$lib/server/contacts/queries';
import { invalid, parseForm } from '$lib/server/conform';
import { loadFailed } from '$lib/server/db/load-failure';
import { createEmailProvider } from '$lib/server/email/factory';
import { findRecordedGift, type RecordedGift } from '$lib/server/donations/queries';
import { sendReceipt } from '$lib/server/donations/receipt';
import { recordGiftInHand, type InHandDonor } from '$lib/server/donations/record-in-hand';
import { redirectWithFlash, SAVED_FLASH, takeFlash } from '$lib/server/flash';
import { readActivePrograms } from '$lib/server/programs/queries';
import { database, platform } from '../context';
import type { Route } from './+types/_app.admin.donations.new';
import type { loader as searchLoader } from './_app.admin.donors.search';

// adding a donation that arrived in hand — cash or a cheque — filed under a donor the operator
// searches for or creates on the spot, posted to the books, and receipted only if they tick the box.
//
// a page of its own, reached from Gifts, so the gifts page opens on the list.
//
// **the ids are minted in the loader and carried hidden**, so one press is one gift: a second press
// of the same ids is refused at the database by `recordGiftInHand`. every answer that stays on this
// screen — a refusal, a gift already recorded, a write that failed — carries a 4xx or 5xx, and react
// router does not revalidate a loader after one, so the ids the page holds stay the ones the press
// was sent under while the boxes still hold what it sent; a press over changed boxes takes a fresh
// pair (`postingIds` in the component), and the action refuses a different gift under held ids
// rather than calling it already recorded. a gift that lands redirects to this screen's own GET,
// which mints a fresh pair and clears the boxes, and the outcome rides the redirect as a flash to be
// stated at the button.
//
// the donor is one region with three arms: searching (a box asking ./_app.admin.donors.search.ts as
// the operator types, and the matches as choices), a donor attached, and creating one. which arm is
// showing is this component's state, and `donor` in the body is what tells the action.
//
// the rules are not here: what a box may hold is `$lib/donations/input-schema.ts`, which name a new
// donor needs is `parseContact`, and what a gift in hand writes is
// `$lib/server/donations/record-in-hand.ts`.

/** the form, stated once for the action that reads a body against it and the screen that submits to it. */
const GIFT_FORM = defineForm({ id: 'donation-add', schema: GIFT_IN_HAND_INPUT });

/** the screen's name, as the document title, the heading and the last crumb. */
const SCREEN_TITLE = 'Add a donation';

/**
 * what a write that failed says, keyed to no box.
 *
 * it does not claim nothing was recorded, because it cannot know: a `batch()` that commits and then
 * loses the connection reads like one that never ran. an unchanged press is safe because it carries
 * the ids the failed one did, and a gift that landed refuses them; a press with changed details takes
 * a fresh pair, which nothing refuses — so it sends the operator to Gifts first.
 */
const WRITE_FAILED =
	'Adding this donation failed, and it may have been recorded anyway. Press again with nothing changed, which cannot record it twice. Check Gifts before pressing with changed details.';

/**
 * what a press is told when the ids it carried already stand for a different gift.
 *
 * nothing this press asked for was written, and the ids that come back with it are a fresh pair, so
 * pressing again adds the boxes as they are.
 */
const ID_HELD =
	'This press matched an earlier gift with different details, so it was not added. Press again to add it.';

/** what a donor id no donor on file answers to is told, on the donor that was picked. */
const NO_SUCH_DONOR = 'That donor is no longer on file. Choose someone else.';

/** what a cause no longer offered is told. */
const NO_SUCH_PROGRAM = 'That program is no longer offered. Reload the page and choose again.';

/** the blank the program box opens on, which is also what says the box is optional. */
const NO_PROGRAM = { value: '', label: 'No program' };

/** how the donor a gift was filed under came to be the one. */
const FILINGS = ['picked', 'created', 'matched'] as const;
type Filing = (typeof FILINGS)[number];

/** what the receipt did, where one was asked for. `none` is a box left unticked. */
const RECEIPTS = ['none', 'sent', 'no_address', 'not_sent'] as const;
type Receipt = (typeof RECEIPTS)[number];

type Landing = { readonly donationId: string; readonly filing: Filing; readonly receipt: Receipt };

/** the flash a landed gift leaves: three words, and never a sentence (`$lib/server/flash.ts`). */
function landingMarker(landing: Landing): string {
	return `${landing.donationId}:${landing.filing}:${landing.receipt}`;
}

/** the marker read back, or `null` for one this screen did not write. */
function readLanding(marker: string | null): Landing | null {
	const [donationId, filing, receipt, ...rest] = (marker ?? '').split(':');
	if (rest.length > 0 || !donationId) return null;
	const knownFiling = FILINGS.find((f) => f === filing);
	const knownReceipt = RECEIPTS.find((r) => r === receipt);
	if (knownFiling === undefined || knownReceipt === undefined) return null;
	return { donationId, filing: knownFiling, receipt: knownReceipt };
}

/** a pair of ids for a gift and its payment, as the loader mints them. */
type GiftIds = { readonly donationId: string; readonly paymentId: string };

function freshIds(): GiftIds {
	return { donationId: uuidv7(), paymentId: uuidv7() };
}

/**
 * what every answer that stays on this screen carries beside its rejection, in one shape — so the
 * page reads each key off the action's own type rather than narrowing arm by arm.
 *
 *   freshIds      — the pair a press over changed boxes takes, after a write that may have landed.
 *   releasedId    — held ids the database holds a different gift under; a press never reuses them.
 *   recordedAgain — the gift an earlier press recorded under these ids, and what this press's
 *                   receipt did.
 */
type Answered = {
	readonly freshIds: GiftIds | null;
	readonly releasedId: string | null;
	readonly recordedAgain: { readonly donationId: string; readonly receipt: Receipt } | null;
};

function answered(over: Partial<Answered> = {}): Answered {
	return { freshIds: null, releasedId: null, recordedAgain: null, ...over };
}

/**
 * whether the gift the database holds under a press's ids is the gift that press submitted.
 *
 * what a refused duplicate is checked against before it is answered as already recorded: the figure,
 * the day, how it arrived, the cause, the source and the donor. a new donor is compared the way
 * `resolveDonor` in `$lib/server/donations/donor.ts` files one — by address where one was given, since
 * an address on file files the gift under that contact whatever name was typed, and by name where
 * none was.
 */
function isSubmitted(
	found: RecordedGift,
	submitted: {
		readonly amountMinor: number;
		readonly receivedAt: Date;
		readonly method: InHandMethod;
		readonly programId: string | null;
		readonly source: string | null;
		readonly donor:
			| { readonly kind: 'existing'; readonly contactId: string }
			| { readonly kind: 'new'; readonly email: string | null; readonly name: string };
	}
): boolean {
	const { donor } = submitted;
	const sameDonor =
		donor.kind === 'existing'
			? found.contactId === donor.contactId
			: donor.email === null
				? found.donorName === donor.name
				: found.donorEmail?.toLowerCase() === donor.email.toLowerCase();
	return (
		sameDonor &&
		found.totalMinor === submitted.amountMinor &&
		found.receivedAt.getTime() === submitted.receivedAt.getTime() &&
		found.method === submitted.method &&
		found.programId === submitted.programId &&
		found.source === submitted.source
	);
}

export const handle = {
	crumbs: ({ pathname }) => [
		{ href: href('/admin/donations'), label: 'Gifts' },
		{ href: pathname, label: SCREEN_TITLE }
	]
} satisfies CrumbHandle;

export function meta({ matches }: Route.MetaArgs): Route.MetaDescriptors {
	return [{ title: screenTitle(SCREEN_TITLE, matches) }];
}

export async function loader({ context, request }: Route.LoaderArgs) {
	const db = context.get(database);

	let programs: Awaited<ReturnType<typeof readActivePrograms>>;
	try {
		programs = await readActivePrograms(db);
	} catch (e) {
		console.error('reading the programs for a gift failed:', e);
		loadFailed('This page');
	}

	// taken after the read above, so a screen that could not be drawn burns no marker.
	const flash = await takeFlash(request, SAVED_FLASH);
	const landing = readLanding(flash?.marker ?? null);

	// the figures a landed gift is stated with. a read that fails costs the figures and not the
	// outcome: the gift is recorded either way, and the button still says so.
	let gift: Awaited<ReturnType<typeof findRecordedGift>> = null;
	if (landing !== null) {
		try {
			gift = await findRecordedGift(db, landing.donationId);
		} catch (e) {
			console.error('reading back a recorded gift failed:', e);
		}
	}

	return data(
		{
			...freshIds(),
			programs: programs.map((p) => ({ value: p.id, label: p.name })),
			landed:
				landing === null
					? null
					: {
							filing: landing.filing,
							receipt: landing.receipt,
							gift:
								gift === null
									? null
									: {
											amount: formatMinor(gift.totalMinor, gift.currency),
											donorName: gift.donorName,
											// the day only: it was stored as that day's UTC midnight.
											receivedOn: gift.receivedAt.toISOString().slice(0, 10)
										}
						}
		},
		flash === null ? undefined : { headers: { 'Set-Cookie': flash.clear } }
	);
}

/**
 * record one gift in hand.
 *
 * **the request body is read exactly once, here, by the action that owns it.**
 */
export async function action({ context, request }: Route.ActionArgs) {
	const body = await request.formData();
	const submission = parseForm(body, GIFT_FORM);

	// run whether or not the schema was happy, so a box the schema refused and a name the parser
	// refuses come back in one pass. only on the create arm: the other two submit its boxes empty.
	const creating = body.get('donor') === 'new';
	const contact = creating ? parseContact(contactValues(body)) : null;

	if (!submission.ok || (contact !== null && !contact.ok)) {
		const fieldErrors: Record<string, string[]> = {};
		if (contact !== null && !contact.ok) {
			for (const [field, sentence] of Object.entries(contact.errors))
				fieldErrors[field] = [sentence];
		}
		return invalid(400, submission.reject({ fieldErrors }), answered());
	}

	const gift = submission.value;
	// the same two reads the schema's checks already made, read for the value this time.
	const money = readAmount(gift.amount, FORM_CURRENCY);
	const dated = readAccountingDate(gift.received_on);
	if (money.minor === null || dated.at === null) {
		// unreachable past the schema, which refuses on exactly these two reads.
		return invalid(
			400,
			submission.reject({
				fieldErrors: {
					...(money.problem === null ? {} : { amount: [money.problem] }),
					...(dated.problem === null ? {} : { received_on: [dated.problem] })
				}
			}),
			answered()
		);
	}

	const db = context.get(database);

	let picked: Awaited<ReturnType<typeof findContactById>> = null;
	let programName: string | null = null;
	try {
		if (!creating) picked = await findContactById(db, gift.contact_id);
		if (gift.program_id !== '') {
			const offered = await readActivePrograms(db);
			programName = offered.find((p) => p.id === gift.program_id)?.name ?? null;
		}
	} catch (e) {
		console.error('reading the donor or program for a gift failed:', e);
		return invalid(
			500,
			submission.reject({ formErrors: [WRITE_FAILED] }),
			answered({ freshIds: freshIds() })
		);
	}

	// an archived donor is off the search, so an id naming one is a page left open across the
	// archive; a gift filed under them would vanish from the donor file.
	const donorGone = !creating && (picked === null || picked.archivedAt !== null);
	const programGone = gift.program_id !== '' && programName === null;
	if (donorGone || programGone) {
		return invalid(
			400,
			submission.reject({
				fieldErrors: {
					...(donorGone ? { contact_id: [NO_SUCH_DONOR] } : {}),
					...(programGone ? { program_id: [NO_SUCH_PROGRAM] } : {})
				}
			}),
			answered()
		);
	}

	const donor: InHandDonor =
		contact?.ok === true
			? { kind: 'new', contact: contact.value }
			: { kind: 'existing', contactId: gift.contact_id };

	const amountMinor = money.minor;
	const receivedAt = dated.at;
	const programId = gift.program_id === '' ? null : gift.program_id;
	const source = gift.source === '' ? null : gift.source;

	// the donor's receipt, sent the way the webhook path sends one, to the contact the gift is filed
	// under: on the create arm an address already on file files it under that contact, and the receipt
	// is theirs. `sendReceipt` claims the gift's stamp before it sends, so a gift an earlier press
	// already receipted is sent nothing. a read that fails reports the receipt as not sent.
	async function receiptFor(filedUnder: string): Promise<Receipt> {
		let receiptDonor = picked;
		try {
			receiptDonor ??= await findContactById(db, filedUnder);
		} catch (e) {
			console.error('reading the donor to receipt a gift failed:', e);
			return 'not_sent';
		}
		if (receiptDonor === null) return 'not_sent';

		return sendReceipt(
			{ db, email: createEmailProvider(context.get(platform).env) },
			{
				donationId: gift.donation_id,
				donorName: receiptDonor.displayName,
				donorEmail: receiptDonor.primaryEmail,
				contribution: {
					totalMinor: amountMinor,
					// no fee on a gift in hand, and nothing given in exchange.
					nonDeductibleMinor: 0,
					coveredFeeMinor: 0,
					currency: FORM_CURRENCY,
					receivedAt
				},
				tribute: null,
				program: programName
			}
		);
	}

	const recorded = await recordGiftInHand(db, {
		donationId: gift.donation_id,
		paymentId: gift.payment_id,
		donor,
		amountMinor,
		dated: receivedAt,
		method: gift.method,
		programId,
		source
	});

	if (!recorded.ok && recorded.reason === 'write_failed') {
		// a fresh pair rides back beside it for a press whose boxes have changed by then: a `batch()`
		// that commits and then loses the connection reads like one that never ran, so the ids this
		// write was sent under may already stand for it. an unchanged press keeps them and is refusable
		// as a duplicate.
		return invalid(
			500,
			submission.reject({ formErrors: [WRITE_FAILED] }),
			answered({ freshIds: freshIds() })
		);
	}

	if (!recorded.ok) {
		console.info('a gift in hand was presented twice under one id:', gift.donation_id);

		// what the database holds under these ids, read back rather than assumed: a press presenting
		// them over different boxes — or ids no gift answers to, which only a payment id already taken
		// can reach — is refused, never answered as already recorded, which would tell the operator a
		// gift is in the books that nothing wrote. a read that fails cannot tell, so it is answered as
		// the write failing, where an unchanged press is still the safe one.
		let found: RecordedGift | null;
		try {
			found = await findRecordedGift(db, gift.donation_id);
		} catch (e) {
			console.error('reading back a gift presented twice failed:', e);
			return invalid(
				500,
				submission.reject({ formErrors: [WRITE_FAILED] }),
				answered({ freshIds: freshIds() })
			);
		}
		const submitted = {
			amountMinor,
			receivedAt,
			method: gift.method,
			programId,
			source,
			donor:
				contact?.ok === true
					? {
							kind: 'new' as const,
							email: contact.value.primaryEmail,
							name: contact.value.displayName
						}
					: { kind: 'existing' as const, contactId: gift.contact_id }
		};
		if (found === null || !isSubmitted(found, submitted)) {
			return invalid(
				409,
				submission.reject({ formErrors: [ID_HELD] }),
				answered({ freshIds: freshIds(), releasedId: gift.donation_id })
			);
		}

		// neither done nor refused: an earlier press recorded this gift. whether that press receipted
		// it is not known here — a write that committed and reported failure sent nothing — so a ticked
		// box asks again. a 409 rather than a 200 so the page is not revalidated onto fresh ids over
		// boxes still holding the gift.
		const receipt: Receipt = gift.send_receipt ? await receiptFor(found.contactId) : 'none';
		return invalid(
			409,
			submission.reject(),
			answered({ recordedAgain: { donationId: gift.donation_id, receipt } })
		);
	}

	const filing: Filing = !creating ? 'picked' : recorded.donorWasCreated ? 'created' : 'matched';
	const receipt: Receipt = gift.send_receipt ? await receiptFor(recorded.contactId) : 'none';

	return redirectWithFlash(
		request,
		SAVED_FLASH,
		href('/admin/donations/new'),
		landingMarker({ donationId: gift.donation_id, filing, receipt })
	);
}

/** the create arm's boxes as `parseContact` takes them: every one a string or absent. */
function contactValues(body: FormData): Partial<Record<(typeof CREATE_BOXES)[number], string>> {
	const values: Partial<Record<(typeof CREATE_BOXES)[number], string>> = {};
	for (const box of CREATE_BOXES) {
		const value = body.get(box);
		if (typeof value === 'string') values[box] = value;
	}
	return values;
}

/** a donor as the search answers with one. */
type DonorMatch = NonNullable<Awaited<ReturnType<typeof searchLoader>>['matches']>[number];

/** which arm of the donor region is showing, and what it holds. */
type Region =
	| { readonly arm: 'searching'; readonly typed: string }
	| { readonly arm: 'picked'; readonly donor: DonorMatch }
	| { readonly arm: 'creating'; readonly kind: ContactKind; readonly email: string };

const SEARCHING: Region = { arm: 'searching', typed: '' };

/** the new donor's boxes that choose between kinds — every other one is always drawn on the create arm. */
const NAME_BOXES: Record<ContactKind, readonly NameBox[]> = {
	individual: ['first_name', 'last_name'],
	organization: ['legal_name'],
	household: ['display_name']
};
type NameBox = 'first_name' | 'last_name' | 'legal_name' | 'display_name';
const CREATE_BOXES = [
	'kind',
	'first_name',
	'last_name',
	'legal_name',
	'display_name',
	'primary_email',
	'primary_phone'
] as const;

/** the operator's own calendar day, as the browser's clock and zone read it. */
function localDay(at: Date): string {
	const pad = (n: number) => String(n).padStart(2, '0');
	return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}

/**
 * the boxes a gift is, rather than the press that records it: what `boxesOf` compares.
 *
 * the two ids are what the comparison decides. the receipt tick and the search text write nothing
 * about the gift, so ticking the box after a failed write, or retyping a search, keeps the ids the
 * gift may already stand under — a fresh pair there would record it a second time.
 */
const NOT_THE_GIFT = new Set(['donation_id', 'payment_id', 'send_receipt', 'donor_search']);

/**
 * what the boxes hold, as one comparable value. `postingIds` in the component reads it.
 */
function boxesOf(form: HTMLFormElement | null): string {
	if (form === null) return '';
	const entries = [...new FormData(form)].filter(([name]) => !NOT_THE_GIFT.has(name));
	return JSON.stringify(entries.map(([name, value]) => [name, String(value)]));
}

/** what the confirm dialog states, read off the boxes at the press that opened it. */
type Asked = {
	readonly gift: string;
	readonly program: string | null;
	readonly source: string | null;
	readonly receipt: string;
};

// what this page owes is a donor found or made in one region, every refusal beside its box from the
// first press, a press that itemises the gift before it records it, and the outcome at the button.
export default function AddDonation({ loaderData, actionData }: Route.ComponentProps) {
	const { donationId, paymentId, programs, landed } = loaderData;

	// the operator's own day, filled in once the page is in the browser — the server's clock is UTC
	// and a different day on the first client pass would not hydrate.
	const [today, setToday] = useState('');
	useEffect(() => setToday(localDay(new Date())), []);

	// the ids are in the seed, so a landed gift — which arrives with a fresh pair — resets the boxes.
	// the program is seeded blank because a reset writes nothing-chosen into a select the seed does not
	// name, and a select with nothing chosen submits no value — refused as a form that did not arrive.
	// the day filling in after mount is itself a seed change, so that reset runs on every load.
	const [form, fields] = useAdminForm(GIFT_FORM, actionData, {
		defaultValue: { received_on: today, donation_id: donationId, program_id: '' }
	});

	// the region belongs to the ids it was set under, so a landed gift opens the next one searching.
	const [held, setHeld] = useState<{ readonly for: string; readonly region: Region }>({
		for: donationId,
		region: SEARCHING
	});
	const region = held.for === donationId ? held.region : SEARCHING;

	// focus after an arm swap: the control that was pressed is replaced, so focus is moved to the
	// box the new arm leads with rather than left on the body. by name, because a choice row's input
	// carries no id of its own (`CheckboxGroup`).
	const formRef = useRef<HTMLFormElement>(null);
	const focusNext = useRef<string | null>(null);
	useEffect(() => {
		if (focusNext.current === null) return;
		formRef.current
			?.querySelector<HTMLElement>(`[name="${focusNext.current}"]:not([type="hidden"])`)
			?.focus();
		focusNext.current = null;
	});
	/**
	 * the gift a landing reported, per load, until the operator moves on from it — a press on the
	 * fresh form (a refusal the browser catches included, which leaves no action data) or any box
	 * changing. the outcome is about the gift before, and beside new marks it reads as about this one.
	 */
	const [movedOn, setMovedOn] = useState<string | null>(null);
	const moveOn = () => setMovedOn(donationId);
	const swap = (next: Region, focusName: string) => {
		moveOn();
		focusNext.current = focusName;
		setHeld({ for: donationId, region: next });
	};

	const search = useFetcher<typeof searchLoader>();
	const typed = region.arm === 'searching' ? region.typed.trim().slice(0, MAX_DONOR_SEARCH) : '';
	const answer = search.data !== undefined && search.data.q === typed ? search.data : null;
	// the last answer stays drawn while the next is on its way, so the list does not blink per keystroke.
	const shown = typed === '' ? null : (answer ?? search.data ?? null);

	// unticked whenever the screen opens, a landed gift's fresh form included.
	const [tick, setTick] = useState({ for: donationId, on: false });
	const ticked = tick.for === donationId && tick.on;
	const receiptBlocked =
		region.arm === 'picked'
			? region.donor.primaryEmail === null
				? 'This donor has no email address, so no receipt can be sent.'
				: null
			: region.arm === 'creating' && region.email.trim() === ''
				? 'No email address is entered, so no receipt can be sent.'
				: null;

	const navigation = useNavigation();
	const screen = href('/admin/donations/new');
	const adding = navigation.state !== 'idle' && navigation.formAction === screen;

	const lastAnswer: Answered | null = actionData ?? null;

	/** what the last confirmed press submitted, and the ids it was sent under — per load. */
	const [sent, setSent] = useState<{
		readonly for: string;
		readonly boxes: string;
		readonly ids: GiftIds;
	} | null>(null);
	/** what the boxes hold now, read on every edit and every arm swap. */
	const [current, setCurrent] = useState<string | null>(null);
	const holding = sent !== null && sent.for === donationId && sent.boxes === current;

	/**
	 * the ids the next press adds the gift under — `postingId` in ./_app.admin.books.tsx, for two ids.
	 *
	 * the last press's pair, while every box holds exactly what that press submitted — so a double
	 * press, a retry after a write whose outcome could not be read, and an edit undone back all present
	 * ids the database may already hold, and are refused there as a duplicate. any other press is a
	 * different gift and takes the fresh pair the page holds: the one a refusal handed back, or else the
	 * one the latest load minted. a pair the action released stands for a different gift, so a press
	 * over the same boxes takes the fresh pair rather than meeting that refusal again.
	 */
	const postingIds: GiftIds =
		holding && sent.ids.donationId !== lastAnswer?.releasedId
			? sent.ids
			: (lastAnswer?.freshIds ?? { donationId, paymentId });

	// an arm swap changes the boxes with no input event, so the boxes are read again after one.
	useEffect(() => {
		setCurrent(boxesOf(formRef.current));
	}, [region]);

	const again = lastAnswer?.recordedAgain ?? null;
	const recordedAgain =
		again !== null && holding && sent.ids.donationId === again.donationId ? again : null;

	// a refusal about the attempt as a whole. the hidden boxes have no control to sit under, so a
	// refusal keyed to one is read as the form's rather than rendered nowhere.
	const refusal =
		form.errors?.[0] ??
		fields.donation_id.errors?.[0] ??
		fields.payment_id.errors?.[0] ??
		fields.donor.errors?.[0];

	const [asking, setAsking] = useState<Asked | null>(null);
	const confirmed = useRef(false);
	const formProps = getFormProps(form);

	function onSubmit(event: FormEvent<HTMLFormElement>) {
		moveOn();
		// the button's own guard covers a click; this covers enter in a box while a press is in flight.
		if (adding) {
			event.preventDefault();
			return;
		}
		formProps.onSubmit(event);
		const answering = confirmed.current;
		confirmed.current = false;
		if (event.defaultPrevented) return;
		if (answering) {
			const boxes = boxesOf(event.currentTarget);
			setSent({ for: donationId, boxes, ids: postingIds });
			setCurrent(boxes);
			setAsking(null);
			return;
		}

		event.preventDefault();
		// read now as well as on every edit, so the ids the confirm submits under are decided over the
		// boxes as they stand at the press.
		setCurrent(boxesOf(event.currentTarget));
		const values = new FormData(event.currentTarget);
		const value = (name: string) => String(values.get(name) ?? '');
		const { minor } = readAmount(value('amount'), FORM_CURRENCY);
		const method = IN_HAND_METHODS.find((m) => m === value('method'));
		if (minor === null || method === undefined) return;

		const receiptTo =
			region.arm === 'picked' ? region.donor.primaryEmail : value('primary_email').trim();
		setAsking({
			gift: `${formatMinor(minor, FORM_CURRENCY)} from ${donorNameOf(region, value)}, received ${value('received_on')}, ${IN_HAND_METHOD_PHRASES[method]}.`,
			program: programs.find((p) => p.value === value('program_id'))?.label ?? null,
			source: value('source').trim() || null,
			receipt:
				values.get('send_receipt') !== null && receiptTo
					? `A receipt will be emailed to ${receiptTo}.`
					: 'No receipt will be sent.'
		});
	}

	return (
		<Column>
			<PageHeader title={SCREEN_TITLE} />

			{/* no `action` attribute, so this posts to the current url. `preventScrollReset`
			    because every answer lands on this same screen, at the button that was pressed. */}
			<Form
				method="post"
				preventScrollReset
				{...formProps}
				ref={formRef}
				onSubmit={onSubmit}
				onInput={(event) => {
					moveOn();
					setCurrent(boxesOf(event.currentTarget));
				}}
				onChange={(event) => {
					moveOn();
					setCurrent(boxesOf(event.currentTarget));
				}}
			>
				<Stack>
					{/* the ids this gift is written under, which the database is asked to refuse a second
					    time. what they hold is `postingIds` above, which is where the rule is. react's
					    `value`, so the boxes follow it. */}
					<input type="hidden" name={fields.donation_id.name} value={postingIds.donationId} />
					<input type="hidden" name={fields.payment_id.name} value={postingIds.paymentId} />
					<input
						type="hidden"
						name={fields.donor.name}
						value={region.arm === 'creating' ? 'new' : 'existing'}
					/>

					<fieldset className="adm-fieldset">
						<legend className="adm-fieldset__legend">Donor</legend>
						{region.arm === 'searching' ? (
							<>
								<Field
									label={GIFT_FIELD_LABELS.donor_search}
									type="search"
									autoComplete="off"
									{...boxProps(fields.donor_search)}
									onChange={(event) => {
										const text = event.currentTarget.value;
										setHeld({ for: donationId, region: { arm: 'searching', typed: text } });
										const q = text.trim().slice(0, MAX_DONOR_SEARCH);
										if (q !== '') {
											search.load(`${href('/admin/donors/search')}?q=${encodeURIComponent(q)}`);
										}
									}}
									onKeyDown={(event) => {
										// enter in the search box is a search, never the gift's press.
										if (event.key === 'Enter') event.preventDefault();
									}}
								/>
								<input type="hidden" name={fields.contact_id.name} value="" />
								{shown === null ? null : shown.matches === null ? (
									<Banner tone="attention" word="Donors could not be searched" />
								) : shown.matches.length === 0 ? (
									answer === null ? null : (
										<EmptyState>Nobody matches “{typed}”.</EmptyState>
									)
								) : (
									<CheckboxGroup
										id="donation-add-matches"
										name="donor_match"
										type="radio"
										boxed
										items={shown.matches.map((d) => ({
											id: `donation-add-match-${d.id}`,
											value: d.id,
											label: d.displayName,
											sub: d.primaryEmail ?? undefined,
											checked: false,
											onChange: () => swap({ arm: 'picked', donor: d }, fields.contact_id.name)
										}))}
									/>
								)}
								<div className="adm-actions">
									<Button
										variant="quiet"
										type="button"
										onClick={() =>
											swap({ arm: 'creating', kind: 'individual', email: '' }, fields.kind.name)
										}
									>
										Add a new donor
									</Button>
								</div>
							</>
						) : region.arm === 'picked' ? (
							<>
								<input type="hidden" name={fields.donor_search.name} value="" />
								<CheckboxGroup
									id={fields.contact_id.id}
									name={fields.contact_id.name}
									type="radio"
									boxed
									error={fields.contact_id.errors?.[0]}
									items={[
										{
											id: `${fields.contact_id.id}-${region.donor.id}`,
											value: region.donor.id,
											label: region.donor.displayName,
											sub: region.donor.primaryEmail ?? undefined,
											checked: true,
											readOnly: true
										}
									]}
								/>
								<div className="adm-actions">
									<Button
										variant="quiet"
										type="button"
										onClick={() => swap(SEARCHING, fields.donor_search.name)}
									>
										Choose someone else
									</Button>
								</div>
							</>
						) : (
							<>
								<input type="hidden" name={fields.donor_search.name} value="" />
								<input type="hidden" name={fields.contact_id.name} value="" />
								{/* the name boxes a kind does not ask for are submitted empty, because every
								    box this form states must arrive. */}
								{(Object.values(NAME_BOXES).flat() as NameBox[])
									.filter((box) => !NAME_BOXES[region.kind].includes(box))
									.map((box) => (
										<input key={box} type="hidden" name={box} value="" />
									))}
								<SelectWithNote
									label={CONTACT_FIELD_LABELS.kind}
									options={CONTACT_KINDS.map((value) => ({ value, label: KIND_LABELS[value] }))}
									{...boxProps(fields.kind)}
									defaultValue={region.kind}
									onChange={(event) => {
										const kind = CONTACT_KINDS.find((k) => k === event.currentTarget.value);
										if (kind !== undefined) {
											setHeld({ for: donationId, region: { ...region, kind } });
										}
									}}
								/>
								{region.kind === 'individual' ? (
									<PairedFieldset id="donation-add-name" legend="Name" side>
										<Field
											label={CONTACT_FIELD_LABELS.first_name}
											autoComplete="off"
											{...boxProps(fields.first_name)}
										/>
										<Field
											label={CONTACT_FIELD_LABELS.last_name}
											autoComplete="off"
											{...boxProps(fields.last_name)}
										/>
									</PairedFieldset>
								) : region.kind === 'organization' ? (
									<Field
										label={CONTACT_FIELD_LABELS.legal_name}
										autoComplete="off"
										{...boxProps(fields.legal_name)}
									/>
								) : (
									<Field
										label={CONTACT_FIELD_LABELS.display_name}
										autoComplete="off"
										{...boxProps(fields.display_name)}
									/>
								)}
								{/* type="text" for the address: the server's rule is deliberately weaker than
								    the browser's, and a box the browser blocks is a refusal with no message. */}
								<div className="adm-pair adm-pair--side">
									<Field
										label={CONTACT_FIELD_LABELS.primary_email}
										optional
										{...boxProps(fields.primary_email)}
										onChange={(event) =>
											setHeld({
												for: donationId,
												region: { ...region, email: event.currentTarget.value }
											})
										}
									/>
									<Field
										label={CONTACT_FIELD_LABELS.primary_phone}
										optional
										type="tel"
										{...boxProps(fields.primary_phone)}
									/>
								</div>
								<div className="adm-actions">
									<Button
										variant="quiet"
										type="button"
										onClick={() => swap(SEARCHING, fields.donor_search.name)}
									>
										Find an existing donor instead
									</Button>
								</div>
							</>
						)}
					</fieldset>

					{/* the other two arms submit the create boxes empty. */}
					{region.arm === 'creating'
						? null
						: CREATE_BOXES.map((box) => <input key={box} type="hidden" name={box} value="" />)}

					<div className="adm-pair adm-pair--side">
						<Field
							label={GIFT_FIELD_LABELS.amount}
							inputMode="decimal"
							{...boxProps(fields.amount)}
						/>
						<Field
							label={GIFT_FIELD_LABELS.received_on}
							type="date"
							{...boxProps(fields.received_on)}
						/>
					</div>

					<CheckboxGroup
						id={fields.method.id}
						name={fields.method.name}
						type="radio"
						legend={GIFT_FIELD_LABELS.method}
						error={fields.method.errors?.[0]}
						items={IN_HAND_METHODS.map((method: InHandMethod) => ({
							id: `${fields.method.id}-${method}`,
							value: method,
							label: IN_HAND_METHOD_LABELS[method],
							defaultChecked: fields.method.defaultValue === method
						}))}
					/>

					<SelectWithNote
						label={GIFT_FIELD_LABELS.program_id}
						options={[NO_PROGRAM, ...programs]}
						{...boxProps(fields.program_id)}
					/>

					<Field
						label={GIFT_FIELD_LABELS.source}
						optional
						hint="How the gift came in: an appeal, an event, a cheque number."
						{...boxProps(fields.source)}
					/>

					{/* last, directly above the press: ticking it is the one act on this screen that
					    reaches somebody else's inbox. held rather than removed where there is no address,
					    with the reason beside it, so the press never fails on it. */}
					<CheckboxGroup
						id={fields.send_receipt.id}
						name={fields.send_receipt.name}
						items={[
							{
								id: `${fields.send_receipt.id}-box`,
								label: GIFT_FIELD_LABELS.send_receipt,
								checked: ticked && receiptBlocked === null,
								disabled: receiptBlocked !== null,
								note: receiptBlocked ?? undefined,
								onChange: (event) => setTick({ for: donationId, on: event.currentTarget.checked })
							}
						]}
					/>

					{refusal ? (
						// a write whose outcome could not be read is not called not added: it may have
						// landed and lost its answer.
						<Banner tone="blocker" word={refusal === WRITE_FAILED ? 'Not confirmed' : 'Not added'}>
							{refusal}
						</Banner>
					) : null}

					<div className="adm-actions">
						{/* held with `aria-disabled` rather than `disabled`, so the dialog can hand focus
						    back to it as it closes and the answer arrives beside a button still focused. */}
						<Button
							variant="primary"
							type="submit"
							aria-busy={adding}
							aria-disabled={adding || undefined}
							onClick={(event) => {
								if (adding) event.preventDefault();
							}}
						>
							Add donation
						</Button>
						<Link to={href('/admin/donations')}>Cancel</Link>
						{/* mounted empty, so the words arriving are announced. */}
						<span role="status">
							{adding ? null : recordedAgain ? (
								<>
									<StatusWord register="momentary" neutral>
										Already recorded, from the earlier press.
									</StatusWord>
									{/* only what this press's receipt did that is news: `not_sent` also answers a
									    gift the earlier press already receipted, so it says nothing here. */}
									{recordedAgain.receipt === 'sent' ? (
										<>
											{' '}
											<StatusWord register="momentary">Receipt sent.</StatusWord>
										</>
									) : recordedAgain.receipt === 'no_address' ? (
										<>
											{' '}
											<StatusWord register="momentary" neutral>
												No receipt sent: this donor has no email address.
											</StatusWord>
										</>
									) : null}
								</>
							) : landed && !actionData && movedOn !== donationId ? (
								<Landed landed={landed} />
							) : null}
						</span>
					</div>
				</Stack>

				{asking ? (
					<Modal
						title="Add this donation?"
						cancel="Cancel"
						cancelProps={{ type: 'button', onClick: () => setAsking(null) }}
						exit="Yes, add this donation"
						exitProps={{
							type: 'submit',
							onClick: () => {
								confirmed.current = true;
							}
						}}
						onDismiss={() => setAsking(null)}
					>
						<Stack tight>
							<p className="adm-prose">{asking.gift}</p>
							{asking.program ? <p className="adm-prose">Credited to {asking.program}.</p> : null}
							{asking.source ? <p className="adm-prose">Source: {asking.source}</p> : null}
							<p className="adm-prose">{asking.receipt}</p>
							<p className="adm-prose">This cannot be edited or deleted afterwards.</p>
						</Stack>
					</Modal>
				) : null}
			</Form>
		</Column>
	);
}

/** who the confirm names the gift as from, off the arm and the boxes it holds. */
function donorNameOf(region: Region, value: (name: string) => string): string {
	if (region.arm === 'picked') return region.donor.displayName;
	if (region.arm !== 'creating') return 'nobody';
	const typed =
		region.kind === 'individual'
			? [value('first_name'), value('last_name')]
					.map((v) => v.trim())
					.filter(Boolean)
					.join(' ')
			: value(region.kind === 'organization' ? 'legal_name' : 'display_name').trim();
	return typed === '' ? 'a new donor' : `${typed}, a new donor`;
}

/** what a landed gift says at the button: the gift, and the receipt beside it where one was asked for. */
function Landed({
	landed
}: {
	readonly landed: NonNullable<Route.ComponentProps['loaderData']['landed']>;
}) {
	const { gift, filing, receipt } = landed;
	// the day as a `time`, which base.css keeps on one line: `2026-08-28` broken at a hyphen reads as
	// two numbers.
	const added =
		gift === null ? (
			'Added.'
		) : (
			<>
				Added. {gift.amount} from {gift.donorName}, received{' '}
				<time dateTime={gift.receivedOn}>{gift.receivedOn}</time>.
			</>
		);
	const filed =
		filing === 'matched' ? ' Filed under the donor already holding that email address.' : '';
	return (
		<>
			<StatusWord register="momentary">
				{added}
				{filed}
				{receipt === 'sent' ? ' Receipt sent.' : ''}
			</StatusWord>
			{receipt === 'not_sent' ? (
				<>
					{' '}
					<StatusWord register="momentary" blocked>
						Receipt not sent.
					</StatusWord>
				</>
			) : receipt === 'no_address' ? (
				<>
					{' '}
					<StatusWord register="momentary" neutral>
						No receipt sent: this donor has no email address.
					</StatusWord>
				</>
			) : null}
		</>
	);
}
