import { TriggerList } from '@better-giving/operator/components/data/TriggerList';

/*
 * the list of what an outside app is handed to act on, in the two states the Zapier page draws it:
 * with automations listening on some lines and not on others, and with none listening anywhere —
 * which is the page before a single Zap is connected. the count is absent rather than zero on a line
 * nobody listens to, so the second specimen is the same three names with nothing at the far end.
 *
 * the third is a name long enough to wrap beside a count, which is where the mark has to stay on
 * the first line and the count has to keep its own end of the row.
 */
export default function DataTriggerListPreview() {
	return (
		<div className="adm-stack">
			<TriggerList
				items={[
					{ id: 'gift', mark: 'stamp', name: 'Settled gifts', count: '2 Zaps listening' },
					{ id: 'donor', mark: 'users', name: 'New donors', count: '1 Zap listening' },
					{ id: 'refund', mark: 'arrow-left', name: 'Refunds' }
				]}
			/>
			<TriggerList
				items={[
					{ id: 'gift', mark: 'stamp', name: 'Settled gifts' },
					{ id: 'donor', mark: 'users', name: 'New donors' },
					{ id: 'refund', mark: 'arrow-left', name: 'Refunds' }
				]}
			/>
			<TriggerList
				items={[
					{
						id: 'gift',
						mark: 'stamp',
						name: 'Settled gifts to the winter night shelter appeal, including gifts made in person',
						count: '12 Zaps listening'
					}
				]}
			/>
		</div>
	);
}
