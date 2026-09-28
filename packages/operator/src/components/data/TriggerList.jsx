import { Mark } from '../status/Mark.jsx';

/**
 * @import { ReactNode } from 'react'
 * @import { MarkName } from '../status/Mark.jsx'
 */

/**
 * @typedef {object} Trigger
 * @property {string} id the trigger's own key, which is what the line is keyed by.
 * @property {MarkName} mark
 * @property {ReactNode} name in a fundraiser's words — `Settled gifts`, never the event's key.
 * @property {ReactNode} [count] how many automations are listening, already worded — `2 Zaps
 *   listening`. absent where none is: a line saying nobody listens is a line nobody asked for.
 *
 * @typedef {object} TriggerListProps
 * @property {readonly Trigger[]} items
 */

/* what an outside app is handed to act on, one line each. a plain list: nothing on a line asks the
   operator to act, so no line is a status line. `.adm-triggers` in
   packages/operator/src/styles/adm.css draws it. */
/** @param {TriggerListProps} props */
export function TriggerList({ items }) {
	return (
		<ul className="adm-triggers">
			{items.map(({ id, mark, name, count }) => (
				<li key={id}>
					<Mark name={mark} />
					<span className="adm-triggers__name">{name}</span>
					{count ? <span className="adm-triggers__count">{count}</span> : null}
				</li>
			))}
		</ul>
	);
}
