import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ExternalLink,
  GitPullRequest,
  MoreHorizontal,
  RefreshCw,
} from "lucide-react";
import type {
  GitHubChatConfiguration,
  GitHubTaskReview,
} from "@paperclipai/shared";
import {
  githubChatApi,
  type GitHubConfigurationRecord,
} from "@/api/githubChat";
import {
  chatEndpointsApi,
  type ChatEndpoint,
  type ChatEndpointResource,
} from "@/api/chatEndpoints";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/EmptyState";
import { MarkdownBody } from "@/components/MarkdownBody";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Link } from "@/lib/router";
import { formatDateTime } from "@/lib/utils";
import {
  GitHubAccessEditor,
  GitHubPolicyEditor,
  GitHubToggle,
  githubSelectClass,
} from "./GitHubBotConfiguration";
import { GitHubAppBranding } from "./GitHubAppIdentity";

export function GitHubRepositoryAccess({
  resources,
  managementUrl,
  pending,
  onRefresh,
  onChange,
}: {
  resources: ChatEndpointResource[];
  managementUrl: string;
  pending: boolean;
  onRefresh: () => void;
  onChange: (id: string, enabled: boolean) => void;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold">Repositories</h2>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Manage repositories"
            >
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem asChild>
              <a href={managementUrl} target="_blank" rel="noreferrer">
                Manage on GitHub
                <ExternalLink className="size-4" />
              </a>
            </DropdownMenuItem>
            <DropdownMenuItem disabled={pending} onClick={onRefresh}>
              <RefreshCw className="size-4" />
              Refresh repositories
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <p className="text-xs text-muted-foreground">
        Choose where the bot can receive messages and use tools. Repository
        changes save immediately.
      </p>
      <div className="divide-y divide-border border-y border-border">
        {resources.map((resource) => (
          <div key={resource.id} className="py-3">
            <GitHubToggle
              label={resource.label ?? resource.providerResourceId}
              checked={resource.enabled}
              disabled={
                pending ||
                (resource.availability !== "available" && !resource.enabled)
              }
              description={
                resource.availability === "available"
                  ? undefined
                  : "Unavailable on GitHub. Update the App’s installation access, then refresh."
              }
              onChange={(enabled) => onChange(resource.id, enabled)}
            />
          </div>
        ))}
        {resources.length === 0 && (
          <p className="py-4 text-sm text-muted-foreground">
            No repositories available. Add repository access on GitHub, then
            refresh.
          </p>
        )}
      </div>
    </section>
  );
}

