import { route, HttpError } from '@/lib/session';

type Item = { id: number; alt: string; meta?: Record<string, unknown> };

/** Saves up to 10 alt texts per request, so a request stays well inside a serverless time limit. */
export default route(['POST'], async (auth, req) => {
	const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
	const items: Item[] = Array.isArray(body.items) ? body.items : [];
	if (!items.length) throw new HttpError('Nothing to save.', 400);
	if (items.length > 10) throw new HttpError('Save at most 10 images at a time.', 400);

	const saved: number[] = [];
	const failed: { id: number; error: string }[] = [];

	for (const item of items) {
		const id = Number(item?.id);
		const alt = typeof item?.alt === 'string' ? item.alt.trim() : '';
		if (!Number.isInteger(id) || !alt) continue;
		try {
			// Storyblok's asset window reads meta_data.alt; the top-level alt is kept in step with it.
			await auth.client.put(`spaces/${auth.spaceId}/assets/${id}`, {
				alt,
				meta_data: { ...(item.meta && typeof item.meta === 'object' ? item.meta : {}), alt },
			} as never);
			saved.push(id);
		} catch (e) {
			console.error('Could not save the alt text for asset', id, e);
			failed.push({ id, error: 'Storyblok did not accept it.' });
		}
	}

	return { saved, failed };
});
