import { useEffect, useRef, useState } from 'react';
import { Mark } from '../status/Mark.jsx';

/**
 * @import { MouseEvent, ReactNode } from 'react'
 */

/**
 * @typedef {object} SettingsLayoutProps
 * @property {ReactNode} [children] the section's cards, each a `ds-card`.
 *
 * where a section's form stands, as settings-layout-css draws it: `pristine` has nothing to save,
 * `dirty` has, `saving` is in flight and `saved` landed. the caller holds `saved` for 2000ms and
 * then hands `pristine` (settings-layout-css), and never hands it for a failed save.
 *
 * @typedef {'pristine' | 'dirty' | 'saving' | 'saved'} SettingsSaveState
 *
 * @typedef {object} SettingsSaveProps
 * @property {SettingsSaveState} state
 * @property {string} form the id of the `<form>` the Save button submits.
 * @property {string} saveLabel what Save says: "Save details", "Save address".
 * @property {() => void} onDiscard makes the form pristine.
 */

/* a settings section's stack of cards. the section links are the sidebar's, so it holds no nav. */
/** @param {SettingsLayoutProps} props */
export function SettingsLayout({ children }) {
	return <div className="ds-settings adm-settings">{children}</div>;
}

/* Discard and Save at the end of a card's footer, through the four states settings-layout-css
   draws with button-css attributes. Save is never `disabled`, so focus stays on it from the press
   to "Saved"; a press the state closes is stopped here, Save's submit with it. the status region
   is in the footer from the start and says "Saved", never a failure. */
/** @param {SettingsSaveProps} props */
export function SettingsSave({ state, form, saveLabel, onDiscard }) {
	const save = useRef(/** @type {HTMLButtonElement | null} */ (null));
	/* which of the two had focus last. Discard leaves the row when the save lands, and a removed
	   button drops focus on `<body>`, so focus moves to Save first. */
	const lastFocused = useRef(/** @type {'discard' | 'save' | null} */ (null));
	const [said, setSaid] = useState('');

	useEffect(() => {
		if (state !== 'saved') {
			setSaid('');
			return;
		}
		setSaid('Saved');
		const lost = document.activeElement === null || document.activeElement === document.body;
		if (lost && lastFocused.current === 'discard') save.current?.focus();
	}, [state]);

	const discardClosed = state === 'pristine' || state === 'saving';
	const saveClosed = state === 'pristine' || state === 'saving' || state === 'saved';
	/** @param {boolean} closed */
	const stopIf = (closed) => (/** @type {MouseEvent} */ event) => {
		if (closed) event.preventDefault();
	};

	return (
		<>
			<div className="ds-settings-save">
				{state === 'saved' ? null : (
					<button
						type="button"
						className="ds-btn ds-btn-secondary"
						aria-disabled={discardClosed || undefined}
						onFocus={() => {
							lastFocused.current = 'discard';
						}}
						onClick={(event) => {
							stopIf(discardClosed)(event);
							if (!discardClosed) onDiscard();
						}}
					>
						Discard
					</button>
				)}
				<button
					ref={save}
					type="submit"
					form={form}
					className="ds-btn ds-btn-primary"
					aria-disabled={saveClosed || undefined}
					aria-busy={state === 'saving' || undefined}
					data-done={state === 'saved' ? 'true' : undefined}
					onFocus={() => {
						lastFocused.current = 'save';
					}}
					onClick={stopIf(saveClosed)}
				>
					{state === 'saving' ? (
						<>
							<span className="ds-spinner ds-spinner-sm" aria-hidden="true" />
							Saving…
						</>
					) : state === 'saved' ? (
						<>
							<Mark name="check" />
							Saved
						</>
					) : (
						saveLabel
					)}
				</button>
			</div>
			<span role="status" className="ds-sr-only">
				{said}
			</span>
		</>
	);
}
