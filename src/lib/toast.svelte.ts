export interface Toast {
	id: number;
	message: string;
	kind: 'info' | 'error';
	action?: { label: string; run: () => void };
}

export const toasts = $state<Toast[]>([]);

let nextId = 1;

export function dismissToast(id: number) {
	const index = toasts.findIndex((toast) => toast.id === id);
	if (index !== -1) toasts.splice(index, 1);
}

export function toast(message: string, options: { kind?: Toast['kind']; action?: Toast['action']; ms?: number } = {}) {
	const id = nextId++;
	toasts.push({ id, message, kind: options.kind ?? 'info', action: options.action });
	while (toasts.length > 3) toasts.shift();
	setTimeout(() => dismissToast(id), options.ms ?? (options.action ? 6000 : 4000));
	return id;
}
