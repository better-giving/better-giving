import { type ReactNode, useId } from 'react';
import { Mark, type MarkName } from './glyph';

// the registry's two cards as the supporter's screens draw them (notice-card-css, state-card-css):
// a notice named by its title with its tone's glyph, and the state card a list or a table stands
// in for when there is nothing in it.

type Tone = 'info' | 'success' | 'warning' | 'destructive';

const TONE_MARK: Record<Tone, MarkName> = {
	info: 'info',
	success: 'done',
	warning: 'warning',
	destructive: 'alert'
};

export function NoticeCard({
	tone,
	title,
	heading = 'h2',
	alert = false,
	actions,
	className,
	children
}: {
	readonly tone: Tone;
	readonly title: string;
	readonly heading?: 'h1' | 'h2';
	/** a card that stands for a refusal the reader just met is said as it lands. */
	readonly alert?: boolean;
	readonly actions?: ReactNode;
	readonly className?: string | undefined;
	readonly children: ReactNode;
}) {
	const titleId = `${useId()}-title`;
	const Heading = heading;
	return (
		<section
			className={`ds-notice-card ds-notice-card-${tone}${className ? ` ${className}` : ''}`}
			aria-labelledby={titleId}
			role={alert ? 'alert' : undefined}
		>
			<span className="ds-notice-card-icon">
				<Mark name={TONE_MARK[tone]} />
			</span>
			<div className="ds-notice-card-content">
				<div className="ds-notice-card-text">
					<Heading className="ds-notice-card-title" id={titleId}>
						{title}
					</Heading>
					<div className="ds-notice-card-body">{children}</div>
				</div>
				{actions === undefined ? null : <div className="ds-notice-card-actions">{actions}</div>}
			</div>
		</section>
	);
}

export function StateCard({
	title,
	heading = 'h2',
	action,
	children
}: {
	readonly title: string;
	readonly heading?: 'h1' | 'h2' | 'h3';
	readonly action?: ReactNode;
	readonly children: ReactNode;
}) {
	const Heading = heading;
	return (
		<div className="ds-state-card">
			<Heading className="ds-state-card-title">{title}</Heading>
			<p className="ds-state-card-body">{children}</p>
			{action === undefined ? null : <div className="ds-state-card-action">{action}</div>}
		</div>
	);
}
