import type { GitHubRepoInfo } from './types';

const CACHE_FRESH_MS = 5 * 60 * 1000; // 5 minutes
const ERROR_CACHE_FRESH_MS = 60 * 1000; // 1 minute for error states

export class GitHubError extends Error {
	constructor(
		message: string,
		public code: 'not_found' | 'rate_limited' | 'api_error'
	) {
		super(message);
	}
}

export function parseGitHubRepo(input: string): { owner: string; repo: string } | null {
	const trimmed = input.trim();

	// Handle owner/repo format
	const slashMatch = trimmed.match(/^([a-zA-Z0-9._-]+)\/([a-zA-Z0-9._-]+)$/);
	if (slashMatch) return { owner: slashMatch[1], repo: slashMatch[2] };

	// Handle full GitHub URL
	try {
		const url = new URL(trimmed);
		if (url.hostname === 'github.com' || url.hostname === 'www.github.com') {
			const parts = url.pathname.split('/').filter(Boolean);
			if (parts.length >= 2) return { owner: parts[0], repo: parts[1].replace(/\.git$/, '') };
		}
	} catch {
		// Not a URL, that's fine
	}

	return null;
}

export function isCacheFresh(info: GitHubRepoInfo): boolean {
	const maxAge = info.error ? ERROR_CACHE_FRESH_MS : CACHE_FRESH_MS;
	return Date.now() - info.fetchedAt < maxAge;
}

export async function fetchRepoInfo(
	owner: string,
	repo: string,
	opts: { token: string }
): Promise<GitHubRepoInfo> {
	const headers: Record<string, string> = {
		Accept: 'application/vnd.github+json',
		Authorization: `Bearer ${opts.token}`,
		'User-Agent': 'tiff-app'
	};

	const [repoRes, prsRes] = await Promise.all([
		fetch(`https://api.github.com/repos/${owner}/${repo}`, { headers }),
		fetch(
			`https://api.github.com/repos/${owner}/${repo}/pulls?state=closed&sort=updated&per_page=5&direction=desc`,
			{ headers }
		)
	]);

	if (repoRes.status === 404) {
		throw new GitHubError('Repository not found', 'not_found');
	}
	if (repoRes.status === 403 || repoRes.status === 429) {
		throw new GitHubError('GitHub API rate limit exceeded', 'rate_limited');
	}
	if (!repoRes.ok) {
		throw new GitHubError(`GitHub API error: ${repoRes.status}`, 'api_error');
	}

	const repoData = (await repoRes.json()) as {
		full_name: string;
		description: string | null;
		default_branch: string;
		pushed_at: string;
		stargazers_count: number;
		open_issues_count: number;
	};

	let lastMergedPr: GitHubRepoInfo['lastMergedPr'] = null;
	if (prsRes.ok) {
		const prs = (await prsRes.json()) as Array<{
			number: number;
			title: string;
			merged_at: string | null;
			html_url: string;
		}>;
		const merged = prs.find((pr) => pr.merged_at);
		if (merged) {
			lastMergedPr = {
				number: merged.number,
				title: merged.title,
				mergedAt: merged.merged_at!,
				url: merged.html_url
			};
		}
	}

	return {
		fullName: repoData.full_name,
		description: repoData.description,
		defaultBranch: repoData.default_branch,
		lastPushedAt: repoData.pushed_at,
		stars: repoData.stargazers_count,
		openIssueCount: repoData.open_issues_count,
		lastMergedPr,
		fetchedAt: Date.now()
	};
}

export async function fetchReadme(
	owner: string,
	repo: string,
	opts: { token: string }
): Promise<{ content: string; updatedAt: string | null } | null> {
	const headers: Record<string, string> = {
		Authorization: `Bearer ${opts.token}`,
		'User-Agent': 'tiff-app'
	};

	const [contentRes, commitsRes] = await Promise.all([
		fetch(`https://api.github.com/repos/${owner}/${repo}/readme`, {
			headers: { ...headers, Accept: 'application/vnd.github.raw+json' }
		}),
		fetch(
			`https://api.github.com/repos/${owner}/${repo}/commits?path=README.md&per_page=1`,
			{ headers: { ...headers, Accept: 'application/vnd.github+json' } }
		)
	]);

	if (!contentRes.ok) return null;
	const content = await contentRes.text();

	let updatedAt: string | null = null;
	if (commitsRes.ok) {
		const commits = (await commitsRes.json()) as Array<{
			commit: { committer: { date: string } };
		}>;
		if (commits.length > 0) {
			updatedAt = commits[0].commit.committer.date;
		}
	}

	return { content, updatedAt };
}
