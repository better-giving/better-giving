import { useState } from 'react';
import { RouteProgress } from '@better-giving/operator/components/shell/RouteProgress';

/*
 * the route-load line on top-bar-css, in a bar of its own: Start runs a navigation (5%, then toward
 * 95%), Land finishes it (100%, faded and gone 300ms later).
 */
export default function ShellRouteProgressPreview() {
	const [busy, setBusy] = useState(false);
	return (
		<header className="ds-topbar">
			<RouteProgress busy={busy} />
			<div className="ds-topbar-lead">
				<p className="ds-topbar-title">Greenfield Food Bank</p>
			</div>
			<div className="ds-topbar-actions">
				<button type="button" className="ds-btn ds-btn-secondary" onClick={() => setBusy(!busy)}>
					{busy ? 'Land' : 'Start'}
				</button>
			</div>
		</header>
	);
}
