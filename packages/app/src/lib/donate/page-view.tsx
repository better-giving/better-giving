import { type ReactNode, useEffect } from 'react';
import type { ProgramMode } from '../forms/program-modes';
import type { Page } from '../page/catalog';
import { imageSrc } from '../page/image-src';
import type { PageType } from '../page/keys';
import { type CampaignShape, campaignShape } from '../page/shape';
import { isEmptyDocument } from '../rich-text/document';
import { PageRoot } from './page-root';
import { AboutUs } from './sections/about-us';
import { Cover } from './sections/cover';
import { Faq } from './sections/faq';
import { GoalBar } from './sections/goal-bar';
import { OrgInfo } from './sections/org-info';
import { Photos } from './sections/photos';
import { ProgramChooser } from './sections/program-chooser';
import { Share } from './sections/share';
import { Story } from './sections/story';
import { Tiers } from './sections/tiers';
import type { PageGoal, PageMoney, PageOrg, PageProgram, PageSharing } from './sections/types';

// a donor page drawn from its stored content: the Donation page at /donate, a campaign at its
// address, and either one as the editor's preview. one renderer for all three, so the preview is
// what a donor sees.
//
// the route reads everything a section draws beyond the page's own content and hands it in, and it
// builds the donation box itself (`donationBox`), so nothing here knows the card's props.
//
// a campaign is drawn in the one whole layout $lib/page/shape.ts picks from its content — the card,
// the letter or the feature — and the Donation page in its own fixed one. no section is placed by
// the organisation: each layout has its order, and a section with nothing in it is left out. the
// sections stand in the order a phone reads them, and ./page.css moves them into columns from
// `@container page (min-width: 60rem)`:
//
// - card: the cover, the title, the goal, the donation box, the lede and the story. on a phone the
//   cover, the title, the lede and the goal stand in one plane, then the box, then the story. wide,
//   the box stands in a column of its own beside the words, under the cover.
// - letter: the cover framed, the title, then a rail of the goal, the box and the tiers, then the
//   lede, the story, the photos and the questions. wide, the rail is a column beside the reading
//   column.
// - feature: the cover, the title, the lede, the goal, then the box, then the story, the tiers as
//   cards, a strip of photos, the questions folded, and About us. wide, the cover runs the page's
//   width with the title, lede and goal over it and the box over its right side.
// - the Donation page: the title, the program chooser, then the box; About us. wide, the box stands
//   beside the title and the chooser.
//
// every page closes on its share buttons and the organisation's footer. on a phone ./page.css stands
// the letter's and the feature's box straight after the cover and the title, the goal and the lede
// after it, so all of their box is on the first screen; the card's box begins on it, under the
// plane, and ./page.css's header sums what stands ahead of it. the source order keeps the box ahead
// of the story and everything after it, which ./page-view.dom.spec.tsx holds.
// the box is drawn exactly once, and no ancestor of it clips or transforms it.
//
// the masthead is the top bar over every page: it names the organisation at its start and, on a
// page with a share section, ends on a Share link to it. with a logo, a logo at least
// twice as wide as it is tall stands in for the name and carries it as its alt, and a narrower one
// stands beside the name and says nothing of its own; the stored image's width and height decide.
// with none, a badge of the name's initials stands beside the name, in the page's brand fill and
// corner (./page.css), and like a narrower logo says nothing of its own. a program's photo stands on
// its chooser option. every image arrives by stored image id, drawn from the deployment's own image
// route and never from an address a page carries.

export type PageLook = {
	/** lowercase `#rrggbb`, or null for the form's own grey: the page's only accent. */
	readonly brandColour: string | null;
};

/** the organisation's logo: its stored image, and that image's shape. */
export type PageLogo = {
	readonly imageId: string;
	readonly width: number;
	readonly height: number;
};

