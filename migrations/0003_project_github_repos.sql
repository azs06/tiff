CREATE TABLE IF NOT EXISTS project_github_repos (
  user_email TEXT NOT NULL,
  id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  full_name TEXT NOT NULL,
  owner TEXT NOT NULL,
  repo TEXT NOT NULL,
  is_primary INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_email, id),
  FOREIGN KEY (user_email, project_id) REFERENCES projects (user_email, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_project_github_repos_user_project_created
  ON project_github_repos (user_email, project_id, created_at ASC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_project_github_repos_user_project_full_name
  ON project_github_repos (user_email, project_id, full_name COLLATE NOCASE);

INSERT INTO project_github_repos (
  user_email,
  id,
  project_id,
  full_name,
  owner,
  repo,
  is_primary,
  created_at
)
SELECT
  p.user_email,
  lower(hex(randomblob(16))),
  p.id,
  p.github_repo,
  substr(p.github_repo, 1, instr(p.github_repo, '/') - 1),
  substr(p.github_repo, instr(p.github_repo, '/') + 1),
  1,
  p.created_at
FROM projects AS p
WHERE p.github_repo IS NOT NULL
  AND trim(p.github_repo) != ''
  AND instr(p.github_repo, '/') > 0
  AND NOT EXISTS (
    SELECT 1
    FROM project_github_repos AS r
    WHERE r.user_email = p.user_email
      AND r.project_id = p.id
  );
