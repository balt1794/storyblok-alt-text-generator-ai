import { HttpError } from './session';

/** Talks to the Alt Text Generator AI service from the server, so the API key never reaches the browser. */
const ENDPOINT =
	process.env.ALT_TEXT_GENERATOR_ENDPOINT || 'https://alttextgeneratorai.com/api/storyblok';
const VERIFY_ENDPOINT =
	process.env.ALT_TEXT_GENERATOR_VERIFY_ENDPOINT || 'https://alttextgeneratorai.com/api/verify';

const post = async (url: string, payload: unknown) => {
	try {
		const response = await fetch(url, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'User-Agent': 'storyblok-alt-text-generator-ai',
			},
			body: JSON.stringify(payload),
			signal: AbortSignal.timeout(60_000),
		});
		return { status: response.status, body: (await response.text()).trim(), headers: response.headers };
	} catch {
		throw new HttpError(
			'Could not reach Alt Text Generator AI. Check the connection and try again.',
			502,
		);
	}
};

export const generate = async (imageUrl: string, language: string, apiKey: string) => {
	const { status, body, headers } = await post(ENDPOINT, {
		image: imageUrl,
		language,
		wpkey: apiKey,
	});

	if (status === 401) throw new HttpError('Invalid API key.', 401);
	if (status === 402) throw new HttpError('No credits left on this API key.', 402);
	if (status >= 400) {
		const message =
			body && body.length < 160 && !body.startsWith('<')
				? body
				: `Generation failed (${status}).`;
		throw new HttpError(message, status);
	}
	if (!body) throw new HttpError('No alt text came back. Try again.', 502);

	const left = Number(headers.get('X-Credits-Left'));
	return { altText: body, creditsLeft: Number.isFinite(left) && headers.get('X-Credits-Left') ? left : null };
};

/** Credits left for a key. Throws a 401 for an unknown key. */
export const credits = async (apiKey: string): Promise<number> => {
	if (!apiKey) throw new HttpError('No API key yet.', 401);
	const { status, body } = await post(VERIFY_ENDPOINT, { apiKey });
	if (status === 400 || status === 404) throw new HttpError('Invalid API key.', 401);
	if (status >= 400) throw new HttpError(`Could not check the credits (${status}).`, status);
	try {
		return Number(JSON.parse(body).freeRewritesLeft) || 0;
	} catch {
		throw new HttpError('Could not read the credits.', 502);
	}
};
