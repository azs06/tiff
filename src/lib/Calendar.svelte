<script lang="ts">
	import type { FocusSession, Todo } from './types';

	let {
		sessions,
		todos,
		loadedAt
	}: { sessions: FocusSession[]; todos: Todo[]; loadedAt: number } = $props();

	const MONTHS_SHORT = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
	const WEEKDAY_TICKS = ['', 'MON', '', 'WED', '', 'FRI', ''];
	const DAY_MS = 24 * 60 * 60 * 1000;
	const dayFormatter = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

	let viewYear = $state(new Date().getFullYear());

	type DayCell = {
		isInYear: boolean;
		focusMs: number;
		level: 0 | 1 | 2 | 3 | 4;
		hasDeadline: boolean;
		isToday: boolean;
		dateLabel: string;
	};

	function prev() {
		viewYear--;
	}

	function next() {
		viewYear++;
	}

	function dayStamp(year: number, month: number, day: number): number {
		return Date.UTC(year, month, day);
	}

	function toDateKey(year: number, month: number, day: number): string {
		return `${year}-${month}-${day}`;
	}

	function isToday(year: number, month: number, day: number): boolean {
		const now = new Date();
		return year === now.getFullYear() && month === now.getMonth() && day === now.getDate();
	}

	function formatDuration(ms: number): string {
		const totalMin = Math.round(ms / 60_000);
		if (totalMin < 60) return `${totalMin}m`;
		const h = Math.floor(totalMin / 60);
		const m = totalMin % 60;
		return m > 0 ? `${h}h ${m}m` : `${h}h`;
	}

	function getLevel(focusMs: number, max: number): 0 | 1 | 2 | 3 | 4 {
		if (focusMs <= 0) return 0;
		if (max <= 60 * 60 * 1000) {
			return Math.min(4, Math.ceil(focusMs / (15 * 60 * 1000))) as 1 | 2 | 3 | 4;
		}

		const q1 = Math.ceil(max * 0.25);
		const q2 = Math.ceil(max * 0.5);
		const q3 = Math.ceil(max * 0.75);

		if (focusMs <= q1) return 1;
		if (focusMs <= q2) return 2;
		if (focusMs <= q3) return 3;
		return 4;
	}

	function addSessionDurationByDay(map: Map<string, number>, startedAt: number, endedAt: number) {
		let cursor = startedAt;
		while (cursor < endedAt) {
			const current = new Date(cursor);
			const dayEnd = new Date(current);
			dayEnd.setHours(24, 0, 0, 0);
			const sliceEnd = Math.min(endedAt, dayEnd.getTime());
			const key = toDateKey(current.getFullYear(), current.getMonth(), current.getDate());
			map.set(key, (map.get(key) ?? 0) + Math.max(0, sliceEnd - cursor));
			cursor = sliceEnd;
		}
	}

	let focusByDay = $derived.by(() => {
		const map = new Map<string, number>();
		for (const session of sessions) {
			const endedAt = session.endedAt ?? loadedAt;
			if (endedAt <= session.startedAt) continue;
			addSessionDurationByDay(map, session.startedAt, endedAt);
		}
		return map;
	});

	let deadlineDates = $derived.by(() => {
		const set = new Set<string>();
		for (const t of todos) {
			if (t.deadline) {
				const d = new Date(t.deadline);
				set.add(toDateKey(d.getFullYear(), d.getMonth(), d.getDate()));
			}
		}
		return set;
	});

	let yearMaxFocus = $derived.by(() => {
		let max = 0;
		for (const [key, focusMs] of focusByDay) {
			if (key.startsWith(`${viewYear}-`) && focusMs > max) max = focusMs;
		}
		return max;
	});

	let yearTotalFocus = $derived.by(() => {
		let total = 0;
		for (const [key, focusMs] of focusByDay) {
			if (key.startsWith(`${viewYear}-`)) total += focusMs;
		}
		return total;
	});

	let weeksData = $derived.by(() => {
		const jan1 = new Date(viewYear, 0, 1);
		const dec31 = new Date(viewYear, 11, 31);
		const gridStart = new Date(viewYear, 0, 1 - jan1.getDay());
		const gridEnd = new Date(viewYear, 11, 31 + (6 - dec31.getDay()));

		const weeks: DayCell[][] = [];
		const cursor = new Date(gridStart);
		while (cursor <= gridEnd) {
			const week: DayCell[] = [];
			for (let i = 0; i < 7; i++) {
				const year = cursor.getFullYear();
				const month = cursor.getMonth();
				const day = cursor.getDate();
				const focusMs = focusByDay.get(toDateKey(year, month, day)) ?? 0;
				const inYear = year === viewYear;

				week.push({
					isInYear: inYear,
					focusMs,
					level: getLevel(focusMs, yearMaxFocus),
					hasDeadline: deadlineDates.has(toDateKey(year, month, day)),
					isToday: isToday(year, month, day),
					dateLabel: dayFormatter.format(cursor)
				});

				cursor.setDate(cursor.getDate() + 1);
			}
			weeks.push(week);
		}

		return { weeks, gridStart };
	});

	let monthLabels = $derived.by(() => {
		const labels: Array<{ label: string; column: number }> = [];
		const seenColumns = new Set<number>();
		const startStamp = dayStamp(
			weeksData.gridStart.getFullYear(),
			weeksData.gridStart.getMonth(),
			weeksData.gridStart.getDate()
		);

		for (let month = 0; month < 12; month++) {
			const monthStart = new Date(viewYear, month, 1);
			const monthStamp = dayStamp(monthStart.getFullYear(), monthStart.getMonth(), monthStart.getDate());
			const column = Math.floor((monthStamp - startStamp) / (7 * DAY_MS));

			if (seenColumns.has(column)) continue;
			seenColumns.add(column);
			labels.push({ label: MONTHS_SHORT[month], column });
		}

		return labels;
	});
