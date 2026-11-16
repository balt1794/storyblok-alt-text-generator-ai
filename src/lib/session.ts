import type { NextApiRequest, NextApiResponse } from 'next';
import type { AppSession } from '@storyblok/app-extension-auth';
import StoryblokClient from 'storyblok-js-client';
import { getAppSession, verifyAppBridgeHeader } from '@/utils/server';
import { isAdmin } from '@/utils';

export type Authed = {
	session: AppSession;
	appId: number;
	spaceId: number;
	admin: boolean;
	client: StoryblokClient;
};

export class HttpError extends Error {
	status: number;
	constructor(message: string, status = 500) {
		super(message);
		this.status = status;
	}
}

/**
 * Every API route starts here. It needs both the App Bridge token (proves the request comes
 * from the Storyblok app) and the OAuth session (gives the Management API token), and they
 * must belong to the same space.
 */
export const authenticate = async (
	req: NextApiRequest,
	res: NextApiResponse,
): Promise<Authed> => {
	const bridge = await verifyAppBridgeHeader(req);
	if (!bridge.ok) {
		throw new HttpError('Open this page from inside Storyblok.', 401);
	}

	const session = await getAppSession(req, res);
	if (!session || Number(session.spaceId) !== Number(bridge.result.space_id)) {
		throw new HttpError('Your Storyblok session has expired. Reload the page.', 401);
	}

	const client = new StoryblokClient({
		oauthToken: `Bearer ${session.accessToken}`,
		region: session.region,
		rateLimit: 3,
	});

	return {
		session,
		appId: bridge.result.app_id,
		spaceId: Number(session.spaceId),
		admin: isAdmin(session),
		client,
	};
};

/** Wraps a route so thrown HttpErrors become JSON errors the page can show. */
export const route =
	(
		methods: string[],
		handler: (auth: Authed, req: NextApiRequest) => Promise<unknown>,
	) =>
	async (req: NextApiRequest, res: NextApiResponse) => {
		if (!methods.includes(req.method || '')) {
			res.setHeader('Allow', methods.join(', '));
			return res.status(405).json({ error: 'Method not allowed.' });
		}
		try {
			const auth = await authenticate(req, res);
			const data = await handler(auth, req);
			return res.status(200).json(data);
		} catch (e) {
			if (e instanceof HttpError) {
				return res.status(e.status).json({ error: e.message });
			}
			console.error('Unexpected error:', e);
			return res.status(500).json({ error: 'Something went wrong. Try again.' });
		}
	};
