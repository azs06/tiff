import type { Actions, PageServerLoad } from './$types';
import { sharedActions } from '$lib/server/actions';
import { getContext } from '$lib/server/context';
import { listTasks } from '$lib/server/tasks';

export const load: PageServerLoad = async (event) => {
	const ctx = await getContext(event);
	const label = event.params.name;
	return { label, tasks: await listTasks(ctx, { label }) };
};

export const actions = sharedActions satisfies Actions;