</script>

<div class="cal-nav">
	<button onclick={prev} aria-label="Previous year">&lt;</button>
	<span class="cal-month">{viewYear} ACTIVITY</span>
	<button onclick={next} aria-label="Next year">&gt;</button>
</div>

<div class="gh-summary">{formatDuration(yearTotalFocus)} FOCUSED</div>

<div class="gh-scroll" style={`--weeks: ${weeksData.weeks.length};`}>
	<div class="gh-month-row">
		<div class="gh-axis-spacer"></div>
		<div class="gh-month-track">
			{#each monthLabels as month}
				<span class="gh-month-label" style={`grid-column: ${month.column + 1};`}>
					{month.label}
				</span>
			{/each}
		</div>
	</div>

	<div class="gh-body-row">
		<div class="gh-weekday-axis">
			{#each WEEKDAY_TICKS as tick}
				<span>{tick}</span>
			{/each}
		</div>

		<div class="gh-grid">
			{#each weeksData.weeks as week}
				<div class="gh-week">
					{#each week as cell}
						<div
							class={`gh-cell gh-level-${cell.level}`}
							class:outside-year={!cell.isInYear}
							class:today={cell.isToday}
							class:has-deadline={cell.hasDeadline}
							title={`${cell.dateLabel}: ${formatDuration(cell.focusMs)} focused${cell.hasDeadline ? ' - deadline' : ''}`}
							aria-label={`${cell.dateLabel}: ${formatDuration(cell.focusMs)} focused${cell.hasDeadline ? ', deadline' : ''}`}
						></div>
					{/each}
				</div>
			{/each}
		</div>
	</div>
</div>

<div class="gh-legend">
	<span>LESS</span>
	<span class="gh-cell gh-level-0"></span>
	<span class="gh-cell gh-level-1"></span>
	<span class="gh-cell gh-level-2"></span>
	<span class="gh-cell gh-level-3"></span>
	<span class="gh-cell gh-level-4"></span>
	<span>MORE</span>
</div>