export function GitHubBotManagement({
  endpoint,
  view,
  avatarUrl,
}: {
  endpoint: ChatEndpoint;
  view: "settings" | "access";
  avatarUrl?: string;
}) {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ["github-bot-configuration", endpoint.id],
    queryFn: () => githubChatApi.configuration(endpoint.id),
  });
  const resources = useQuery({
    queryKey: ["github-bot-repositories", endpoint.id],
    queryFn: () => chatEndpointsApi.listResources(endpoint.id),
  });
  const [draft, setDraft] = useState<GitHubConfigurationRecord | null>(null);
  const [repository, setRepository] = useState("");
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const record = draft ?? query.data;
  const dirty = Boolean(
    draft &&
      JSON.stringify(draft.configuration) !==
        JSON.stringify(query.data?.configuration),
  );
  const edit = (configuration: GitHubChatConfiguration) => {
    if (record) setDraft({ ...record, configuration });
    setNotice("");
  };
  const act = async (fn: () => Promise<unknown>) => {
    setPending(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save changes.");
    } finally {
      setPending(false);
    }
  };
  if (query.isError || resources.isError)
    return (
      <p role="alert" className="text-sm text-destructive">
        Could not load the bot configuration.{" "}
        <Button
          variant="link"
          onClick={() => {
            void query.refetch();
            void resources.refetch();
          }}
        >
          Try again
        </Button>
      </p>
    );
  if (!record || resources.isPending)
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Loading configuration…
      </p>
    );
  const config = record.configuration;
  const repositories = (resources.data ?? []).filter(
    (resource) => resource.type === "repository",
  );
  const override = repository ? config.repositories[repository] : undefined;
  return (
    <section className="max-w-3xl space-y-8">
      <fieldset disabled={pending} className="min-w-0 space-y-8">
        {view === "access" ? (
          <>
            <GitHubRepositoryAccess
              resources={repositories}
              pending={pending}
              managementUrl={
                endpoint.setup?.github?.managementUrl ??
                endpoint.setup?.github?.installationUrl ??
                "https://github.com/settings/installations"
              }
              onRefresh={() =>
                void act(async () => {
                  await githubChatApi.refreshRepositories(endpoint.id);
                  await resources.refetch();
                  setNotice(
                    "Repository access refreshed. New repositories stay disabled.",
                  );
                })
              }
              onChange={(id, enabled) =>
                void act(async () => {
                  await chatEndpointsApi.updateResources(endpoint.id, [
                    { id, enabled },
                  ]);
                  await resources.refetch();
                })
              }
            />
            <GitHubAccessEditor
              endpointId={endpoint.id}
              companyId={endpoint.companyId}
              configuration={config}
              onChange={edit}
            />
            {!config.toolsEnabled && (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  This saved bot has GitHub tools disabled, so it cannot start
                  work or respond.
                </p>
                <Button
                  variant="outline"
                  onClick={() => edit({ ...config, toolsEnabled: true })}
                >
                  Enable bot tools
                </Button>
              </div>
            )}
            {endpoint.connectionId && (
              <Link
                className="text-xs text-muted-foreground underline underline-offset-4"
                to={`/apps/${endpoint.connectionId}`}
              >
                Manage tool permissions
              </Link>
            )}
          </>
        ) : (
          <>
            <GitHubPolicyEditor
              policy={config.defaults}
              onChange={(defaults) => edit({ ...config, defaults })}
            />
            <details className="text-sm">
              <summary className="cursor-pointer text-muted-foreground">
                Repository overrides
                {Object.keys(config.repositories).length > 0
                  ? ` (${Object.keys(config.repositories).length})`
                  : ""}
              </summary>
              <div className="mt-4 space-y-5">
                <label
                  htmlFor="github-policy-repository"
                  className="block text-sm font-medium"
                >
                  Repository
                </label>
                <select
                  id="github-policy-repository"
                  className={githubSelectClass}
                  value={repository}
                  onChange={(e) => setRepository(e.target.value)}
                >
                  <option value="">Choose a repository</option>
                  {repositories
                    .filter(
                      (r) => r.enabled && r.metadata?.providerRepositoryId,
                    )
                    .map((r) => (
                      <option
                        key={r.id}
                        value={String(r.metadata?.providerRepositoryId)}
                      >
                        {r.label ?? r.providerResourceId}
                      </option>
                    ))}
                </select>
                {repository && (
                  <GitHubToggle
                    label="Use custom settings for this repository"
                    checked={!!override}
                    onChange={(enabled) => {
                      const overrides = { ...config.repositories };
                      if (enabled)
                        overrides[repository] = { ...config.defaults };
                      else delete overrides[repository];
                      edit({ ...config, repositories: overrides });
                    }}
                  />
                )}
                {repository && override && (
                  <GitHubPolicyEditor
                    policy={{ ...config.defaults, ...override }}
                    onChange={(policy) =>
                      edit({
                        ...config,
                        repositories: {
                          ...config.repositories,
                          [repository]: policy,
                        },
                      })
                    }
                  />
                )}
                {repository && !override && (
                  <p className="text-xs text-muted-foreground">
                    Uses the settings above.
                  </p>
                )}
              </div>
            </details>
            <GitHubAppBranding endpoint={endpoint} avatarUrl={avatarUrl} />
          </>
        )}
      </fieldset>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-sm text-muted-foreground">
          {notice}
        </p>
      )}
      {dirty && (
        <div className="sticky bottom-(--tc-composer-bottom) z-10 flex items-center justify-between gap-3 border-t border-border bg-background py-4 md:bottom-0">
          <Button
            variant="ghost"
            disabled={pending}
            onClick={() => {
              setDraft(null);
              setError("");
            }}
          >
            Discard changes
          </Button>
          <Button
            disabled={pending}
            onClick={() =>
              void act(async () => {
                const saved = await githubChatApi.save(
                  endpoint.id,
                  record.revision,
                  config,
                );
                client.setQueryData(
                  ["github-bot-configuration", endpoint.id],
                  saved,
                );
                setDraft(null);
                setNotice("Changes saved.");
              })
            }
          >
            {pending ? "Saving…" : "Save changes"}
          </Button>
        </div>
      )}
    </section>
  );
}

