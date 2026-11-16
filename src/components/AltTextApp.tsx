import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { APP_BRIDGE_TOKEN_HEADER_KEY, KEY_TOKEN } from '@/utils/const';
import { LANGUAGES } from '@/lib/languages';

type Item = {
	id: number;
	name: string;
	alt: string;
	meta: Record<string, unknown>;
	thumb: string;
	url: string;
	svg: boolean;
	isPrivate: boolean;
};

type Draft = { text: string; status: 'working' | 'generated' | 'edited' | 'saved' | 'error'; message?: string };

type Settings = {
	hasKey: boolean;
	keyHint: string;
	language: string;
	canEdit: boolean;
	creditsLeft?: number | null;
	creditsError?: string | null;
};

class ApiError extends Error {
	status: number;
	constructor(message: string, status: number) {
		super(message);
		this.status = status;
	}
}

const api = async <T,>(path: string, body?: unknown): Promise<T> => {
	const response = await fetch(path, {
		method: body === undefined ? 'GET' : 'POST',
		headers: {
			[APP_BRIDGE_TOKEN_HEADER_KEY]: sessionStorage.getItem(KEY_TOKEN) || '',
			...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
		},
		body: body === undefined ? undefined : JSON.stringify(body),
	});
	let data: { error?: string } = {};
	try {
		data = await response.json();
	} catch {
		data = {};
	}
	if (!response.ok) throw new ApiError(data.error || `Something went wrong (${response.status}).`, response.status);
	return data as T;
};

const PAGE_SIZE = 24;
const CONCURRENCY = 3;
const SAVE_CHUNK = 10;

function Grow({ value, onChange, disabled, label }: { value: string; onChange: (v: string) => void; disabled: boolean; label: string }) {
	const ref = useRef<HTMLTextAreaElement>(null);
	useLayoutEffect(() => {
		const el = ref.current;
		if (!el) return;
		el.style.height = 'auto';
		el.style.height = `${el.scrollHeight + 2}px`;
	}, [value]);
	return (
		<textarea
			ref={ref}
			rows={2}
			value={value}
			disabled={disabled}
			aria-label={label}
			placeholder="Alt text appears here"
			onChange={(e) => onChange(e.target.value)}
		/>
	);
}

