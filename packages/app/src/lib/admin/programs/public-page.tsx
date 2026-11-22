import { Button } from '@better-giving/operator/components/controls/Button';
import { CodeSlab } from '@better-giving/operator/components/data/CodeSlab';
import { useId } from 'react';

// the body of the program editor's Public page card: the program's public address and how the page
// at it looks. the screen draws the card and its heading around this.
//
// an archived program's page tells donors it is not taking gifts, so the card keeps only the
// sentence saying so and the way to look at it: an address to copy and a preview of a page nobody
// can give on would hand out a link to a closed door.

export type PublicPageCardProps = {
	/** the program's name, which titles the preview for a reader who reaches it. */
	readonly name: string;
	/** the page's absolute public address: what is shown, copied and opened. */
	readonly url: string;
	/** what the preview frame loads: the saved page in its preview state. */
	readonly previewSrc: string;
	readonly archived: boolean;
};

export function PublicPageCard({ name, url, previewSrc, archived }: PublicPageCardProps) {
	const linkId = `${useId()}-link`;

	const openPage = (
		<div className="adm-actions">
			<Button as="a" href={url} target="_blank" rel="noopener" markAfter="external-link">
				Open page
			</Button>
		</div>
	);

	if (archived) {
		return (
			<>
				<p className="adm-prose">
					This program is archived, so its page tells donors it isn’t taking gifts and offers the
					donate page.
				</p>
				{openPage}
			</>
		);
	}

	return (
		<>
			<p className="adm-prose">Donors who open this link see the program and can give to it.</p>

			<div className="adm-named">
				<h3 id={linkId}>Link</h3>
				<CodeSlab
					oneline
					content={url}
					copyable
					labelledBy={linkId}
					copyLabel="Copy link"
					copiedLabel="Link copied"
				/>
				{openPage}
			</div>

			<div className="adm-named">
				<h3>Preview</h3>
				<p className="adm-hint">How the page looks on a phone. It shows what is saved.</p>
				{/* the frame itself is no tab stop; the page inside takes its own stops out, through its
				    `preview` prop. */}
				<iframe
					className="adm-preview"
					src={previewSrc}
					title={`Preview of the ${name} page`}
					tabIndex={-1}
				/>
			</div>
		</>
	);
}