export function orderedGitHubReviews(reviews: GitHubTaskReview[]) {
  return [...reviews].sort(
    (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
  );
}

export function gitHubReviewResultLabel(review: GitHubTaskReview) {
  const completed = review.state === "completed" && review.assessment?.complete;
  const conclusion = review.conclusion
    ? {
        success: "Passed",
        failure: "Below threshold",
        neutral: "Report only",
        action_required: "Action required",
      }[review.conclusion]
    : "Awaiting check";
  const state = {
    queued: "Queued",
    running: "Reviewing",
    completed: "Incomplete",
    incomplete: "Incomplete",
    error: "Review failed",
    superseded: "Superseded",
    manual_required: "Action required",
  }[review.state];
  return completed ? `${review.assessment!.score}/5 · ${conclusion}` : state;
}

function ReviewResult({ review }: { review: GitHubTaskReview }) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <span className="text-sm font-medium">
          {gitHubReviewResultLabel(review)}
        </span>
        <span className="text-xs text-muted-foreground">
          Commit <code>{review.headSha.slice(0, 7)}</code> ·{" "}
          {formatDateTime(review.updatedAt)}
        </span>
      </div>
      {review.assessment ? (
        <MarkdownBody className="text-sm">
          {review.assessment.summary}
        </MarkdownBody>
      ) : (
        <p className="text-sm text-muted-foreground">
          No assessment has been submitted yet.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
        <Link
          className="underline underline-offset-4"
          to={`/issues/${review.issueId}`}
        >
          Paperclip task
        </Link>
        {review.summaryUrl && (
          <a
            className="underline underline-offset-4"
            href={review.summaryUrl}
            target="_blank"
            rel="noreferrer"
          >
            GitHub comment
          </a>
        )}
        {review.checkUrl && (
          <a
            className="underline underline-offset-4"
            href={review.checkUrl}
            target="_blank"
            rel="noreferrer"
          >
            Check
          </a>
        )}
      </div>
      <section className="space-y-4 text-sm" aria-label="Review evidence">
        <div className="space-y-3">
          {review.runId && (
            <Link
              className="text-xs underline underline-offset-4"
              to={`/issues/${review.issueId}?runId=${review.runId}`}
            >
              Agent run
            </Link>
          )}
          {review.assessment && (
            <>
              <h3 className="font-medium">Rationale</h3>
              <MarkdownBody>{review.assessment.rationale}</MarkdownBody>
              {review.assessment.findings.length > 0 && (
                <section className="space-y-3">
                  <h3 className="font-medium">Findings</h3>
                  {review.assessment.findings.map((finding) => (
                    <div
                      key={finding.key}
                      className="space-y-2 border-l border-border pl-4"
                    >
                      <p className="break-all font-mono text-xs">
                        {finding.path}:{finding.line} · {finding.severity}
                      </p>
                      <MarkdownBody>{finding.body}</MarkdownBody>
                    </div>
                  ))}
                </section>
              )}
              <h3 className="font-medium">Coverage</h3>
              <p className="text-xs text-muted-foreground">
                {review.assessment.coverage.reviewedPaths.length} files reviewed
                · {review.assessment.coverage.omittedPaths.length} omitted
              </p>
              {review.assessment.coverage.limitations.map((limit, index) => (
                <p key={index} className="text-xs text-muted-foreground">
                  {limit}
                </p>
              ))}
            </>
          )}
        </div>
      </section>
    </div>
  );
}

export function GitHubReviewList({
  endpointId,
  reviews,
}: {
  endpointId: string;
  reviews: GitHubTaskReview[];
}) {
  if (!reviews.length)
    return (
      <EmptyState
        icon={GitPullRequest}
        message="No reviews yet"
        description="Mention the bot on a pull request, or enable automatic events in Settings."
      />
    );
  return (
    <ul
      aria-label="Reviews"
      className="divide-y divide-border border-y border-border"
    >
      {orderedGitHubReviews(reviews).map((review) => (
        <li key={review.id}>
          <Link
            to={`/apps/chat/${endpointId}/reviews/${review.id}`}
            className="flex flex-wrap items-center gap-x-6 gap-y-2 py-4 text-sm hover:bg-accent/50"
          >
            <div className="min-w-0 flex-1 basis-48 space-y-1">
              <p className="break-words font-medium">
                {review.event.title || `Pull request #${review.pullNumber}`}
              </p>
              <p className="break-all text-xs text-muted-foreground">
                {review.repository} #{review.pullNumber} ·{" "}
                <code>{review.headSha.slice(0, 7)}</code>
              </p>
            </div>
            <div className="space-y-1 text-right">
              <p className="font-medium">{gitHubReviewResultLabel(review)}</p>
              <time
                className="text-xs text-muted-foreground"
                dateTime={review.createdAt}
              >
                {formatDateTime(review.createdAt)}
              </time>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function GitHubReviewDetail({
  endpointId,
  review,
}: {
  endpointId: string;
  review: GitHubTaskReview;
}) {
  return (
    <article className="max-w-3xl space-y-6">
      <Link
        className="text-sm text-muted-foreground hover:underline"
        to={`/apps/chat/${endpointId}/reviews`}
      >
        ← All reviews
      </Link>
      <header className="space-y-2">
        <h2 className="text-lg font-semibold">
          {review.event.title || `Pull request #${review.pullNumber}`}
        </h2>
        <a
          className="break-all text-sm text-muted-foreground hover:underline"
          href={`https://github.com/${review.repository}/pull/${review.pullNumber}`}
          target="_blank"
          rel="noreferrer"
        >
          {review.repository} #{review.pullNumber}
        </a>
      </header>
      <ReviewResult review={review} />
    </article>
  );
}

export function GitHubReviews({
  endpointId,
  reviewId,
}: {
  endpointId: string;
  reviewId?: string;
}) {
  const query = useQuery({
    queryKey: ["github-bot-reviews", endpointId],
    queryFn: () => githubChatApi.reviews(endpointId),
    refetchInterval: 5000,
  });
  if (query.isError)
    return (
      <p role="alert" className="text-sm text-destructive">
        Reviews could not be loaded.{" "}
        <Button variant="link" onClick={() => void query.refetch()}>
          Try again
        </Button>
      </p>
    );
  if (query.isPending)
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Loading reviews…
      </p>
    );
  if (reviewId) {
    const review = query.data.find((review) => review.id === reviewId);
    return review ? (
      <GitHubReviewDetail endpointId={endpointId} review={review} />
    ) : (
      <div className="space-y-3">
        <p role="alert" className="text-sm text-muted-foreground">
          This review was not found in this connection.
        </p>
        <Link
          to={`/apps/chat/${endpointId}/reviews`}
          className="text-sm underline"
        >
          All reviews
        </Link>
      </div>
    );
  }
  return <GitHubReviewList endpointId={endpointId} reviews={query.data} />;
}
