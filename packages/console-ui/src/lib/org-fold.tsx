import { Button } from '@better-giving/operator/components/controls/Button';
import { SaveButton } from '@better-giving/operator/components/controls/SaveButton';
import { Field } from '@better-giving/operator/components/forms/Field';
import { FieldMessage } from '@better-giving/operator/components/forms/FieldMessage';
import {
	type RepeatingRow,
	RepeatingRows
} from '@better-giving/operator/components/forms/RepeatingRows';
import { BrandMark } from '@better-giving/operator/components/status/BrandMark';
import { Mark } from '@better-giving/operator/components/status/Mark';
import { SOCIAL_PLATFORMS } from '@better-giving/operator/console/org';
import { BRAND_COLOUR } from '@better-giving/operator/console/org-rules';
import {
	SOCIAL_PLATFORM_NAMES,
	readSocialLink
} from '@better-giving/operator/console/social-links';
import { MarkedText } from '@better-giving/operator/marked-text.react';
import {
	type ChangeEvent,
	type DragEvent,
	type FormEvent,
	type MouseEvent,
	type ReactNode,
	type SubmitEvent,
	useEffect,
	useEffectEvent,
	useRef,
	useState
} from 'react';
import { Form } from 'react-router';
import {
	type EinNote,
	type EinRead,
	type EinWatch,
	type HeldBoxes,
	SILENT_NOTE,
	watchEin
} from './ein-lookup';
import { droppedFile, LOGO_ACCEPT } from './logo-crop';
import { type CropImage, LogoCropDialog } from './logo-crop-dialog';
import { firstNeeded, heldBoxes, putBoxes, spellEin } from './fold-boxes';
import { rememberWebsite } from './found-organisation';
import {
	IDENTITY_BOXES,
	LOGO_FIELD,
	LOGO_FILE,
	LOGO_FROM_FILE,
	LOGO_FROM_STORED,
	LOGO_LABEL,
	ORGANISATION_KEYS,
	ORG_FIELDS,
	ORG_INTENT,
	ORG_LOGO_INTENT,
	ORG_LOGO_REMOVE_INTENT,
	SOCIAL_LINKS_FIELD,
	SOCIAL_LINKS_LABEL,
	type OrgPressKind,
	type StoredOrg,
	carriedBoxes
} from './org-fields';
import { FINDER_ID, OrgFinder } from './org-finder';
import { ORG_FORM, foldErrors, seedFor, type IdentityField } from './org-form';
import { useConsoleForm } from './use-console-form';
import { OrgWriteOutcome } from './org-write';
import type {
	NonprofitLookup,
	NonprofitMatch,
	NonprofitOrganisation,
	NonprofitSearch,
	OrgWrite
} from '../api/types';

