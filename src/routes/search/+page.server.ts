import type { Actions, PageServerLoad } from './$types';
import { sharedActions } from '$lib/server/actions';
import { getContext } from '$lib/server/context';
import { listTasks } from '$lib/server/tasks';

export const load: PageServerLoad = async (event) => {
	const ctx = await getContext(event);
	const query = (event.url.searchParams.get('q') ?? '').trim().slice(0, 200);
	const includeCompleted = event.url.searchParams.get('completed') === '1';
	const tasks = query
		? await listTasks(ctx, { search: query, status: includeCompleted ? 'all' : 'open', limit: 200 })
		: [];
	return { query, includeCompleted, tasks };
};

export const actions = sharedActions satisfies Actions;
