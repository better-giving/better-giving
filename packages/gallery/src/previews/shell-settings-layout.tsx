import { useState } from 'react';
import {
	SettingsLayout,
	SettingsSave,
	type SettingsSaveState
} from '@better-giving/operator/components/shell/SettingsLayout';

/*
 * a settings section's cards on settings-layout-css, with the save row through its four states:
 * the first card is live (type in it, Save runs a second's write, holds Saved for two seconds and
 * goes back to pristine), and the three under it pin dirty, saving and saved.
 */
function Notifications() {
	const [state, setState] = useState<SettingsSaveState>('pristine');
	return (
		<section className="ds-card" aria-labelledby="gallery-notifications">
			<header className="ds-card-header">
				<h2 id="gallery-notifications">Notifications</h2>
			</header>
			<form
				id="gallery-notifications-form"
				className="ds-card-body"
				onSubmit={(event) => {
					event.preventDefault();
					setState('saving');
					setTimeout(() => setState('saved'), 1000);
					setTimeout(() => setState('pristine'), 3000);
				}}
			>
				<div className="ds-field">
					<label className="ds-label" htmlFor="gallery-notification-email">
						Notification email
					</label>
					<input
						className="ds-field-input"
						id="gallery-notification-email"
						type="email"
						defaultValue="alerts@greenfieldfoodbank.org"
						onInput={() => setState('dirty')}
					/>
				</div>
			</form>
			<footer className="ds-card-footer">
				<SettingsSave
					state={state}
					form="gallery-notifications-form"
					saveLabel="Save address"
					onDiscard={() => setState('pristine')}
				/>
			</footer>
		</section>
	);
}

const PINNED: SettingsSaveState[] = ['dirty', 'saving', 'saved'];

export default function ShellSettingsLayoutPreview() {
	return (
		<SettingsLayout>
			<Notifications />
			{PINNED.map((state) => (
				<section className="ds-card" key={state} aria-label={`Save row, ${state}`}>
					<footer className="ds-card-footer">
						<SettingsSave
							state={state}
							form={`gallery-${state}`}
							saveLabel="Save details"
							onDiscard={() => {}}
						/>
					</footer>
				</section>
			))}
		</SettingsLayout>
	);
}