// the organisation this deployment asks for gifts under — its legal identity and address, what
// donor pages tell about it, its brand colour, its social links and its logo — read and edited on the
// organisation page (../routes/_sections.organisation.tsx).
//
// **it is a row on the deployment and this fold names no database.** the values are read out of the
// report the deployment answers with and written back to its own endpoint over the console session
// — `packages/console/internal/deployment/org.go` is the whole of both halves. nothing here reaches
// cloudflare, so this draws with no account-scoped read at all: the session is the only door it
// uses.
//
// **nothing here states a rule of its own, and the rules it runs are the deployment's own.** what a
// profile field may hold is `ORG_PROFILE_FIELD_RULES` in
// `@better-giving/operator/console/org-rules`, stated there because two surfaces apply it to the
// same values: the worker parses every profile it is sent and this fold mounts the same rules
// through the seam (./org-form.ts's `ORG_FORM`, ./use-console-form.ts). a copy here would be the
// cheaper answer and is exactly how the two come to disagree — one end taking eight digits for an
// EIN and the other refusing the save is an operator told a value is fine and then told it is not,
// with nothing on either screen saying which half was right. the deployment stays the authority:
// its endpoint is reachable by anything holding a console session, so it parses whatever asked it
// to, and reading here first is a courtesy to the person typing. what this fold adds is what the
// boxes are called.
//
// **no box is marked before a press.** a box the save refuses blank carries no `(optional)` marker
// and that is the whole of what says so; the sentence about a blank one arrives at the press
// (CLAUDE.md, and the timing is the seam's for every fold at once). a warning drawn over a form
// seeded from a record is a screen reporting a refusal nobody asked for, and the same words then
// stand at the box, at the head of the panel and on the rail cell — one fact told three times, each
// able to drift from the other two.
//
// **at the press, every box the rules turn down is answered at the box and nothing is sent.** a
// name over its cap, a value that is not an EIN and a box the save refuses blank each earn the
// deployment's own sentence where the value is, in the words the deployment would have answered
// with — because they are the same sentences. what that saves is the state the screen is otherwise
// in for the length of a round trip: every box shut, the button reading `Saving`, and the sentences
// from the last answer still standing under boxes nobody can reach.
//
// **a sentence from the far end and one from those rules share a box, and the far end's wins.** it
// is about the value that was actually sent and the other is about a box that never went; both go
// the moment the box is edited. the composition is the seam's and no fold restates it.
//
// **the boxes are re-seeded by a save rather than emptied.** these values can be read back, unlike a
// credential: the press answers, the page's `loader` runs again, and what stands in the boxes
// afterwards is the profile the deployment now holds. the press is armed against what is stored and
// not against emptiness: these values read back, so an empty box is a value an operator can see is
// empty and meant to clear.
//
// **this press carries the boxes it does not draw, at exactly what is stored.** the deployment
// reads the profile whole, so a field left out of the body is one it stores as cleared — and one of
// its boxes is drawn elsewhere, the notification address by ./notifications-fold.tsx. it rides along
// hidden and nothing about it changes here, and it is left out of the rules this form runs for the
// same reason — a sentence keyed to a box this form does not draw sends focus into a shut panel.
// the deployment stores a profile holding no notification address (`notification_email` in
// `ORG_PROFILE_FIELD_RULES`, refused blank by nothing), so an identity saved first is an identity
// saved.
//
// **a fresh set-up — every identity box empty — draws the finder and nothing else** (./org-finder.tsx):
// no box, no link, no logo and no Save, until an EIN is locked in. a whole EIN pressed in the finder,
// or a match picked off its list, is looked up, and whatever the lookup answers — found, not listed,
// or not answered — locks the number in: the whole screen appears with the number in the EIN box, the
// note under it, and focus on the EIN box where there is a note, or else on the first required box
// still empty, or on Save where none is. a console that cannot ask the list locks a whole EIN in at
// once and asks nothing. from then on the finder collapses into "Pick a different organisation"
// beside Save, which opens it above the form, and Save is held while the finder's lookup is out.
//
// **the IRS list fills the boxes and never saves them.** a whole EIN typed into its box is looked up
// once (./ein-lookup.ts says when), and so is a number the finder locks in; either way a found
// organisation's values go into the boxes the way typing them would, so the press is armed over them
// and Save stores them like any edit. a number locked in replaces the whole legal identity with
// what the list found, or, where it found nothing, with the picked match's name, city and state,
// and empties every box that source holds nothing for; a typed one fills around what the operator
// typed. what the list says about the number stands under the EIN box in a region drawn before it
// speaks, and goes when the box changes. the list is reached through the two calls the page hands
// in, so this names no address and no binary route.
//
// **a value put into a box is made to say it changed**, and the mission is a textarea the fill has
// to reach as well as the inputs — ./fold-boxes.ts holds both.
//
// **the links are rows of the same press, the logo is a press of its own.** a link row submits as
// conform spells a list (`SOCIAL_LINKS_FIELD` in ./org-fields.ts) and is added and dropped in the
// browser; the list's refusal is one sentence, keyed to the list and drawn at the group. each row
// carries the mark of the network its address is read as, read as it is typed by the same reading
// the deployment stores it by (`readSocialLink` in `@better-giving/operator/console/social-links`),
// so the mark a row shows is the platform a save would store it under. the logo is a press of its
// own beside the profile form — a photo is not a box, and holding it until Save would be a file
// nobody can see waiting under a button that says nothing about it. the logo's square is that
// press: a photo chosen or dropped on it, and the crop pressed on its corner, open the crop
// (./logo-crop-dialog.tsx), and the crop's own Save is what sends.
//
// **an answer is the profile's or the logo's by the tag the page hands beside it** (`press`,
// `OrgPressKind` in ./org-fields.ts). all three presses answer in the profile's shape, and a logo
// landing read as the profile's would put the boxes back to what is stored with whatever was typed
// in them since. a refusal keyed to the logo is drawn at the logo whichever press it answered.
//
// it is a component and not a screen: ../routes/_sections.organisation.tsx mounts it and answers its
// press, and everything about which section this is — its label, its tone, the word on its rail cell
// and what stands between it and its job — is decided in ./home-sections.ts with the others.

/** a logo press in flight, as the square says it: a logo going on, or the one held coming off. */
export type LogoPending = 'saving' | 'removing';

