import type { BlockOf, OrgInfo } from './types';

// who the gift is made to, as the organisation's legal details state it: `footer` closes the page,
// `card` stands among the blocks.

export function OrgInfoBlock({
	block,
	info
}: {
	readonly block: BlockOf<'org-info'>;
	readonly info: OrgInfo;
}) {
	const ein = info.ein === null ? null : <p>EIN {info.ein}</p>;
	const address =
		info.addressLines.length === 0 ? null : (
			<p>
				{info.addressLines.map((line, index) => (
					<span className="page-org-line" key={`${index}-${line}`}>
						{line}
					</span>
				))}
			</p>
		);
	const email =
		info.email === null ? null : (
			<p>
				<a href={`mailto:${info.email}`}>{info.email}</a>
			</p>
		);
	const links =
		info.links.length === 0 ? null : (
			<p className="page-org-links">
				{info.links.map((link) => (
					<a key={link.href} href={link.href} target="_blank" rel="noopener noreferrer">
						{link.label}
					</a>
				))}
			</p>
		);
	if (block.variant === 'card') {
		return (
			<div className="page-org" data-variant="card">
				<h2 className="page-org-name">{info.legalName}</h2>
				{ein}
				{address}
				{email}
				{links}
			</div>
		);
	}
	return (
		<div className="page-org" data-variant="footer">
			<div>
				<p className="page-org-name">{info.legalName}</p>
				{ein}
			</div>
			<div>{address}</div>
			<div>
				{email}
				{links}
			</div>
		</div>
	);
}