export type PageViewProps = {
	readonly type: PageType;
	readonly page: Page;
	/** a campaign's name, which an empty heading draws; null on the Donation page. */
	readonly pageName: string | null;
	readonly org: PageOrg;
	/** the organisation's logo, atop the page and in place of a missing cover; null or absent where it has none. */
	readonly logo?: PageLogo | null | undefined;
	/** the colour the page is drawn in: the organisation's brand colour. */
	readonly look: PageLook;
	readonly sharing: PageSharing;
	/** a campaign's goal; null where it has none, and on the Donation page. */
	readonly goal: PageGoal | null;
	readonly money: PageMoney;
	/** the active programs the box would offer, in their order. */
	readonly programs: readonly PageProgram[];
	readonly programMode: ProgramMode;
	/** a program's photo on the chooser, as its stored image id, by the program's id. */
	readonly programPhotos?: Readonly<Record<string, string>> | undefined;
	/** the donation box, built by the route; `hideProgramSelect` is set where the chooser is drawn. */
	readonly donationBox: (options: { readonly hideProgramSelect: boolean }) => ReactNode;
	/** a pick on the program chooser: a program's id, or null for where it's needed most. */
	readonly onProgramPick?: (id: string | null) => void;
	readonly chosenProgramId?: string | null;
	/** the chooser takes no pick: the gift it would change has already been asked for. */
	readonly chooserLocked?: boolean;
	/** drawn as the preview of a draft: a press reaches nothing. */
	readonly preview?: boolean;
	/** the caller's placement of the page root. */
	readonly className?: string;
};

/** the prop every section wrapper carries: its area. */
const area = (name: string) => ({ 'data-area': name });

export function PageView(props: PageViewProps) {
	const { page, look, org, preview = false, className } = props;
	usePreviewStill(preview);
	const shape =
		props.type === 'campaign'
			? campaignShape(page, {
					logoImageId: props.logo?.imageId ?? null,
					hasMission: org.mission !== null || org.vision !== null
				})
			: null;
	return (
		<PageRoot
			brandColour={look.brandColour}
			layout={shape?.layout ?? 'donation'}
			{...(className === undefined ? {} : { className })}
		>
			<Masthead name={org.name} logo={props.logo ?? null} shareTarget={SHARE_ID} />
			<main className="page-body">
				{shape === null ? (
					<DonationLayout {...props} />
				) : (
					<CampaignLayout {...props} shape={shape} />
				)}
			</main>
			<footer className="page-foot">
				<section className="page-end" id={SHARE_ID} {...area('share')}>
					<div className="page-in">
						<Share
							sharing={props.sharing}
							heading={props.type === 'campaign' ? 'Share this campaign' : 'Share this page'}
						/>
					</div>
				</section>
				<div className="page-in">
					<OrgInfo info={org.info} />
				</div>
			</footer>
		</PageRoot>
	);
}

/** the share section's id, which the top bar's Share link jumps to. */
const SHARE_ID = 'page-share';

/** the donation box, inert in the preview, where a click on it opens the settings it draws. */
function Box({ props, hideProgramSelect }: { props: PageViewProps; hideProgramSelect: boolean }) {
	return (
		<div className="page-box" {...area('box')}>
			<div inert={props.preview ?? false}>{props.donationBox({ hideProgramSelect })}</div>
		</div>
	);
}

/**
 * a title of more characters than this, counted as a reader sees them with its edges trimmed, is
 * drawn a step smaller below 60rem (`data-long`, ./page.css): on a phone the box stands under the
 * title, and the smaller title takes fewer lines. in the letter and the feature a title past about
 * 110 characters still pushes the box's foot below a 390 × 844 phone's first screen.
 */
export const TITLE_LONG = 28;

function Heading({ props }: { props: PageViewProps }) {
	const title = titleHeading(props.page.heading, props);
	return (
		<h1
			className="page-title"
			data-long={[...graphemes.segment(title.trim())].length > TITLE_LONG ? '' : undefined}
			{...area('title')}
		>
			{title}
		</h1>
	);
}

