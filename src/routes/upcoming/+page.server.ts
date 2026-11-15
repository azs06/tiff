import type { Actions, PageServerLoad } from './$types';
import { addDays } from '$lib/dates';
import { sharedActions } from '$lib/server/actions';
import { getContext } from '$lib/server/context';
import { listTasks } from '$lib/server/tasks';

const UPCOMING_DAYS = 14;

export const load: PageServerLoad = async (event) => {
	const ctx = await getContext(event);
	const until = addDays(ctx.today, UPCOMING_DAYS - 1);
	return { days: UPCOMING_DAYS, tasks: await listTasks(ctx, { dueOnOrBefore: until, order: 'due' }) };
};

export const actions = sharedActions satisfies Actions;
