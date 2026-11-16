import { route, HttpError } from '@/lib/session';
import { apiKeyOf, readSettings } from '@/lib/settings';
import { generate } from '@/lib/altai';
import { LANGUAGES } from '@/lib/languages';

export default route(['POST'], async (auth, req) => {
	const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
	const id = Number(body.id);
	if (!Number.isInteger(id)) throw new HttpError('Asset not found.', 404);

	const settings = await readSettings(auth);
	const apiKey = apiKeyOf(settings);
	if (!apiKey) throw new HttpError('No API key yet. Add it at the top of this page.', 401);

	const language =
		LANGUAGES.some(([key]) => key === body.language) ? body.language : settings.language || 'english';

	// The image address comes from Storyblok, never from the browser.
	let filename: string;
	let isPrivate = false;
	try {
		const { data } = await auth.client.get(`spaces/${auth.spaceId}/assets/${id}`);
		filename = data?.filename;
		isPrivate = !!data?.is_private;
	} catch {
		throw new HttpError('Asset not found.', 404);
	}
	if (!filename || !/^https:\/\//i.test(filename)) throw new HttpError('Asset not found.', 404);
	if (isPrivate) throw new HttpError('Private assets cannot be described.', 422);
	if (/\.svg(\?.*)?$/i.test(filename)) throw new HttpError('SVG files are not supported.', 415);

	// Storyblok's image service shrinks it, so only a small picture is sent.
	const { altText, creditsLeft } = await generate(`${filename}/m/1024x0`, language, apiKey);
	return { id, altText, creditsLeft };
});
