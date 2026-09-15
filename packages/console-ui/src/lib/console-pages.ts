import type {
	Destination,
	DestinationGroup
} from '@better-giving/operator/components/shell/AppShell';
import type { DestinationStatus } from '@better-giving/operator/components/shell/DestinationCell';
import type { MarkName } from '@better-giving/operator/components/status/Mark';
import { FOLD_LABELS, JOB_WORDS } from '@better-giving/operator/setup-folds';
import type { PaymentProcessor } from '../api/types';
import type { HomeSection, SectionId } from './home-sections';
import type { ProcessorLink } from './processor-links';

// the console's pages: one per set-up section, and the rail that lists them.
//
// **there is no home page, and the rail is the overview.** each section's row reports where its job
// stands on the rail cell that opens it, so `/` on a ready deployment draws nothing and sends the
// operator to the first page with something left to do ({@link firstUnfinishedPage}).
//
// nothing here reaches a network, so ./console-pages.spec.ts reads all of it as values.

/**
 * the page each section is drawn on.
 *
 * `payments` is a page per processor, and names Stripe's: a deployment holding any processor's pair
 * takes a gift (./home-sections.ts), so a payments job left undone is one no processor's page has
 * finished, and Stripe is the first of them in the rail.
 */
export const SECTION_PAGES: Record<SectionId, string> = {
	password: '/password',
	organisation: '/organisation',
	payments: '/payments/stripe',
	sites: '/sites',
	smtp: '/smtp',
	notifications: '/notifications'
};

/** the processor logos the rail draws, which are assets the caller resolves to addresses. */
export type ProcessorLogos = Record<PaymentProcessor, string>;

/**
 * a job row's status, drawn in the glyph StatusLine gives its tone: a tick over a finished job and
 * the unfilled outline over an unfinished one.
 */
const TONE_MARKS = { done: 'check', attention: 'circle-dashed' } as const;

/**
 * a section's status on its rail cell, which is its row read out: the tone, the shape and the word.
 *
 * the sites row is no job and carries no word where the donation page is the whole of the list
 * (./home-sections.ts), so its cell draws no status there — a mark with nothing for a reader to hear
 * after the name is a finding with no words.
 */
function sectionStatus(section: HomeSection): DestinationStatus | undefined {
	if (section.word === null) return undefined;
	const mark =
		section.mark ?? (section.tone === 'note' ? 'circle-dashed' : TONE_MARKS[section.tone]);
	return { tone: section.tone, mark, label: section.word };
}

/**
 * a processor's status on its rail cell, off whether the deployment holds that processor's pair.
 *
 * **it is not the payments row.** that row is done as soon as either pair is held, which is the
 * deployment's own reading of whether a gift can be taken; a cell marked off it would tick PayPal on
 * a deployment that holds only Stripe's keys. the word is `Not set up` rather than `Incomplete`,
 * because one processor left unset is no job left undone.
 */
function processorStatus(link: ProcessorLink): DestinationStatus {
	return link.notSetUp
		? { tone: 'attention', mark: TONE_MARKS.attention, label: 'Not set up' }
		: { tone: 'done', mark: TONE_MARKS.done, label: JOB_WORDS.ready };
}

/**
 * the rail, in three groups: the two sections an operator opens on, the processors under their own
 * heading, and the three that carry a gift out to the world.
 *
 * every label is the section's own row label, except the site list's: its row label is a sentence
 * (`FOLD_LABELS.sites`), which the page states under its name rather than a cell carrying it.
 */
export function railGroups(
	sections: readonly HomeSection[],
	processors: readonly ProcessorLink[],
	logos: ProcessorLogos
): DestinationGroup[] {
	const row = (id: SectionId) => sections.find((section) => section.id === id);
	const cell = (id: SectionId, short: string, mark: MarkName, label?: string): Destination => {
		const section = row(id);
		return {
			label: label ?? FOLD_LABELS[id],
			short,
			href: SECTION_PAGES[id],
			mark,
			status: section === undefined ? undefined : sectionStatus(section)
		};
	};

	return [
		{
			destinations: [
				cell('password', 'Password', 'key-round'),
				cell('organisation', 'Organisation', 'building-2')
			]
		},
		{
			heading: FOLD_LABELS.payments,
			destinations: processors.map((link) => ({
				label: link.name,
				short: link.name,
				href: link.href,
				mark: { src: logos[link.processor] },
				status: processorStatus(link)
			}))
		},
		{
			destinations: [
				cell('sites', SITES_TITLE, 'globe', SITES_TITLE),
				cell('smtp', FOLD_LABELS.smtp, 'mail'),
				cell('notifications', FOLD_LABELS.notifications, 'bell')
			]
		}
	];
}

/** what the site list's page and cell are called. */
export const SITES_TITLE = 'Sites';

/**
 * where `/` sends an operator on a ready deployment: the first page in rail order whose job is
 * undone, or the first page of all where none is. the sites row is no job and is never undone.
 */
export function firstUnfinishedPage(sections: readonly HomeSection[]): string {
	const undone = sections.find((section) => section.state === 'todo');
	return SECTION_PAGES[undone?.id ?? 'password'];
}