export type OrgFoldProps = {
	/** the profile as the deployment holds it, which is what the boxes are seeded and read against. */
	stored: StoredOrg;
	/** how the last press on this page went, or `null` where none has been made. */
	write: OrgWrite | null;
	/** which press `write` answers, or `null` where none has been made. */
	press: OrgPressKind | null;
	/** something else on the page is writing, which holds every control on it closed. */
	busy: boolean;
	/** the profile's own press is in flight. */
	pending: boolean;
	/** which logo press is in flight: one putting a logo on, or one taking it off. */
	logoPending?: LogoPending | null;
	/**
	 * whether this console was built able to ask the IRS list. where it was not, a fresh set-up's
	 * finder locks a whole EIN in without asking, and the form has no find press, no lookup and no
	 * note.
	 */
	lookups: boolean;
	/** one organisation from the IRS list by EIN. a throw reads as the list being unavailable. */
	lookUp: (ein: string, signal: AbortSignal) => Promise<NonprofitLookup>;
	/** organisations from the IRS list by name or EIN, for the finder. */
	search: (query: string, signal: AbortSignal) => Promise<NonprofitSearch>;
};

/**
 * the most rows the link list draws: one per platform, since a platform listed twice is refused
 * (`readSocialLinks` in `@better-giving/operator/console/social-links`).
 */
const MAX_LINK_ROWS = SOCIAL_PLATFORMS.length;

/** the keys of a refusal the profile press answers at its own boxes; the logo's is drawn at the logo. */
const PROFILE_KEYS: readonly string[] = [...IDENTITY_BOXES, SOCIAL_LINKS_FIELD];

/**
 * the list and every row it can hold, as one refusal: the list's sentence is about whichever row was
 * refused, so typing in any of them ends it (`together` in ./use-console-form.ts).
 */
const LINKS_TOGETHER: readonly string[] = [
	SOCIAL_LINKS_FIELD,
	...Array.from({ length: MAX_LINK_ROWS }, (_, at) => `${SOCIAL_LINKS_FIELD}[${at}]`)
];

/** the group the link rows are drawn in, named the way the seam names a box of this form. */
const LINKS_GROUP = `${ORG_FORM.id}-${SOCIAL_LINKS_FIELD}`;
const LINKS_CAP = `${LINKS_GROUP}-cap`;

/** the two logo forms, apart from the profile's: a photo goes as an upload and a removal as nothing. */
const LOGO_UPLOAD_FORM = `${ORG_FORM.id}-logo-upload`;
const LOGO_REMOVE_FORM = `${ORG_FORM.id}-logo-remove`;
const LOGO_REFUSAL = `${ORG_FORM.id}-logo-err`;

/** the words an empty colour well is described by. */
const WELL_EMPTY = `${ORG_FORM.id}-brand_colour-empty`;

/** the six platforms as the group's hint lists them: `Facebook, …, TikTok or X`. */
const PLATFORMS_LISTED = (() => {
	const names = SOCIAL_PLATFORMS.map((platform) => SOCIAL_PLATFORM_NAMES[platform]);
	return `${names.slice(0, -1).join(', ')} or ${names.at(-1)}`;
})();

const NO_TYPING: Readonly<Record<string, string>> = {};

/** a fresh set-up: nothing about the organisation's identity has been saved yet. */
const unset = (stored: StoredOrg): boolean => IDENTITY_BOXES.every((field) => stored[field] === '');

/**
 * a number the finder locked in, with the list's answer about it, or none where none was asked, and
 * the match it was picked as, or none where it was typed.
 */
type Landing = {
	readonly ein: string;
	readonly answer: EinRead | null;
	readonly match: NonprofitMatch | null;
};

