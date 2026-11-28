import {
	type FocusEvent,
	type KeyboardEvent,
	type ReactNode,
	type RefObject,
	useEffect,
	useId,
	useRef,
	useState
} from 'react';
import { imageSrc } from '../page/image-src';
import type { PageLogo } from './page-view';

// the top of every donor page, and of the supporter's own screens: the registry's site-nav
// (packages/operator/src/registry/styles/site-nav-css.usage.md), its skip link first in the tab
// order and the organisation's logo and name as the home link, then, on every page but the
// Donation page, the nav's one link, Donate, to `/`. `/` is the Donation page itself, so there,
// and on its draft preview, it draws no Donate link. the menu button and its panel are drawn only
// where there is a link or an action to fold into them, so the Donation page, which no caller
// gives actions, is the home link alone at both widths.
//
// the registry hides the bar's links under 40rem, so where they are drawn they fold behind the
// registry's menu button and its panel.
//
// the panel is a disclosure, as the usage note's Behavior section has it: no focus trap, and it
// closes on Escape (focus back on the button), on a press on its row, on a pointer down outside it
// and the button, on focus leaving for anything but the button, and when the window widens past the
// fold.

/** the id the skip link targets: the page's `<main>`, which carries `tabIndex={-1}`. */
export const MAIN_ID = 'main';

/** the registry's fold, `.ds-site-nav-links` hidden under it in site-nav-css.css. */
const FOLD = '(width >= 40rem)';

export type SiteNavProps = {
	/** the organisation's name; null where none is set, which draws no home link. */
	readonly name: string | null;
	/** the organisation's logo, beside its name; null where it has none. */
	readonly logo: PageLogo | null;
	/** whether this is the Donation page, at `/` or its draft preview, which draws no Donate link. */
	readonly current: boolean;
	/**
	 * the bar's actions, a signed-in supporter's account on their own screens: drawn at the bar's end
	 * from 40rem, and under the menu's row below it, where the registry folds them.
	 */
	readonly actions?: ReactNode;
};

/** a logo at least twice as wide as it is tall, by the stored image's width and height. */
export const isWordmark = (logo: Pick<PageLogo, 'width' | 'height'>): boolean =>
	logo.width >= 2 * logo.height;

/**
 * the home link: a wordmark stands in for the name and carries it as its alt; a narrower logo
 * stands beside the name and says nothing of its own. the name is its own box, carried whole in its
 * title, so ./page.css can cut a long one to an ellipsis.
 */
function Brand({ name, logo }: { readonly name: string; readonly logo: PageLogo | null }) {
	const art = (alt: string) =>
		logo === null ? null : (
			<img
				className="page-site-logo"
				src={imageSrc(logo.imageId)}
				alt={alt}
				width={logo.width}
				height={logo.height}
			/>
		);
	return (
		<a className="ds-site-nav-brand" href="/">
			{logo !== null && isWordmark(logo) ? (
				art(name)
			) : (
				<>
					{art('')}
					<span className="page-site-name" title={name}>
						{name}
					</span>
				</>
			)}
		</a>
	);
}

export function SiteNav({ name, logo, current, actions }: SiteNavProps) {
	const menuId = useId();
	const [open, setOpen] = useState(false);
	const button = useRef<HTMLButtonElement>(null);
	const panel = useRef<HTMLElement>(null);

	useEffect(() => {
		if (!open) return;
		const wide = window.matchMedia(FOLD);
		const widened = () => {
			if (wide.matches) setOpen(false);
		};
		const outside = (event: PointerEvent) => {
			const target = event.target;
			if (!(target instanceof Node)) return;
			if (panel.current?.contains(target) || button.current?.contains(target)) return;
			setOpen(false);
		};
		wide.addEventListener('change', widened);
		document.addEventListener('pointerdown', outside);
		return () => {
			wide.removeEventListener('change', widened);
			document.removeEventListener('pointerdown', outside);
		};
	}, [open]);

	const closeOnEscape = (event: KeyboardEvent) => {
		if (event.key !== 'Escape' || !open) return;
		setOpen(false);
		button.current?.focus();
	};
	const closeOnLeave = (event: FocusEvent) => {
		const next = event.relatedTarget;
		if (next instanceof Node && (panel.current?.contains(next) || button.current === next)) return;
		setOpen(false);
	};
	const links = !current;
	const toggle = (
		<MenuToggle
			open={open}
			menuId={menuId}
			onToggle={() => setOpen((was) => !was)}
			onKeyDown={closeOnEscape}
			buttonRef={button}
		/>
	);

	return (
		<>
			<a className="ds-site-nav-skip" href={`#${MAIN_ID}`}>
				Skip to content
			</a>
			<header className="ds-site-nav">
				<div className="ds-site-nav-bar">
					{name === null ? null : <Brand name={name} logo={logo} />}
					{links ? (
						<nav className="ds-site-nav-links" aria-label="Main">
							<ul>
								<li>
									<a className="ds-site-nav-link" href="/">
										Donate
									</a>
								</li>
							</ul>
						</nav>
					) : null}
					{actions === undefined ? (
						links && toggle
					) : (
						<div className="ds-site-nav-end">
							<div className="ds-site-nav-actions">{actions}</div>
							{toggle}
						</div>
					)}
				</div>
				{links || actions !== undefined ? (
					<nav
						ref={panel}
						id={menuId}
						className="ds-site-nav-menu"
						aria-label="Main"
						hidden={!open}
						onKeyDown={closeOnEscape}
						onBlur={closeOnLeave}
					>
						{links ? (
							<ul>
								<li>
									<a className="ds-site-nav-menu-link" href="/" onClick={() => setOpen(false)}>
										Donate
									</a>
								</li>
							</ul>
						) : null}
						{actions === undefined ? null : (
							// biome-ignore lint/a11y/noStaticElementInteractions: a press on an action inside closes the panel, as a row's does (site-nav-css.usage.md).
							// biome-ignore lint/a11y/useKeyWithClickEvents: the click is the action's own, keyboard included; this only hears it bubble.
							<div className="ds-site-nav-menu-actions" onClick={() => setOpen(false)}>
								{actions}
							</div>
						)}
					</nav>
				) : null}
			</header>
		</>
	);
}

function MenuToggle({
	open,
	menuId,
	onToggle,
	onKeyDown,
	buttonRef
}: {
	readonly open: boolean;
	readonly menuId: string;
	readonly onToggle: () => void;
	readonly onKeyDown: (event: KeyboardEvent) => void;
	readonly buttonRef: RefObject<HTMLButtonElement | null>;
}) {
	return (
		<button
			ref={buttonRef}
			type="button"
			className="ds-btn ds-btn-ghost ds-btn-field ds-btn-icon ds-site-nav-toggle"
			aria-label="Menu"
			aria-expanded={open}
			aria-controls={menuId}
			onClick={onToggle}
			onKeyDown={onKeyDown}
		>
			<svg
				width="20"
				height="20"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				strokeWidth="2"
				strokeLinecap="round"
				strokeLinejoin="round"
				aria-hidden="true"
			>
				{/* lucide's `menu` closed and its `x` open, as the usage note gives them. */}
				{open ? (
					<>
						<path d="M18 6 6 18" />
						<path d="m6 6 12 12" />
					</>
				) : (
					<>
						<path d="M4 5h16" />
						<path d="M4 12h16" />
						<path d="M4 19h16" />
					</>
				)}
			</svg>
		</button>
	);
}
