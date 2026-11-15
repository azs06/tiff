import type { Actions, PageServerLoad } from './$types';
import { sharedActions } from '$lib/server/actions';
import { getContext } from '$lib/server/context';
import { listTasks } from '$lib/server/tasks';

export const load: PageServerLoad = async (event) => {
	const ctx = await getContext(event);
	return { tasks: await listTasks(ctx, { status: 'completed', order: 'completed', limit: 300 }) };
};

export const actions = sharedActions satisfies Actions;
