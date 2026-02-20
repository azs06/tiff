<script lang="ts">
	import type { PomodoroLog, Todo } from './types';

	let { pomodoroLogs, todos }: { pomodoroLogs: PomodoroLog[]; todos: Todo[] } = $props();

	const DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
	const MONTHS = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE',
		'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];

	let viewYear = $state(new Date().getFullYear());
	let viewMonth = $state(new Date().getMonth());

	function prev() {
		if (viewMonth === 0) { viewYear--; viewMonth = 11; }
		else viewMonth--;
	}

	function next() {
		if (viewMonth === 11) { viewYear++; viewMonth = 0; }
		else viewMonth++;
	}

	// Build a map of date-string → pomodoro count (work sessions only)
	let pomoCounts = $derived.by(() => {
		const map = new Map<string, number>();
		for (const log of pomodoroLogs) {
			if (log.type !== 'work') continue;
			const d = new Date(log.completedAt);
			const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
			map.set(key, (map.get(key) ?? 0) + 1);
		}
		return map;
	});

	// Build a set of date-strings that have deadlines
	let deadlineDates = $derived.by(() => {
		const set = new Set<string>();
		for (const t of todos) {
			if (t.deadline) {
				const d = new Date(t.deadline);
				set.add(`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`);
			}
		}
		return set;
	});

	// Generate calendar cells for the viewed month
	let cells = $derived.by(() => {
		const firstDay = new Date(viewYear, viewMonth, 1).getDay();
		const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
		const daysInPrev = new Date(viewYear, viewMonth, 0).getDate();

		const result: Array<{ day: number; month: number; year: number; isCurrentMonth: boolean }> = [];

		// Previous month padding
		for (let i = firstDay - 1; i >= 0; i--) {
			const pm = viewMonth === 0 ? 11 : viewMonth - 1;
			const py = viewMonth === 0 ? viewYear - 1 : viewYear;
			result.push({ day: daysInPrev - i, month: pm, year: py, isCurrentMonth: false });
		}

		// Current month
		for (let d = 1; d <= daysInMonth; d++) {
			result.push({ day: d, month: viewMonth, year: viewYear, isCurrentMonth: true });
		}

		// Next month padding
		const remaining = 7 - (result.length % 7);
		if (remaining < 7) {
			const nm = viewMonth === 11 ? 0 : viewMonth + 1;
			const ny = viewMonth === 11 ? viewYear + 1 : viewYear;
			for (let d = 1; d <= remaining; d++) {
				result.push({ day: d, month: nm, year: ny, isCurrentMonth: false });
			}
		}

		return result;
	});

	function isToday(cell: { day: number; month: number; year: number }): boolean {
		const now = new Date();
		return cell.year === now.getFullYear() && cell.month === now.getMonth() && cell.day === now.getDate();
	}

	function getPomoCount(cell: { day: number; month: number; year: number }): number {
		return pomoCounts.get(`${cell.year}-${cell.month}-${cell.day}`) ?? 0;
	}

	function hasDeadline(cell: { day: number; month: number; year: number }): boolean {
		return deadlineDates.has(`${cell.year}-${cell.month}-${cell.day}`);
	}
</script>

<div class="cal-nav">
	<button onclick={prev}>&lt;</button>
	<span class="cal-month">{MONTHS[viewMonth]} {viewYear}</span>
	<button onclick={next}>&gt;</button>
</div>

<div class="cal-grid">
	{#each DAYS as day}
		<div class="cal-day-header">{day}</div>
	{/each}

	{#each cells as cell}
		{@const count = getPomoCount(cell)}
		<div
			class="cal-cell"
			class:other-month={!cell.isCurrentMonth}
			class:today={isToday(cell)}
			class:has-pomodoros={count > 0 && count < 4}
			class:has-pomodoros-high={count >= 4}
		>
			{cell.day}
			{#if count > 0}
				<span class="cal-pomo-count">{count}</span>
			{/if}
			{#if hasDeadline(cell)}
				<span class="cal-deadline-dot"></span>
			{/if}
		</div>
	{/each}
</div>
