import * as github from "@actions/github";
import { COMMENT_MARKER } from "./comment";
import type { ChangedFile, PullRequestMetadata } from "./types";

export type Octokit = ReturnType<typeof github.getOctokit>;

interface PullFileResponse {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
  patch?: string;
}

interface PullRequestResponse {
  title?: string | null;
  body?: string | null;
  author_association?: string | null;
  labels?: Array<{ name?: string | null }>;
  additions?: number;
  deletions?: number;
  changed_files?: number;
  commits?: number;
}

interface IssueCommentResponse {
  id: number;
  body?: string;
  user?: {
    type?: string;
  } | null;
}

export interface PullRequestContext {
  owner: string;
  repo: string;
  pullNumber: number;
}

export function getPullRequestContext(): PullRequestContext {
  const pullRequest = github.context.payload.pull_request;
  if (!pullRequest) {
    throw new Error("This action must run on a pull_request event.");
  }

  return {
    owner: github.context.repo.owner,
    repo: github.context.repo.repo,
    pullNumber: pullRequest.number
  };
}

export async function listChangedFiles(octokit: Octokit, context: PullRequestContext): Promise<ChangedFile[]> {
  const files = await octokit.paginate(octokit.rest.pulls.listFiles, {
    owner: context.owner,
    repo: context.repo,
    pull_number: context.pullNumber,
    per_page: 100
  });

  return (files as PullFileResponse[]).map((file) => ({
    filename: file.filename,
    status: file.status,
    additions: file.additions,
    deletions: file.deletions,
    changes: file.changes,
    patch: file.patch
  }));
}

function extractMetadata(raw: PullRequestResponse): PullRequestMetadata {
  return {
    title: raw.title ?? "PR title not found",
    body: raw.body ?? "",
    authorAssociation: raw.author_association ?? "UNKNOWN",
    labels: (raw.labels ?? []).map((label) => label.name).filter((name): name is string => Boolean(name)),
    additions: raw.additions ?? 0,
    deletions: raw.deletions ?? 0,
    changedFiles: raw.changed_files ?? 0,
    commits: raw.commits ?? 1
  };
}

export async function getPullRequestMetadata(octokit: Octokit, context: PullRequestContext): Promise<PullRequestMetadata> {
  const pull = await octokit.rest.pulls.get({
    owner: context.owner,
    repo: context.repo,
    pull_number: context.pullNumber
  });

  return extractMetadata(pull.data);
}

export async function createRiskComment(octokit: Octokit, context: PullRequestContext, body: string): Promise<void> {
  await octokit.rest.issues.createComment({
    owner: context.owner,
    repo: context.repo,
    issue_number: context.pullNumber,
    body
  });
}

export async function updateRiskComment(octokit: Octokit, context: PullRequestContext, body: string): Promise<"created" | "updated"> {
  const comments = await octokit.paginate(octokit.rest.issues.listComments, {
    owner: context.owner,
    repo: context.repo,
    issue_number: context.pullNumber,
    per_page: 100
  });
  const previous = (comments as IssueCommentResponse[]).find((comment) => comment.user?.type === "Bot" && comment.body?.includes(COMMENT_MARKER));

  if (!previous) {
    await createRiskComment(octokit, context, body);
    return "created";
  }

  await octokit.rest.issues.updateComment({
    owner: context.owner,
    repo: context.repo,
    comment_id: previous.id,
    body
  });
  return "updated";
}
