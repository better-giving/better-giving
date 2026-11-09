import { describe, expect, it } from 'vitest';
import { donateProfile } from './profile';

// what the Donation page's profile head is handed, mapped from what its loader read
// ($lib/server/pages/view.ts).

const ORG = {
	name: 'Riverbank Trust',
	mission: 'Clean water for every family.',
	vision: 'A river anyone can drink from.',
	info: {
		legalName: 'Riverbank Trust',
		ein: '12-3456789',
		addressLines: ['1 Main St', 'Springfield, IL 62701', 'US'],
		email: null,
		socialLinks: [{ platform: 'instagram', href: 'https://instagram.com/riverbank' }]
	}
} as const;

const MONEY = { locale: 'en-US', currency: 'USD' };

describe('donateProfile()', () => {
	it('hands every part its field, the photos at the addresses they are served from', () => {
		expect(
			donateProfile({
				org: ORG,
				logo: { imageId: 'logo-1', width: 400, height: 400 },
				bannerImageId: 'banner 1',
				raised: { raisedMinor: 120_455_000, gifts: 48 },
				money: MONEY
			})
		).toEqual({
			name: 'Riverbank Trust',
			taxId: '12-3456789',
			banner: { src: '/image/banner%201' },
			logo: { src: '/image/logo-1', width: 400, height: 400 },
			mission: 'Clean water for every family.',
			vision: 'A river anyone can drink from.',
			raised: { raisedMinor: 120_455_000, gifts: 48 },
			money: MONEY,
			footer: {
				addressLines: ['1 Main St', 'Springfield, IL 62701', 'US'],
				email: null,
				socialLinks: [{ platform: 'instagram', href: 'https://instagram.com/riverbank' }]
			}
		});
	});

	it('hands no banner, no logo and no EIN where the organisation has none', () => {
		const profile = donateProfile({
			org: { ...ORG, mission: null, vision: null, info: { ...ORG.info, ein: null } },
			logo: null,
			bannerImageId: null,
			raised: { raisedMinor: 0, gifts: 0 },
			money: MONEY
		});

		expect(profile).toMatchObject({
			banner: null,
			logo: null,
			taxId: null,
			mission: null,
			vision: null,
			raised: { raisedMinor: 0, gifts: 0 }
		});
	});
});
