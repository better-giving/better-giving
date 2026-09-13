import { StatusLedger, StatusLine } from '@better-giving/operator/components/status/StatusLine';
import {
	FORM_READINESS_LABELS,
	type FormReadinessLine,
	type FormReadinessSeverity
} from '$lib/forms/readiness';
import { MarkedText } from '@better-giving/operator/marked-text.react';

// what stands between this deployment and a donor giving, on the two screens that write: the one
// that makes a form and the one that publishes one. it holds no state and reaches no server —
// everything it renders arrives as a prop.
//
// it sits under `$lib/admin/` rather than beside either route because both mount it, and every file
// directly under `src/routes/` is an address to `flatRoutes`.
//
// it is mounted directly under the screen's `PageHeader` and never above it. above the heading a
// screen outlines as this block and then its own h1, so a reader jumping to the page's heading
// lands past the block they most needed to read. under the heading it is still the first thing in
// the body of the page, which is the whole of what standing above the h1 buys.
//
// the forms list does not carry it and must not. that screen writes nothing, so it gates nothing,
// and a standing account of the deployment repeated over a list an operator is only reading is a
// second place to read the same thing — with two chances to word it differently.
//
// it is one block rather than a banner per fact, because the facts are one question: what a donor
// would see. an operator told half of what they needed, twice, has been made to work through a
// screen twice.
//
// the facts are the deployment's rather than any one form's — without the identity fields
// `readFormConfig` (packages/form/src/config.ts) drops every config, for every form at once. that
// is why one block can say this on both screens without either of them wording it for itself.
//
// it renders nothing when there is nothing to say — `$lib/server/forms/readiness.ts` answers `null`
// once every line is resolved — so a caller states the condition once, in the loader that decided
// it, rather than wrapping this in a condition of its own.
//
// no line carries a link and none may: a line says what a donor would see and stops there. this
// block reports, and a screen that cannot repair the thing it names adds nothing by pointing —
// what it would point at is another screen's own account of the same row, kept in step by hand.
//
// what this deployment itself can do — charge a card, send a receipt — is not reported here at all.
// that is settled on the console at the moment the keys are pasted
// (`packages/console-ui/src/lib/stripe-section.tsx`), which is the one place that can act on it.

/**
 * this screen's three words, in the operator surfaces' three tones.
 *
 * the mapping is here rather than in the library because these words are this block's own — they
 * say what a state costs on a donation-form screen, which is not the same question as how a thing
 * is doing in general. keyed by the union, so a fourth severity is a type error rather than a line
 * drawn with no tone at all.
 */
const TONES: Record<FormReadinessSeverity, 'blocker' | 'attention' | 'resolved'> = {
	blocker: 'blocker',
	warning: 'attention',
	resolved: 'resolved'
};

type FormsReadinessProps = {
	/**
	 * the lines as `formsReadiness` in `$lib/server/forms/readiness.ts` wrote them.
	 *
	 * the vocabulary is `$lib/forms/readiness.ts`, which both a component and that module may
	 * import; the module itself lives under `$lib/server/**` and a component may not reach it.
	 */
	readonly lines: readonly FormReadinessLine[] | null;
};

export function FormsReadiness({ lines }: FormsReadinessProps) {
	if (!lines) return null;

	return (
		// no heading over the list, and there must not be one. every line already carries a severity
		// word, the capability's name and what its state costs on this screen, so a sentence above
		// them can only restate the worst of those three in weaker words — and it would have to be
		// two sentences, since a blocker means a form is not served while a warning means one is
		// served and takes nothing. the lines make that difference themselves.
		//
		// one line per thing.
		//
		// a resolved line keeps its place and loses its sentence, and its severity word loses its
		// weight and its colour. it stays so that a list somebody is working through does not
		// renumber itself as they fix things, and it goes quiet so that done is the least of what is
		// on the screen.
		<StatusLedger>
			{lines.map((line) => (
				<StatusLine
					key={line.label}
					tone={TONES[line.severity]}
					// each line is one statement with nothing under it to open, so no label here
					// takes a level: an outline over three lines is a table of contents for a block
					// a reader has already finished.
					labelAs="span"
					label={line.label}
					word={FORM_READINESS_LABELS[line.severity]}
					note={line.detail === null ? undefined : <MarkedText text={line.detail} />}
				/>
			))}
		</StatusLedger>
	);
}
