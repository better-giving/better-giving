import type { FieldLead } from '@better-giving/operator/components/forms/Field';
import { BrandMark } from '@better-giving/operator/components/status/BrandMark';
import { Mark } from '@better-giving/operator/components/status/Mark';
import {
	readSocialLink,
	SOCIAL_PLATFORM_NAMES
} from '@better-giving/operator/console/social-links';
import { type FormEvent, useState } from 'react';

/**
 * the mark at the start of a social link's box: the network's own mark, with its name for the box
 * to be described by, for an address the deployment reads as one of the six (`readSocialLink`);
 * or the globe, which says no network is read from it and has no words of its own.
 */
export function socialLinkLead(typed: string): FieldLead {
	const read = readSocialLink(typed);
	if (!read.ok) return { mark: <Mark name="globe" /> };
	const { platform } = read.link;
	return {
		mark: <BrandMark platform={platform} className="adm-brand-mark" />,
		said: SOCIAL_PLATFORM_NAMES[platform]
	};
}

/**
 * each link row's lead, from what stands in its box now: typed, or the value it was drawn with.
 * a row is told apart by its own identity (conform's `key`), never by its place, so a removed row
 * hands its typing to nothing below it.
 */
export function useSocialLinkLeads() {
	const [typed, setTyped] = useState<Readonly<Record<string, string>>>({});
	return (row: string, drawnWith: string | undefined) => ({
		lead: socialLinkLead(typed[row] ?? drawnWith ?? ''),
		onInput: (event: FormEvent<HTMLInputElement | HTMLTextAreaElement>) => {
			const value = event.currentTarget.value;
			setTyped((was) => ({ ...was, [row]: value }));
		}
	});
}