export default function AltTextApp() {
	const [settings, setSettings] = useState<Settings | null>(null);
	const [credits, setCredits] = useState<number | null>(null);
	const [language, setLanguage] = useState('english');
	const [keyInput, setKeyInput] = useState('');
	const [savingKey, setSavingKey] = useState(false);

	const [items, setItems] = useState<Item[]>([]);
	const [nextPage, setNextPage] = useState(1);
	const [hasMore, setHasMore] = useState(true);
	const [loading, setLoading] = useState(false);
	const [filter, setFilter] = useState<'missing' | 'all'>('missing');
	const [q, setQ] = useState('');
	const [query, setQuery] = useState('');
	const [shown, setShown] = useState(PAGE_SIZE);

	const [drafts, setDrafts] = useState<Record<number, Draft>>({});
	const [selected, setSelected] = useState<Set<number>>(new Set());
	const [running, setRunning] = useState(false);
	const [progress, setProgress] = useState<{ done: number; total: number; label: string } | null>(null);
	const [banner, setBanner] = useState<{ text: string; kind: 'ok' | 'error' | 'info' } | null>(null);
	const stop = useRef(false);
	const draftsRef = useRef(drafts);
	draftsRef.current = drafts;
	const itemsRef = useRef(items);
	itemsRef.current = items;

	const hasKey = !!settings?.hasKey;

	const patchDraft = (id: number, draft: Draft) => setDrafts((d) => ({ ...d, [id]: draft }));

	// ---- settings ----
	useEffect(() => {
		api<Settings>('/api/settings')
			.then((s) => {
				setSettings(s);
				setLanguage(s.language);
				setCredits(s.creditsLeft ?? null);
				if (s.creditsError) setBanner({ text: s.creditsError, kind: 'error' });
			})
			.catch((e: ApiError) => setBanner({ text: e.message, kind: 'error' }));
	}, []);

	const saveKey = async (e: React.FormEvent) => {
		e.preventDefault();
		setSavingKey(true);
		try {
			const s = await api<Settings>('/api/settings', { apiKey: keyInput, language });
			setSettings(s);
			setKeyInput('');
			if (s.creditsLeft !== undefined && s.creditsLeft !== null) setCredits(s.creditsLeft);
			setBanner({ text: 'API key saved.', kind: 'ok' });
		} catch (err) {
			setBanner({ text: (err as ApiError).message, kind: 'error' });
		}
		setSavingKey(false);
	};

	const changeLanguage = (value: string) => {
		setLanguage(value);
		if (settings?.canEdit) api('/api/settings', { language: value }).catch(() => undefined);
	};

	// ---- assets ----
	const isMissing = (item: Item) => !item.alt.trim();

	const fetchPage = useCallback(
		async (page: number, search: string) => {
			const data = await api<{ items: Item[]; page: number; totalPages: number }>(
				`/api/assets?page=${page}&q=${encodeURIComponent(search)}`,
			);
			return data;
		},
		[],
	);

	const loadMore = useCallback(
		async (opts: { reset?: boolean; search?: string; want?: number } = {}) => {
			setLoading(true);
			try {
				let page = opts.reset ? 1 : nextPage;
				let more = opts.reset ? true : hasMore;
				let acc = opts.reset ? [] : itemsRef.current;
				const search = opts.search ?? query;
				const wantMissing = filter === 'missing';
				const enough = () =>
					(wantMissing ? acc.filter(isMissing).length : acc.length) >= (opts.want ?? PAGE_SIZE);
				let guard = 0;
				while (more && (opts.reset || guard === 0 || !enough()) && guard < 15) {
					const data = await fetchPage(page, search);
					const seen = new Set(acc.map((i) => i.id));
					acc = [...acc, ...data.items.filter((i) => !seen.has(i.id))];
					more = data.page < data.totalPages;
					page += 1;
					guard += 1;
					if (enough()) break;
				}
				setItems(acc);
				setNextPage(page);
				setHasMore(more);
			} catch (e) {
				setBanner({ text: (e as ApiError).message, kind: 'error' });
			}
			setLoading(false);
		},
		[nextPage, hasMore, query, filter, fetchPage],
	);

	// First load, and again when the search or tab changes.
	useEffect(() => {
		setShown(PAGE_SIZE);
		loadMore({ reset: true, search: query });
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [query, filter]);

	const visible = useMemo(
		() => items.filter((i) => (filter === 'all' ? true : isMissing(i) || !!drafts[i.id])),
		[items, filter, drafts],
	);
	const rows = visible.slice(0, shown);
	const selectable = rows.filter((i) => !i.svg && !i.isPrivate);
	const chosen = selectable.filter((i) => selected.has(i.id)).length;
	const allChosen = selectable.length > 0 && chosen === selectable.length;
	const missingKnown = items.filter(isMissing).length;

	const toggleAll = (on: boolean) =>
		setSelected((prev) => {
			const next = new Set(prev);
			selectable.forEach((i) => (on ? next.add(i.id) : next.delete(i.id)));
			return next;
		});

	// ---- generate ----
	const runBatch = async (ids: number[]) => {
		if (!ids.length || running) return;
		if (!hasKey) {
			setBanner({ text: 'Add your API key first.', kind: 'info' });
			return;
		}
		setRunning(true);
		stop.current = false;
		setBanner(null);
		let done = 0;
		let okCount = 0;
		let halted: string | null = null;
		setProgress({ done: 0, total: ids.length, label: 'Writing alt text' });

		let index = 0;
		const worker = async () => {
			while (!stop.current && !halted) {
				const id = ids[index++];
				if (id === undefined) return;
				patchDraft(id, { text: draftsRef.current[id]?.text || '', status: 'working' });
				try {
					const data = await api<{ altText: string; creditsLeft: number | null }>('/api/generate', { id, language });
					patchDraft(id, { text: data.altText, status: 'generated' });
					okCount += 1;
					if (data.creditsLeft !== null) setCredits(data.creditsLeft);
				} catch (e) {
					const err = e as ApiError;
					patchDraft(id, { text: draftsRef.current[id]?.text || '', status: 'error', message: err.message });
					if (err.status === 401 || err.status === 402) halted = err.message;
				}
				done += 1;
				setProgress({ done, total: ids.length, label: 'Writing alt text' });
			}
		};
		await Promise.all(Array.from({ length: Math.min(CONCURRENCY, ids.length) }, worker));

		setRunning(false);
		setProgress(null);
		if (halted) setBanner({ text: halted, kind: 'error' });
		else if (stop.current) setBanner({ text: `Stopped. ${okCount} ready to review.`, kind: 'info' });
		else if (okCount) setBanner({ text: `Done. ${okCount} ${okCount === 1 ? 'description is' : 'descriptions are'} ready. Review them, then click Save changes.`, kind: 'ok' });
		// Anything left in "working" (stopped early) goes back to normal.
		setDrafts((d) => {
			const next = { ...d };
			Object.entries(next).forEach(([id, draft]) => {
				if (draft.status === 'working') delete next[Number(id)];
			});
			return next;
		});
	};

	const generateAllMissing = async () => {
		if (running) return;
		setRunning(true);
		stop.current = false;
		setProgress({ done: 0, total: 0, label: 'Looking for images with no alt text' });
		// Make sure every page of the space has been read.
		let acc = itemsRef.current;
		let page = nextPage;
		let more = hasMore;
		try {
			while (more && !stop.current) {
				const data = await fetchPage(page, query);
				const seen = new Set(acc.map((i) => i.id));
				acc = [...acc, ...data.items.filter((i) => !seen.has(i.id))];
				more = data.page < data.totalPages;
				page += 1;
				setProgress({ done: 0, total: 0, label: `Looking for images with no alt text (${acc.length} checked)` });
			}
		} catch (e) {
			setBanner({ text: (e as ApiError).message, kind: 'error' });
			setRunning(false);
			setProgress(null);
			return;
		}
		setItems(acc);
		setNextPage(page);
		setHasMore(more);
		setRunning(false);
		setProgress(null);

		const ids = acc.filter((i) => isMissing(i) && !i.svg && !i.isPrivate && !drafts[i.id]).map((i) => i.id);
		if (!ids.length) {
			setBanner({ text: 'Every image already has alt text.', kind: 'ok' });
			return;
		}
		await runBatch(ids);
	};

	// ---- save ----
	const savable = Object.entries(drafts)
		.filter(([, d]) => (d.status === 'generated' || d.status === 'edited') && d.text.trim())
		.map(([id]) => Number(id));

	const saveAll = async () => {
		if (!savable.length || running) return;
		setRunning(true);
		setBanner(null);
		let savedCount = 0;
		let failedCount = 0;
		setProgress({ done: 0, total: savable.length, label: 'Saving' });
		for (let i = 0; i < savable.length; i += SAVE_CHUNK) {
			const chunk = savable.slice(i, i + SAVE_CHUNK);
			// Read the texts now: state is cleared as soon as the save comes back.
			const texts: Record<number, string> = {};
			chunk.forEach((id) => (texts[id] = draftsRef.current[id].text.trim()));
			try {
				const data = await api<{ saved: number[]; failed: { id: number; error: string }[] }>('/api/save', {
					items: chunk.map((id) => ({
						id,
						alt: texts[id],
						meta: itemsRef.current.find((it) => it.id === id)?.meta || {},
					})),
				});
				savedCount += data.saved.length;
				failedCount += data.failed.length;
				setItems((list) =>
					list.map((it) => (data.saved.includes(it.id) ? { ...it, alt: texts[it.id] } : it)),
				);
				setDrafts((d) => {
					const next = { ...d };
					data.saved.forEach((id) => delete next[id]);
					data.failed.forEach(({ id, error }) => (next[id] = { ...next[id], status: 'error', message: error }));
					return next;
				});
				setSelected((s) => {
					const next = new Set(s);
					data.saved.forEach((id) => next.delete(id));
					return next;
				});
			} catch (e) {
				failedCount += chunk.length;
				setBanner({ text: (e as ApiError).message, kind: 'error' });
				break;
			}
			setProgress({ done: Math.min(i + SAVE_CHUNK, savable.length), total: savable.length, label: 'Saving' });
		}
		setRunning(false);
		setProgress(null);
		if (savedCount) {
			setBanner({
				text: `Saved ${savedCount} ${savedCount === 1 ? 'description' : 'descriptions'}.${failedCount ? ` ${failedCount} could not be saved.` : ''}`,
				kind: failedCount ? 'info' : 'ok',
			});
		}
	};

	const statusOf = (item: Item) => {
		const d = drafts[item.id];
		if (item.svg) return { text: 'SVG files are not supported.', kind: 'muted' };
		if (item.isPrivate) return { text: 'Private assets cannot be described.', kind: 'muted' };
		if (!d) return { text: item.alt ? 'Has alt text.' : 'No alt text yet.', kind: 'muted' };
		switch (d.status) {
			case 'working': return { text: 'Writing…', kind: 'working' };
			case 'generated': return { text: 'Generated. Review it, then save.', kind: 'ok' };
			case 'edited': return { text: 'Edited. Save to keep it.', kind: 'ok' };
			case 'error': return { text: d.message || 'Could not generate.', kind: 'error' };
			default: return { text: '', kind: 'muted' };
		}
	};

	return (
		<div className="atg">
			<h1 className="atg__title">Alt Text Generator AI</h1>
			<p className="atg__intro">
				Write alt text for the images in your space. Generate it for one image or in bulk.{' '}
				<a href="https://alttextgeneratorai.com/pricing" target="_blank" rel="noopener noreferrer">Get credits</a>
			</p>

			{banner && <div className={`atg__banner atg__banner--${banner.kind}`} role="status">{banner.text}</div>}

			<section className="atg__panel">
				<h2>Account</h2>
				<div className="atg__account">
					<div className="atg__field">
						<span className="atg__label">Credits</span>
						<strong className="atg__credits">{credits === null ? '–' : credits}</strong>
					</div>
					<label className="atg__field">
						<span className="atg__label">Language of the alt text</span>
						<select value={language} onChange={(e) => changeLanguage(e.target.value)} disabled={running}>
							{LANGUAGES.map(([id, name]) => (
								<option key={id} value={id}>{name}</option>
							))}
						</select>
					</label>
					{settings?.canEdit ? (
						<form className="atg__field atg__key" onSubmit={saveKey}>
							<label className="atg__label" htmlFor="atg-key">API key</label>
							<div className="atg__key-row">
								<input
									id="atg-key"
									type="password"
									autoComplete="off"
									value={keyInput}
									placeholder="Paste your API key"
									onChange={(e) => setKeyInput(e.target.value)}
								/>
								<button type="submit" className="atg__btn" disabled={savingKey || !keyInput.trim()}>Save key</button>
							</div>
							{!hasKey && (
								<span className="atg__hint">
									<a href="https://alttextgeneratorai.com/dashboard" target="_blank" rel="noopener noreferrer">Get a free API key</a>
								</span>
							)}
						</form>
					) : (
						<p className="atg__hint">
							{hasKey ? 'The API key is managed by a space admin.' : 'Ask a space admin to add the API key.'}
						</p>
					)}
				</div>
			</section>

			<section className="atg__panel">
				<h2>Images</h2>
				<div className="atg__toolbar">
					<div className="atg__tabs" role="group" aria-label="Show">
						<button type="button" className={filter === 'missing' ? 'is-active' : ''} onClick={() => setFilter('missing')}>
							Missing {hasMore ? '' : missingKnown}
						</button>
						<button type="button" className={filter === 'all' ? 'is-active' : ''} onClick={() => setFilter('all')}>All</button>
					</div>
					<form className="atg__search" onSubmit={(e) => { e.preventDefault(); setQuery(q.trim()); }}>
						<input
							type="search"
							value={q}
							placeholder="Search by file name"
							aria-label="Search images"
							onChange={(e) => { setQ(e.target.value); if (!e.target.value) setQuery(''); }}
						/>
					</form>
					<div className="atg__actions">
						<button type="button" className="atg__btn atg__btn--secondary" disabled={!chosen || running} onClick={() => runBatch(selectable.filter((i) => selected.has(i.id)).map((i) => i.id))}>
							Generate selected
						</button>
						<button type="button" className="atg__btn atg__btn--secondary atg__btn--accent" disabled={running || !hasKey} onClick={generateAllMissing}>
							Generate all missing
						</button>
						<button type="button" className="atg__btn" disabled={!savable.length || running} onClick={saveAll}>
							{savable.length ? `Save changes (${savable.length})` : 'Save changes'}
						</button>
					</div>
				</div>

				{progress && (
					<div className="atg__progress">
						<div className="atg__bar"><span style={{ width: progress.total ? `${(progress.done / progress.total) * 100}%` : '30%' }} /></div>
						<span>{progress.label}{progress.total ? ` ${progress.done} of ${progress.total}` : ''}</span>
						<button type="button" className="atg__btn atg__btn--small atg__btn--secondary" onClick={() => { stop.current = true; }}>Stop</button>
					</div>
				)}

				{selectable.length > 0 && (
					<label className="atg__selectall">
						<input type="checkbox" checked={allChosen} ref={(el) => { if (el) el.indeterminate = chosen > 0 && !allChosen; }} onChange={(e) => toggleAll(e.target.checked)} disabled={running} />
						<span>Select all</span>
					</label>
				)}

				<div className="atg__list" role="list" aria-busy={loading}>
					{!rows.length && !loading && (
						<p className="atg__empty">
							{query ? 'No images match that search.' : filter === 'missing' ? 'Every image has alt text. Nice work.' : 'There are no images yet.'}
						</p>
					)}
					{!rows.length && loading && <p className="atg__empty">Loading images…</p>}
					{rows.map((item) => {
						const draft = drafts[item.id];
						const status = statusOf(item);
						const value = draft ? draft.text : item.alt;
						const blocked = item.svg || item.isPrivate;
						return (
							<div className="atg__row" role="listitem" key={item.id}>
								<input
									type="checkbox"
									aria-label={`Select ${item.name}`}
									disabled={blocked || running}
									checked={selected.has(item.id)}
									onChange={(e) =>
										setSelected((s) => {
											const next = new Set(s);
											if (e.target.checked) next.add(item.id); else next.delete(item.id);
											return next;
										})
									}
								/>
								<a className="atg__thumb" href={item.url} target="_blank" rel="noopener noreferrer" title="Open this image">
									{/* eslint-disable-next-line @next/next/no-img-element */}
									<img src={item.thumb} alt="" loading="lazy" />
								</a>
								<div className="atg__meta"><strong>{item.name}</strong></div>
								<div className="atg__text">
									<Grow
										value={value}
										label={`Alt text for ${item.name}`}
										disabled={blocked || draft?.status === 'working'}
										onChange={(text) => patchDraft(item.id, { text, status: 'edited' })}
									/>
									<span className={`atg__status atg__status--${status.kind}`}>{status.text}</span>
								</div>
								<button type="button" className="atg__btn atg__btn--small atg__btn--secondary" disabled={blocked || running || !hasKey} onClick={() => runBatch([item.id])}>
									{item.alt || value ? 'Generate again' : 'Generate'}
								</button>
							</div>
						);
					})}
				</div>

				{(visible.length > shown || hasMore) && (
					<div className="atg__more">
						<button
							type="button"
							className="atg__btn atg__btn--secondary"
							disabled={loading || running}
							onClick={() => {
								if (visible.length > shown) setShown((n) => n + PAGE_SIZE);
								else loadMore({ want: visible.length + PAGE_SIZE }).then(() => setShown((n) => n + PAGE_SIZE));
							}}
						>
							{loading ? 'Loading…' : 'Load more'}
						</button>
					</div>
				)}
			</section>
		</div>
	);
}