function CampaignLayout(props: PageViewProps & { readonly shape: CampaignShape }) {
	const { page, shape, goal, money } = props;
	const story = page.story !== undefined && !isEmptyDocument(page.story) ? page.story : null;
	const tiers = page.tiers ?? [];
	const photos = page.photos ?? [];
	const faq = page.faq ?? [];
	const lede =
		page.lede === undefined || page.lede === '' ? null : (
			<p className="page-lede" {...area('lede')}>
				{page.lede}
			</p>
		);
	const goalBar =
		shape.goalBar && goal !== null ? (
			<div {...area('goal')}>
				<GoalBar goal={goal} money={money} />
			</div>
		) : null;
	const cover =
		shape.cover === null ? null : (
			<div className="page-cover-area" {...area('cover')}>
				<Cover cover={shape.cover} imageSrc={imageSrc} />
			</div>
		);
	const box = <Box props={props} hideProgramSelect={false} />;
	const storySection =
		story === null ? null : (
			<div {...area('story')}>
				<Story doc={story} />
			</div>
		);
	const tiersSection = (shapeOf: 'list' | 'cards') =>
		tiers.length === 0 ? null : (
			<section className="page-section" {...area('tiers')}>
				<Tiers tiers={tiers} money={money} shape={shapeOf} />
			</section>
		);
	const photosSection = (shapeOf: 'column' | 'strip') =>
		photos.length === 0 ? null : (
			<section className="page-section" aria-label="Photos" {...area('photos')}>
				<Photos photos={photos} imageSrc={imageSrc} shape={shapeOf} />
			</section>
		);
	const faqSection = (folded: boolean) =>
		faq.length === 0 ? null : (
			<section className="page-section" {...area('faq')}>
				<Faq items={faq} domId="page" folded={folded} />
			</section>
		);

	switch (shape.layout) {
		case 'card':
			return (
				<div className="page-in page-layout">
					{cover}
					<Heading props={props} />
					{goalBar}
					{box}
					{lede}
					{storySection}
				</div>
			);
		case 'letter':
			return (
				<div className="page-in page-layout">
					{cover}
					<Heading props={props} />
					<div className="page-rail" data-area="rail">
						{goalBar}
						{box}
						{tiersSection('list')}
					</div>
					{lede}
					{storySection}
					{photosSection('column')}
					{faqSection(false)}
				</div>
			);
		case 'feature':
			return (
				<>
					<div
						className="page-layout"
						data-cover={shape.cover === null ? 'none' : shape.cover.source}
					>
						{cover ?? <div className="page-cover-area" data-area="cover" />}
						<div className="page-hero-words" data-area="words">
							<Heading props={props} />
							{lede}
							{goalBar}
						</div>
						<div className="page-rail" data-area="rail">
							{box}
						</div>
						{storySection}
						{tiersSection('cards')}
						{photosSection('strip')}
						{faqSection(true)}
					</div>
					{shape.aboutUs ? (
						<section className="page-about-area" data-area="about">
							<div className="page-in">
								<AboutUs mission={props.org.mission} vision={props.org.vision} />
							</div>
						</section>
					) : null}
				</>
			);
	}
}

function DonationLayout(props: PageViewProps) {
	const chooser =
		props.programMode === 'choice' && props.programs.length >= 2 ? (
			<div {...area('chooser')}>
				<ProgramChooser
					programs={props.programs}
					chosen={props.chosenProgramId ?? null}
					onPick={props.onProgramPick}
					locked={props.chooserLocked ?? false}
					domId="page"
					photos={props.programPhotos}
				/>
			</div>
		) : null;
	const { mission, vision } = props.org;
	return (
		<>
			<div className="page-in page-layout">
				<Heading props={props} />
				{chooser}
				<Box props={props} hideProgramSelect={chooser !== null} />
			</div>
			{mission === null && vision === null ? null : (
				<section className="page-about-area" data-area="about">
					<div className="page-in">
						<AboutUs mission={mission} vision={vision} />
					</div>
				</section>
			)}
		</>
	);
}

export function Masthead({
	name,
	logo,
	shareTarget
}: {
	readonly name: string;
	readonly logo: PageLogo | null;
	/** the id of the page's share section, which a Share link at the bar's end jumps to; absent where none. */
	readonly shareTarget?: string | undefined;
}) {
	const share =
		shareTarget === undefined ? null : (
			<a className="page-mast-share" href={`#${shareTarget}`}>
				Share
			</a>
		);
	if (logo === null) {
		const letters = initials(name);
		return (
			<header className="page-mast">
				<div className="page-in page-mast-in">
					{letters === '' ? null : (
						<span className="page-mast-badge" aria-hidden="true">
							{letters}
						</span>
					)}
					<p className="page-mast-name" title={name}>
						{name}
					</p>
					{share}
				</div>
			</header>
		);
	}
	const art = (alt: string) => (
		<img
			className="page-mast-logo"
			src={imageSrc(logo.imageId)}
			alt={alt}
			width={logo.width}
			height={logo.height}
		/>
	);
	return (
		<header className="page-mast">
			<div className="page-in page-mast-in">
				{logo.width >= 2 * logo.height ? (
					<p className="page-mast-name">{art(name)}</p>
				) : (
					<>
						{art('')}
						<p className="page-mast-name" title={name}>
							{name}
						</p>
					</>
				)}
				{share}
			</div>
		</header>
	);
}

