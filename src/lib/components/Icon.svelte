<script lang="ts" module>
	const PATHS = {
		inbox: 'M3.5 5.5h17v11h-4.5l-2 3h-4l-2-3H3.5z M3.5 13.5h5l1.5 2h4l1.5-2h5',
		today: 'M4 5.5h16V20H4z M4 9.5h16 M8 3.5v3 M16 3.5v3 M10 14.5h4',
		upcoming: 'M4 5.5h16V20H4z M4 9.5h16 M8 3.5v3 M16 3.5v3 M8 13h2 M12 13h2 M16 13h.01 M8 16.5h2 M12 16.5h2',
		completed: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M8 12.5l2.5 2.5L16 9.5',
		search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z M20 20l-4-4',
		settings:
			'M4 6h3 M11 6h9 M9 4a2 2 0 1 0 0 4 2 2 0 0 0 0-4z M4 12h8 M16 12h4 M14 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4z M4 18h11 M19 18h1 M17 16a2 2 0 1 0 0 4 2 2 0 0 0 0-4z',
		plus: 'M12 5v14 M5 12h14',
		hash: 'M9.5 4 7.5 20 M16.5 4l-2 16 M4.5 9h16 M3.5 15h16',
		tag: 'M3.5 12.5V4.5h8l9 9-8 8z M7.5 8.5h.01',
		chevron: 'M9 6l6 6-6 6',
		close: 'M6 6l12 12 M18 6 6 18',
		repeat: 'M17 2.5l3 3-3 3 M4 11.5v-2a4 4 0 0 1 4-4h12 M7 21.5l-3-3 3-3 M20 12.5v2a4 4 0 0 1-4 4H4',
		comment: 'M4 5h16v11H9l-5 4z',
		subtask: 'M6 4v9a3 3 0 0 0 3 3h9 M14.5 12.5 18 16l-3.5 3.5',
		flag: 'M5.5 21V4 M5.5 4.5h11l-2 4 2 4h-11',
		users:
			'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M2.5 21v-1a6.5 6.5 0 0 1 13 0v1 M16 3.5a4 4 0 0 1 0 7.5 M21.5 21v-1a6.5 6.5 0 0 0-4-6',
		paperclip:
			'M20.5 11.5 12 20a5 5 0 0 1-7-7l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7L9.7 17.7a1.7 1.7 0 0 1-2.4-2.4l7.8-7.8',
		trash: 'M4 7h16 M10 11v6 M14 11v6 M6 7l1 13h10l1-13 M9 7V4h6v3',
		grip: 'M9 6h.01 M15 6h.01 M9 12h.01 M15 12h.01 M9 18h.01 M15 18h.01',
		menu: 'M4 6h16 M4 12h16 M4 18h16',
		archive: 'M4 4.5h16v4H4z M5 8.5h14V20H5z M10 12h4',
		user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M4.5 21a7.5 7.5 0 0 1 15 0',
		key: 'M8 15a5 5 0 1 1 3.9-1.9L20 21 M16 17l2-2 M13.5 14.5l1.5-1.5',
		folder: 'M3.5 7.5h6l2 2h9v9.5h-17z M3.5 7.5v-2h6l2 2',
		check: 'M5 12.5l4.5 4.5L19 7.5',
		undo: 'M9 14 4 9l5-5 M4 9h10.5a5.5 5.5 0 0 1 0 11H11'
	} as const;

	export type IconName = keyof typeof PATHS;
</script>

<script lang="ts">
	let { name, size = 18 }: { name: IconName; size?: number } = $props();
</script>

<svg
	class="icon"
	viewBox="0 0 24 24"
	width={size}
	height={size}
	fill="none"
	stroke="currentColor"
	stroke-width={name === 'grip' ? 3 : 1.8}
	stroke-linecap="round"
	stroke-linejoin="round"
	aria-hidden="true"
>
	<path d={PATHS[name]} />
</svg>
