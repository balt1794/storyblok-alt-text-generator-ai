import { route, HttpError } from '@/lib/session';

type Asset = {
	id: number;
	filename: string;
	short_filename?: string;
	content_type?: string;
	alt?: string | null;
	meta_data?: Record<string, unknown> | null;
	is_private?: boolean;
};

const IMAGE_EXT = /\.(jpe?g|png|gif|webp|avif|svg)(\?.*)?$/i;

const isImage = (a: Asset) =>
	(a.content_type ? a.content_type.startsWith('image/') : IMAGE_EXT.test(a.filename || ''));

const isSvg = (a: Asset) =>
	a.content_type === 'image/svg+xml' || /\.svg(\?.*)?$/i.test(a.filename || '');

/** One page of the space's assets (images only). The page filters "missing" itself and asks for more pages. */
export default route(['GET'], async (auth, req) => {
	const page = Math.max(1, Number(req.query.page) || 1);
	const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';

	let response;
	try {
		response = await auth.client.get(`spaces/${auth.spaceId}/assets`, {
			page,
			per_page: 100,
			sort_by: 'created_at:desc',
			...(q ? { search: q } : {}),
		});
	} catch (e) {
		console.error('Could not list the assets:', e);
		throw new HttpError('Could not load the assets from Storyblok.', 502);
	}

	const assets: Asset[] = response.data?.assets ?? [];
	const total = Number(response.total) || 0;
	const perPage = Number(response.perPage) || 100;

	const items = assets.filter(isImage).map((a) => {
		const alt = (a.alt ?? (a.meta_data?.alt as string | undefined) ?? '') || '';
		const svg = isSvg(a);
		return {
			id: a.id,
			name: a.short_filename || a.filename.split('/').pop() || String(a.id),
			alt,
			meta: a.meta_data ?? {},
			thumb: svg ? a.filename : `${a.filename}/m/160x0`,
			url: a.filename,
			svg,
			isPrivate: !!a.is_private,
		};
	});

	return {
		items,
		page,
		totalPages: total ? Math.max(1, Math.ceil(total / perPage)) : assets.length < perPage ? page : page + 1,
	};
});