/**
 * one initial for each of the name's first two words, a leading "The" passed over where a word
 * follows it: "The Hope Fund" is `HF`, "Kiva" is `K`. a word's initial is the grapheme its first
 * letter starts, upper-cased with no locale and cut back to one grapheme, so `ß` is `S`, `ﬁ` is `F`,
 * a decomposed accent keeps its mark, and the server's render and a Turkish-locale browser's
 * hydration read the same `I`. a word's leading Arabic article `ال` is passed over where the word
 * runs past it, and two Arabic-script initials stand apart with a zero-width non-joiner between, so
 * they read as two letters rather than one joined word. a word holding no letter, an `&`, a dash or
 * a `1%`, is not counted; with no word counted the first letter anywhere in the name stands alone,
 * so "The 1%" is `T`, and a name with no letter is `''`, which draws no badge.
 */
export function initials(name: string): string {
	const words = name.split(/\s+/).filter((word) => word !== '');
	const named = words.length > 1 && words[0]?.toLowerCase() === 'the' ? words.slice(1) : words;
	const [first, second] = named
		.flatMap((word) => firstLetter(withoutArticle(word)) ?? [])
		.slice(0, 2)
		.map(upperInitial);
	if (first === undefined) {
		const anywhere = firstLetter(name);
		return anywhere === null ? '' : upperInitial(anywhere);
	}
	if (second === undefined) return first;
	return ARABIC_SCRIPT.test(first) && ARABIC_SCRIPT.test(second)
		? `${first}${ZERO_WIDTH_NON_JOINER}${second}`
		: `${first}${second}`;
}

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const ARABIC_ARTICLE = '\u0627\u0644';
const ARABIC_SCRIPT = /^\p{Script=Arabic}/u;
const ZERO_WIDTH_NON_JOINER = '\u200C';

function withoutArticle(word: string): string {
	return word.startsWith(ARABIC_ARTICLE) && word.length > ARABIC_ARTICLE.length
		? word.slice(ARABIC_ARTICLE.length)
		: word;
}

function firstLetter(text: string): string | null {
	for (const { segment } of graphemes.segment(text)) {
		if (/^\p{L}/u.test(segment)) return segment;
	}
	return null;
}

function upperInitial(grapheme: string): string {
	const [upper] = graphemes.segment(grapheme.toUpperCase());
	return upper?.segment ?? '';
}

/** an empty heading draws a campaign's name, and on the Donation page "Donate to" the organisation. */
export function titleHeading(
	heading: string,
	{
		type,
		pageName,
		org
	}: Pick<PageViewProps, 'type' | 'pageName'> & { readonly org: Pick<PageOrg, 'name'> }
) {
	if (heading.trim() !== '') return heading;
	if (type === 'campaign' && pageName !== null) return pageName;
	return `Donate to ${org.name}`;
}

/** every element a keyboard can stop on, the ones inside the inert donation box aside. */
const TAB_STOPS =
	'a[href], area[href], button, input, select, textarea, summary, iframe, [tabindex], [contenteditable]';

/**
 * in the preview a press reaches nothing: the preview is a picture of the draft, so a link, a share
 * or a pick in it is not followed, and no handler of a section's hears it. nothing in it takes a tab
 * stop either — the donation box is inert, and every other stop is taken out of the order.
 */
function usePreviewStill(preview: boolean) {
	useEffect(() => {
		if (!preview) return;
		for (const stop of document.querySelectorAll<HTMLElement>(TAB_STOPS)) stop.tabIndex = -1;
		const still = (event: MouseEvent) => {
			event.preventDefault();
			event.stopPropagation();
		};
		document.addEventListener('click', still, true);
		return () => document.removeEventListener('click', still, true);
	}, [preview]);
}
