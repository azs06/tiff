import { deserialize } from '$app/forms';
import { goto, invalidateAll } from '$app/navigation';
import type { ActionResult, SubmitFunction } from '@sveltejs/kit';
import type { Task } from './types';
import { toast } from './toast.svelte';

/** The current URL with the task detail param set (or removed). Other query params are kept. */
export function taskHref(url: URL, taskId: string | null): string {
	const params = new URLSearchParams(url.searchParams);
	if (taskId) params.set('task', taskId);
	else params.delete('task');
	const query = params.toString();
	return `${url.pathname}${query ? `?${query}` : ''}`;
}

export function openTask(url: URL, taskId: string | null) {
	return goto(taskHref(url, taskId), { noScroll: true, keepFocus: true });
}

export function projectHref(projectId: string, inboxProjectId: string): string {
	return projectId === inboxProjectId ? '/inbox' : `/projects/${projectId}`;
}

function failureMessage(result: ActionResult): string | null {
	if (result.type === 'failure') return String(result.data?.error ?? 'Something went wrong');
	if (result.type === 'error') return result.error?.message ?? 'Something went wrong';
	return null;
}

/** Posts to a form action on the current page without a <form>, then refreshes data. */
export async function postAction(name: string, data: Record<string, string | string[]>): Promise<ActionResult> {
	const body = new FormData();
	for (const [key, value] of Object.entries(data)) {
		for (const item of Array.isArray(value) ? value : [value]) body.append(key, item);
	}
	const response = await fetch(`?/${name}`, {
		method: 'POST',
		body,
		headers: { 'x-sveltekit-action': 'true' }
	});
	const result = deserialize(await response.text());
	const message = failureMessage(result);
	if (message) toast(message, { kind: 'error' });
	await invalidateAll();
	return result;
}

/**
 * Standard `use:enhance` handler: shows failures as toasts and does not reset the form
 * unless asked, so edit forms keep their values.
 */
export function enhanced(
	options: {
		reset?: boolean;
		onSuccess?: (data: Record<string, unknown> | undefined) => void;
		onSubmit?: () => void;
		onSettled?: () => void;
	} = {}
): SubmitFunction {
	return () => {
		options.onSubmit?.();
		return async ({ result, update }) => {
			const message = failureMessage(result);
			if (message) toast(message, { kind: 'error' });
			await update({ reset: options.reset ?? false });
			if (result.type === 'success') options.onSuccess?.(result.data);
			options.onSettled?.();
		};
	};
}

/** Completes or reopens a task, offering Undo. */
export async function toggleTask(task: Task) {
	if (task.completedAt) {
		await postAction('reopenTask', { taskId: task.id });
		return;
	}
	const result = await postAction('completeTask', { taskId: task.id });
	if (result.type !== 'success') return;
	if (result.data?.recurred) {
		toast(`"${task.title}" moved to its next date`);
	} else {
		toast(`Completed "${task.title}"`, {
			action: { label: 'Undo', run: () => void postAction('reopenTask', { taskId: task.id }) }
		});
	}
}

export function initials(email: string): string {
	const name = email.split('@')[0];
	const parts = name.split(/[._-]+/).filter(Boolean);
	return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || name.slice(0, 2).toUpperCase();
}

export function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function relativeTime(timestamp: number, now = Date.now()): string {
	const minutes = Math.round((now - timestamp) / 60000);
	if (minutes < 1) return 'just now';
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.round(minutes / 60);
	if (hours < 24) return `${hours}h ago`;
	const days = Math.round(hours / 24);
	if (days < 30) return `${days}d ago`;
	return new Date(timestamp).toLocaleDateString();
}
