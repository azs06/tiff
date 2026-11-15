/** Shared drag state so tasks can be dropped into a different section's list. */
export const drag = $state<{ taskId: string | null; projectId: string | null }>({ taskId: null, projectId: null });