export function OrgFold({
	stored,
	write,
	press,
	busy,
	pending,
	logoPending = null,
	lookups,
	lookUp,
	search
}: OrgFoldProps): ReactNode {
	const profileWrite = press === 'profile' ? write : null;
	const logoWrite = press === 'logo' ? write : null;

	/** whether the last profile press left the deployment holding this profile. */
	const landed = profileWrite?.kind === 'saved';

	const form = useConsoleForm(ORG_FORM, {
		report: profileWrite,
		landed,
		// the deployment's own answer, cut down to what this form draws: a key for the other fold's
		// box would send focus into a shut panel (./org-form.ts's `foldErrors`), and the logo's is
		// drawn at the logo, which no keystroke here answers.
		refused: foldErrors(profileWrite, PROFILE_KEYS),
		together: LINKS_TOGETHER,
		/* the boxes and the link rows at what the deployment holds, which is what the press is read
		   against: a form nobody has touched would otherwise offer to save the deployment back to
		   itself. the notification address is carried hidden and is in no seed here — the form does
		   not state it, so it counts toward nothing (./use-console-form.ts). */
		defaultValue: seedFor(ORG_FORM, stored),
		/* the boxes go back on the answer itself rather than on a reading after it, which is what the
		   seed makes right: it is the profile the press stored (`storedOrg` in ./org-form.ts), so at
		   the moment the answer arrives it is already what the deployment holds. the folds seeded from
		   a reading wait for that reading instead (./reseed.ts). */
		spent: landed,
		busy,
		pending
	});

	/* whether an EIN is locked in, which is what draws the form. read once, at the mount, which is
	   the visit to the page: a save landing never takes the form away again. */
	const [locked, setLocked] = useState(() => !unset(stored));
	/** the finder is open above the form, from the press beside Save. */
	const [finding, setFinding] = useState(false);
	/** the number the finder locked in last, which the form takes once it is on the page. */
	const [landing, setLanding] = useState<Landing | null>(null);
	/** the finder's lookup in flight above the form, which holds Save: a save under it would store
	    the organisation it is about to replace. */
	const [lookupOut, setLookupOut] = useState<AbortSignal | null>(null);
	/** a lock-in the watch has put, which focus follows once the note it says is drawn. */
	const [arrived, setArrived] = useState<{ readonly noted: boolean } | null>(null);
	/** what the region under the EIN box holds: the list's note, and a fill said to a reader. */
	const [note, setNote] = useState<EinNote>(SILENT_NOTE);
	const findPress = useRef<HTMLButtonElement>(null);
	const savePress = useRef<HTMLButtonElement>(null);

	/** the boxes as they stand, which is not what was stored once they have been typed in. */
	const held = (): HeldBoxes => heldBoxes(form.mount.ref.current?.elements, IDENTITY_BOXES);

	/** boxes given values, each made to say so; answers how many took one. */
	const put = (boxes: Partial<Record<IdentityField, string>>): number =>
		putBoxes(form.mount.ref.current?.elements, boxes);

	/* the boxes the watch decided on (./ein-lookup.ts says which), put as they are, and a found
	   organisation's website kept for the Sites fold. effect events, so the watch made once per mount
	   reads and fills the form standing when it calls. */
	const filled = useEffectEvent(
		(boxes: Partial<Record<IdentityField, string>>, organisation: NonprofitOrganisation | null) => {
			if (organisation !== null) rememberWebsite(organisation.website);
			return put(boxes);
		}
	);
	const holding = useEffectEvent(held);

	/* the watch over the EIN box, made once per mount and handed the box's text at every change. */
	const watch = useRef<EinWatch | null>(null);
	useEffect(() => {
		const watching = watchEin({ lookUp, held: holding, onNote: setNote, onFill: filled });
		watch.current = watching;
		return () => {
			watching.stop();
			watch.current = null;
		};
	}, [lookUp]);

	/* an answer landing while the profile press is out waits for it (./ein-lookup.ts). the watch is
	   told the press went out at the submit the form lets through, and that it is over on the render
	   its answer arrives in — landed, refused or unwritten — and where it landed, after the seam's
	   reset, an effect declared before this one, has put the boxes back at what it stored. */
	const profilePressed = (event: SubmitEvent<HTMLFormElement>) => {
		form.mount.onSubmit(event);
		if (!event.defaultPrevented) watch.current?.saving();
	};
	useEffect(() => {
		if (profileWrite !== null) watch.current?.afterSave();
	}, [profileWrite]);

	/** the EIN box as typed: spelled as it is typed, and handed to the watch. */
	const einTyped = (event: FormEvent<HTMLInputElement | HTMLTextAreaElement>) => {
		const shown = spellEin(event.currentTarget, event.nativeEvent);
		if (lookups) watch.current?.typed(shown, stored.tax_id);
	};

	/* the finder's number, asked about where the list can be, and locked in whatever it answered. a
	   finder shut while the lookup is out locks nothing in. */
	const lockIn = async (ein: string, signal: AbortSignal, match: NonprofitMatch | null) => {
		setLookupOut(signal);
		try {
			const answer =
				lookups && watch.current !== null ? await watch.current.ask(ein, signal) : null;
			if (signal.aborted) return;
			setLocked(true);
			setFinding(false);
			setLanding({ ein, answer, match });
		} finally {
			setLookupOut((out) => (out === signal ? null : out));
		}
	};

	/** the finder shut from above the form, giving up whatever it had out. */
	const shutFinder = () => {
		setFinding(false);
		setLookupOut(null);
	};

	/* a number locked in, put to the form drawn for it — the EIN, the whole legal identity and the
	   note, by the watch in one fill. keyed to the landing, so a page opened on a stored profile
	   moves nothing. */
	const takeLanding = useEffectEvent((at: Landing) => {
		watch.current?.lockIn(at.ein, at.answer, at.match);
		setArrived({ noted: (at.answer?.note ?? '') !== '' });
	});
	useEffect(() => {
		if (landing !== null) takeLanding(landing);
	}, [landing]);

	/* focus once the lock-in is drawn: on the EIN box where the list said something about the number,
	   so the note is read as the box's description — on a fresh set-up its region arrives with the
	   form, too late to be heard as it speaks — and otherwise on the first box the operator still
	   owes, or on Save. a box closed while the page writes takes no focus, and Save takes it. */
	const focusArrival = useEffectEvent((at: { readonly noted: boolean }) => {
		const target = at.noted ? 'tax_id' : firstNeeded(held());
		const box = target === null ? null : form.mount.ref.current?.elements.namedItem(target);
		if ((box instanceof HTMLInputElement || box instanceof HTMLTextAreaElement) && !box.disabled) {
			box.focus();
		} else savePress.current?.focus();
	});
	useEffect(() => {
		if (arrived !== null) focusArrival(arrived);
	}, [arrived]);

	/* the brand colour's well stands beside its box and follows it: a hex typed in the box shows in
	   the well, and a colour picked in the well is written into the box the way typing it would be.
	   the box is what posts; the well has no name. */
	const well = useRef<HTMLInputElement>(null);
	/* a colour input always holds a colour, black where none was given, so an empty well is
	   described as empty in words the screen does not draw. */
	const [wellEmpty, setWellEmpty] = useState(() => !BRAND_COLOUR.test(stored.brand_colour));
	const brandTyped = (typed: string) => {
		const hex = BRAND_COLOUR.test(typed);
		setWellEmpty(!hex);
		if (hex && well.current !== null) well.current.value = typed.toLowerCase();
	};
	const wellPicked = (event: ChangeEvent<HTMLInputElement>) => {
		put({ brand_colour: event.currentTarget.value });
	};

	/** one box, drawn from what this fold calls it and what the deployment holds in it. */
	const box = (field: IdentityField, beside?: ReactNode) => {
		const copy = ORG_FIELDS[field];
		/* the id, the name, the one message under it and the lift that ends the far end's sentence
		   when this box is typed in — one composition, in the seam, for every fold at once
		   (./use-console-form.ts). */
		const bound = form.box(form.fields[field]);
		/* the EIN box spells itself as it is typed and is the one the list is asked about, and the
		   note on what it said stands under it. the brand colour's box moves the well beside it. */
		const typing =
			field === 'tax_id'
				? {
						inputMode: 'numeric' as const,
						...(lookups ? { status: note.shown, statusSaid: note.said } : {}),
						onInput: (event: FormEvent<HTMLInputElement | HTMLTextAreaElement>) => {
							bound.onInput?.();
							einTyped(event);
						}
					}
				: field === 'brand_colour'
					? {
							spellCheck: false,
							onInput: (event: FormEvent<HTMLInputElement | HTMLTextAreaElement>) => {
								bound.onInput?.();
								brandTyped(event.currentTarget.value);
							}
						}
					: { onInput: bound.onInput };
		return (
			<Field
				id={bound.id}
				name={bound.name}
				{...typing}
				label={copy.label}
				hint={copy.hint}
				optional={copy.optional}
				// the example the box stands on while it is empty. a box seeded from the profile is full
				// and shows none of it, which is what makes the placeholder a reading as well as a shape:
				// what is on screen is either what the deployment holds or an example of what it takes.
				placeholder={copy.placeholder}
				// the tabular face for a value read digit by digit against the document it was copied
				// from, which is what the EIN and the postal code have in common.
				className={copy.figures ? 'adm-num' : undefined}
				as={copy.prose ? 'textarea' : 'input'}
				rows={copy.prose ? 3 : undefined}
				autoComplete={copy.autoComplete}
				beside={beside}
				/* seeded from the profile rather than from the form layer's own reading of it: conform
				   takes its default once, at the mount, and this fold's boxes are put back by its own
				   landed write — so a box seeded from that reading would be reset to the profile the
				   press replaced. what the boxes are worth comparing against is the same prop
				   (./org-form.ts's `storedOrg`). */
				defaultValue={stored[field]}
				// closed while the page is writing, like every box on this console —
				// ../closed-while-writing.spec.ts is the gate and states the whole of why.
				disabled={busy}
				// the message is handed over as a node rather than as the string, so a sentence that
				// marks a value with backticks is drawn as code rather than shown with the marks in it
				// (`@better-giving/operator/code-spans`). both surfaces draw the same sentences, which
				// are written once in `@better-giving/operator/console/org-rules`.
				error={bound.error === undefined ? undefined : <MarkedText text={bound.error} />}
			/>
		);
	};

	/* the link rows, added and dropped by the form's own intents (./use-console-form.ts's `list`). */
	const links = form.fields[SOCIAL_LINKS_FIELD];
	const linkRows = links.getFieldList();
	const linkControls = form.list(links.name);
	/* the list's one sentence — the far end's or this console's own reading of the rows — keyed to
	   the list and drawn at the group, which describes every row that carries none of its own. */
	const linksSaid = form.box({ name: links.name, errors: links.errors }).error;

	/* what each row holds as it is typed, by the row's identity, which is what its mark is read
	   from. forgotten when a different list is stored, since the boxes are put back at that list. */
	const storedLinks = stored.social_links.map((link) => link.href).join('\n');
	const [typedLinks, setTypedLinks] = useState<{
		over: string;
		rows: Readonly<Record<string, string>>;
	}>({ over: storedLinks, rows: {} });
	const typedRows = typedLinks.over === storedLinks ? typedLinks.rows : NO_TYPING;
	const typedIn = (row: string, text: string) =>
		setTypedLinks((was) => ({
			over: storedLinks,
			rows: { ...(was.over === storedLinks ? was.rows : NO_TYPING), [row]: text }
		}));

	/* an Add pressed at the cap is held, with the sentence saying why standing while those rows are
	   the rows on screen — the giving amounts' cap in packages/app/src/lib/admin/forms/giving-fields.tsx
	   is the same press. */
	const identities = linkRows.map((row) => row.key ?? row.name).join('\n');
	const [heldOver, setHeldOver] = useState<string | null>(null);
	const capped = heldOver === identities;
	const addLink = {
		...linkControls.add,
		onClick: (event: MouseEvent<HTMLButtonElement>) => {
			if (linkRows.length < MAX_LINK_ROWS) return;
			event.preventDefault();
			setHeldOver(identities);
		},
		...(capped ? { 'aria-describedby': LINKS_CAP } : {})
	};

	const linkRow = (row: (typeof linkRows)[number], at: number): RepeatingRow => {
		const bound = form.box(row);
		const identity = row.key ?? bound.id;
		/* the platform the row's address is read as, by the deployment's own reading of one
		   (`readSocialLink`), as it stands in the box: typed, or stored. */
		const read = readSocialLink(typedRows[identity] ?? bound.defaultValue ?? '');
		const platform = read.ok ? read.link.platform : undefined;
		return {
			id: bound.id,
			key: identity,
			name: bound.name,
			defaultValue: bound.defaultValue,
			inputMode: 'url',
			/* the network's mark and its name, which the box is described by since the mark is what
			   says it on the screen; or the globe, which says no network is read from the address and
			   has no words of its own. */
			lead:
				platform === undefined
					? { mark: <Mark name="globe" /> }
					: {
							mark: <BrandMark platform={platform} className="adm-brand-mark" />,
							said: SOCIAL_PLATFORM_NAMES[platform]
						},
			onInput: (event: FormEvent<HTMLInputElement | HTMLTextAreaElement>) => {
				bound.onInput?.();
				typedIn(identity, event.currentTarget.value);
			},
			error: bound.error === undefined ? undefined : <MarkedText text={bound.error} />,
			remove: linkControls.remove(at)
		};
	};

	/* the logo: the square that shows it and chooses a new one, and the two presses on its corner
	   that crop it again and take it off. the file box is the square's and is opened by it, cleared
	   first so the same photo chosen again after a refusal is still a choice. */
	const logo = stored.logo;
	const fileBox = useRef<HTMLInputElement>(null);
	const choosePress = useRef<HTMLButtonElement>(null);
	const cropPress = useRef<HTMLButtonElement>(null);
	const logoAnswer = logoWrite ?? profileWrite;
	const logoRefused = logoAnswer?.kind === 'refused' ? logoAnswer.errors[LOGO_FIELD] : undefined;

	/* a removal that landed takes Remove with it, so focus goes to the press that adds one. keyed to
	   the logo going, so a fold opened with none takes nothing. */
	const logoId = logo?.id ?? null;
	const shownLogo = useRef(logoId);
	useEffect(() => {
		const was = shownLogo.current;
		shownLogo.current = logoId;
		if (was !== null && logoId === null) choosePress.current?.focus();
	}, [logoId]);

	/* the image a crop is open on, and nothing is sent until its Save: a file chosen or dropped, or
	   the stored logo. keyed by the opening, so each image is a card of its own. */
	const [cropping, setCropping] = useState<{ key: number; image: CropImage } | null>(null);
	const openings = useRef(0);
	const crop = (image: CropImage) => {
		openings.current += 1;
		setCropping({ key: openings.current, image });
	};
	/* a file dropped on the logo or on its open crop is put in the file box, one file alone, which is
	   what a save of its crop posts. */
	const dropped = (file: File) => {
		const box = fileBox.current;
		if (box === null) return;
		const one = new DataTransfer();
		one.items.add(file);
		box.files = one.files;
		crop({ from: LOGO_FROM_FILE, file });
	};
	const cancelCrop = () => {
		setCropping(null);
		if (fileBox.current !== null) fileBox.current.value = '';
	};

	/* a file dragged over the square is taken by it, and the square says so. a drop while the page
	   writes is still held here, so the browser never opens the file in place of the console. */
	const [dragging, setDragging] = useState(false);
	const carriesFiles = (event: DragEvent<HTMLElement>) =>
		event.dataTransfer.types.includes('Files');
	const dragOver = (event: DragEvent<HTMLElement>) => {
		if (!carriesFiles(event)) return;
		event.preventDefault();
		event.dataTransfer.dropEffect = busy ? 'none' : 'copy';
		if (!busy) setDragging(true);
	};

	const finder = (onClose?: () => void) => (
		<OrgFinder lookups={lookups} search={search} lockIn={lockIn} closed={busy} onClose={onClose} />
	);

	if (!locked) return finder();

	return (
		<>
			{finding
				? finder(() => {
						shutFinder();
						findPress.current?.focus();
					})
				: null}
			<Form
				{...form.mount}
				onSubmit={profilePressed}
				className="adm-groups"
				method="post"
				preventScrollReset
			>
				{/* the boxes this fold does not draw, carried at exactly what the deployment holds: the
			    profile is stored whole, so a field left out of the body is one it stores as cleared. */}
				{carriedBoxes(IDENTITY_BOXES).map((field) => (
					<input key={field} type="hidden" name={field} value={stored[field]} readOnly />
				))}
				{/* the profile in its groups, which stand apart by the group step rather than the step
				    between two fields: who the organisation is, what it says about itself, how it
				    looks, where else it is, and then the press. */}
				<div className="adm-stack">
					<div className="adm-pair adm-pair--side">
						{box('tax_id')}
						{box('legal_name')}
					</div>

					<fieldset className="adm-fieldset">
						<legend className="adm-fieldset__legend">Address on receipts</legend>
						<div className="adm-pair adm-pair--side">
							{box('address_line1')}
							{box('address_line2')}
						</div>
						<div className="adm-pair adm-pair--side">
							{box('city')}
							{box('region')}
						</div>
						<div className="adm-pair adm-pair--side">
							{box('postal_code')}
							{box('country')}
						</div>
					</fieldset>
				</div>

				<div className="adm-stack">
					{box('mission')}
					{box('vision')}
				</div>

				{box(
					'brand_colour',
					<>
						{/* the label carries the well's target (`.adm-wellwrap` in
						    packages/operator/src/styles/adm.css); the well's name is its own `aria-label`. */}
						<label className="adm-wellwrap">
							<input
								ref={well}
								type="color"
								className="adm-swatch adm-swatch--well"
								aria-label="Pick the brand colour"
								aria-describedby={wellEmpty ? WELL_EMPTY : undefined}
								defaultValue={
									BRAND_COLOUR.test(stored.brand_colour)
										? stored.brand_colour.toLowerCase()
										: undefined
								}
								data-empty={wellEmpty || undefined}
								disabled={busy}
								onChange={wellPicked}
							/>
						</label>
						{wellEmpty ? (
							<span id={WELL_EMPTY} className="adm-vh">
								No colour set
							</span>
						) : null}
					</>
				)}

				<div className="adm-stack">
					<RepeatingRows
						id={LINKS_GROUP}
						legend={SOCIAL_LINKS_LABEL}
						rowLabel="Link"
						hint={`One address for each platform: ${PLATFORMS_LISTED}.`}
						describedBy={capped ? LINKS_CAP : undefined}
						addLabel="Add a link"
						placeholder="https://www.instagram.com/yourorganisation"
						disabled={busy}
						add={addLink}
						error={linksSaid === undefined ? undefined : <MarkedText text={linksSaid} />}
						rows={linkRows.map(linkRow)}
					/>
					{capped ? (
						<FieldMessage id={LINKS_CAP}>
							{MAX_LINK_ROWS} links at most, one for each platform.
						</FieldMessage>
					) : null}
				</div>

				<div className="adm-stack">
					<div className="adm-actions">
						<SaveButton
							ref={savePress}
							name="intent"
							value={ORG_INTENT}
							state={form.state}
							disabled={lookupOut !== null}
							label="Save details"
							doneLabel="Saved"
						/>
						{/* opens and closes the finder above the form. closed with the boxes, since a lock-in
						    fills them; closed as the field's own presses are, so a reader standing on it
						    keeps the focus. */}
						{lookups ? (
							<Button
								ref={findPress}
								type="button"
								variant="quiet"
								aria-expanded={finding}
								aria-controls={finding ? FINDER_ID : undefined}
								aria-disabled={busy || undefined}
								onClick={() => {
									if (busy) return;
									if (finding) shutFinder();
									else setFinding(true);
								}}
							>
								Pick a different organisation
							</Button>
						) : null}
					</div>

					{busy ? null : <OrgWriteOutcome write={profileWrite} drawn={ORGANISATION_KEYS} />}
				</div>
			</Form>

			<fieldset className="adm-fieldset">
				<legend className="adm-fieldset__legend">{LOGO_LABEL}</legend>
				{/* the crop's Save submits this form from inside the card, and that submit takes the card down. */}
				<Form
					id={LOGO_UPLOAD_FORM}
					className="adm-logo"
					method="post"
					encType="multipart/form-data"
					preventScrollReset
					onSubmit={() => setCropping(null)}
				>
					<input type="hidden" name="intent" value={ORG_LOGO_INTENT} readOnly />
					<div className="adm-logo__frame">
						{/* the square is the press that chooses: a press or a file dropped on it opens the
						    crop, and nothing is sent until that is saved. closed by `aria-disabled` while
						    the page writes, so a reader standing on it keeps the focus. `data-logo` says a
						    logo is held — drawn, under a press that is saving, or under the removal — which
						    the sheet keeps the square's logo edge by while the word stands in for the art or
						    under it. it is busy for a logo going on; a removal is Remove's own, and says so
						    there. */}
						<button
							ref={choosePress}
							type="button"
							className="adm-logo__square"
							data-logo={logo === null ? undefined : (logoPending ?? 'shown')}
							data-dragging={dragging || undefined}
							aria-busy={logoPending === 'saving' || undefined}
							aria-disabled={busy || undefined}
							aria-describedby={logoRefused === undefined || busy ? undefined : LOGO_REFUSAL}
							onClick={() => {
								if (busy || fileBox.current === null) return;
								fileBox.current.value = '';
								fileBox.current.click();
							}}
							onDragEnter={dragOver}
							onDragOver={dragOver}
							onDragLeave={(event) => {
								if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
									setDragging(false);
								}
							}}
							onDrop={(event) => {
								if (!carriesFiles(event)) return;
								event.preventDefault();
								setDragging(false);
								const file = droppedFile(event.dataTransfer.files);
								if (!busy && file !== null) dropped(file);
							}}
						>
							{logo === null || logoPending === 'saving' ? (
								<>
									<Mark name="image-up" />
									<span>{logoPending === 'saving' ? 'Saving' : 'Add logo'}</span>
								</>
							) : (
								<>
									<img className="adm-logo__art" src={logo.url} alt="" />
									{logoPending === 'removing' ? (
										<span>Removing</span>
									) : (
										<span className="adm-vh">Replace logo</span>
									)}
								</>
							)}
						</button>
						{logo === null ? null : (
							<div className="adm-logo__presses">
								<Button
									ref={cropPress}
									type="button"
									size="sm"
									mark="crop"
									aria-label="Crop the logo"
									aria-disabled={busy || undefined}
									onClick={() => {
										if (!busy) crop({ from: LOGO_FROM_STORED, url: logo.url });
									}}
								/>
								{/* it submits the empty form beside this one, so a removal posts no photo. closed
								    by `aria-disabled` while the page writes, as the square is, so a reader
								    standing on it keeps the focus, and busy while its own removal is out. */}
								<Button
									type="submit"
									form={LOGO_REMOVE_FORM}
									name="intent"
									value={ORG_LOGO_REMOVE_INTENT}
									size="sm"
									mark="trash-2"
									aria-label="Remove the logo"
									aria-busy={logoPending === 'removing' || undefined}
									aria-disabled={busy || undefined}
									onClick={(event: MouseEvent<HTMLButtonElement>) => {
										if (busy) event.preventDefault();
									}}
								/>
							</div>
						)}
					</div>
					{/* the photo a crop of a chosen one posts. closed under a crop of the stored logo,
					    which posts no photo. */}
					<input
						ref={fileBox}
						type="file"
						name={LOGO_FILE}
						accept={LOGO_ACCEPT}
						hidden
						disabled={busy || cropping?.image.from === LOGO_FROM_STORED}
						onChange={(event) => {
							const file = event.currentTarget.files?.[0];
							if (file !== undefined) crop({ from: LOGO_FROM_FILE, file });
						}}
					/>
					{logoRefused === undefined || busy ? null : (
						<FieldMessage id={LOGO_REFUSAL}>
							<MarkedText text={logoRefused} />
						</FieldMessage>
					)}
					{busy ? null : <OrgWriteOutcome write={logoWrite} drawn={ORGANISATION_KEYS} />}
				</Form>
				<Form id={LOGO_REMOVE_FORM} method="post" preventScrollReset />
			</fieldset>

			{cropping === null ? null : (
				<LogoCropDialog
					key={cropping.key}
					image={cropping.image}
					form={LOGO_UPLOAD_FORM}
					onCancel={cancelCrop}
					onSwap={dropped}
					fallbackFocus={cropping.image.from === LOGO_FROM_STORED ? cropPress : choosePress}
				/>
			)}
		</>
	);
}
