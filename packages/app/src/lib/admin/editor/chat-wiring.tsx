import { type ReactNode, useEffect, useState } from 'react';
import { useFetcher, useSearchParams } from 'react-router';
import { imageSrc } from '$lib/page/image-src';
import { type ChatMessage, type ChatSend, ChatSheet } from '../chat/chat-sheet';

// the Chat sheet as both editors mount it: `open` for the Chat entry, and the sheet while it is
// open. the chat is the page's chat route's (src/routes/_app.admin.pages.$pageId.chat.ts), asked
// by two fetchers — one loading the chat as the sheet opens, one posting each turn — both held by
// the editor rather than the sheet, so a turn sent and closed on still lands.
//
// a turn is the three boxes that route takes: the words, the photos as a JSON array, and the
// browser's zone, which an end date the operator names is a day in. while it runs the words stand
// in the log as sent and the sheet holds Send. once it lands, the revalidation that follows every
// fetcher post reads the chat again with both new turns, and reads the editor's own loader, whose
// version the preview is keyed on — so the preview redraws on an accepted turn, the one that moves
// the draft, and on no other.
//
// the sheet mounts once the chat has loaded rather than on an empty log: the log takes the chat it
// opens on as already read ($lib/admin/chat/chat-log.tsx), and would speak the whole history as it
// arrived.
//
// `?chat` opens it on arrival. the create action lands a campaign made with a "What's it for?"
// line there, its first turn already answered (`createCampaign` in $lib/server/pages/campaign.ts
// runs it before the redirect). closing drops the flag, so a reload opens the editor bare.

const SUGGESTIONS = ['Tell donors what each amount buys', 'Add a FAQ', 'Shorten the story'];

/** the search param that opens the chat on arrival. */
export const CHAT_PARAM = 'chat';

/** what the chat route's loader answers. */
type History = { readonly turns: readonly ChatMessage[] };

/** the chat with the message being answered after it, until the chat that stores it lands. */
function inFlight(
	turns: readonly ChatMessage[],
	sent: FormData | undefined
): readonly ChatMessage[] {
	if (sent === undefined) return turns;
	return [
		...turns,
		{
			id: 'sending',
			role: 'operator',
			text: String(sent.get('message')),
			imageIds: JSON.parse(String(sent.get('imageIds'))) as string[]
		}
	];
}

export function useEditorChat(url: string): { open: () => void; sheet: ReactNode } {
	const [params, setParams] = useSearchParams();
	const [open, setOpen] = useState(() => params.has(CHAT_PARAM));
	const history = useFetcher<History>();
	const turn = useFetcher();

	const { load } = history;
	useEffect(() => {
		if (open) load(url);
	}, [open, load, url]);

	const send = ({ text, imageIds }: ChatSend) =>
		turn.submit(
			{
				message: text,
				imageIds: JSON.stringify(imageIds),
				timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
			},
			{ method: 'post', action: url }
		);

	const dismiss = () => {
		setOpen(false);
		if (params.has(CHAT_PARAM)) {
			setParams(
				(next) => {
					next.delete(CHAT_PARAM);
					return next;
				},
				{ replace: true, preventScrollReset: true }
			);
		}
	};

	const running = turn.state !== 'idle';
	const sheet =
		open && history.data !== undefined ? (
			<ChatSheet
				messages={inFlight(history.data.turns, turn.formData)}
				isRunning={running}
				onSend={send}
				onDismiss={dismiss}
				suggestions={SUGGESTIONS}
				imageSrc={imageSrc}
			/>
		) : null;

	return {
		open: () => setOpen(true),
		sheet
	};
}
