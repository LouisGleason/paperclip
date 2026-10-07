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
}: {
  endpoint: ChatEndpoint;
  view: "settings" | "access";
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
            <section className="space-y-3">
              <h2 className="text-base font-semibold">Agent tools</h2>
              <GitHubToggle
                label="Use this bot’s GitHub tools"
                description="Limited to enabled repositories and this bot’s tasks. Tool policies still apply."
                checked={config.toolsEnabled}
                onChange={(toolsEnabled) => edit({ ...config, toolsEnabled })}
              />
              {endpoint.connectionId && (
                <Link
                  className="text-xs text-muted-foreground underline underline-offset-4"
                  to={`/apps/${endpoint.connectionId}`}
                >
                  Manage tool permissions
                </Link>
              )}
            </section>
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

export function groupGitHubReviews(reviews: GitHubTaskReview[]) {
  const groups = new Map<string, GitHubTaskReview[]>();
  for (const review of [...reviews].sort(
    (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
  )) {
    const key = `${review.repositoryId}:${review.pullNumber}`;
    groups.set(key, [...(groups.get(key) ?? []), review]);
  }
  return [...groups.values()];
}

function ReviewResult({ review }: { review: GitHubTaskReview }) {
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
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <span className="text-sm font-medium">
          {completed ? `${review.assessment!.score}/5 · ${conclusion}` : state}
        </span>
        <span className="text-xs text-muted-foreground">
          Commit <code>{review.headSha.slice(0, 7)}</code> ·{" "}
          {formatDateTime(review.updatedAt)}
        </span>
      </div>
      <MarkdownBody className="text-sm">
        {review.assessment?.summary ?? review.event.title}
      </MarkdownBody>
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
      <details className="text-sm">
        <summary className="cursor-pointer text-muted-foreground">
          Review details
        </summary>
        <div className="mt-3 space-y-2">
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
              <MarkdownBody>{review.assessment.rationale}</MarkdownBody>
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
      </details>
    </div>
  );
}

export function GitHubReviewList({ reviews }: { reviews: GitHubTaskReview[] }) {
  if (!reviews.length)
    return (
      <EmptyState
        icon={GitPullRequest}
        message="No reviews yet"
        description="Mention the bot on a pull request, or enable automatic events in Settings."
      />
    );
  return (
    <div className="divide-y divide-border border-y border-border">
      {groupGitHubReviews(reviews).map(([latest, ...history]) => (
        <article
          key={`${latest.repositoryId}:${latest.pullNumber}`}
          className="space-y-4 py-5"
        >
          <div className="space-y-1">
            <a
              className="text-sm font-semibold hover:underline"
              href={`https://github.com/${latest.repository}/pull/${latest.pullNumber}`}
              target="_blank"
              rel="noreferrer"
            >
              {latest.event.title || `Pull request #${latest.pullNumber}`}
            </a>
            <p className="break-all text-xs text-muted-foreground">
              {latest.repository} #{latest.pullNumber}
            </p>
          </div>
          <ReviewResult review={latest} />
          {history.length > 0 && (
            <details className="text-sm">
              <summary className="cursor-pointer text-muted-foreground">
                {history.length} earlier{" "}
                {history.length === 1 ? "review" : "reviews"}
              </summary>
              <div className="mt-4 space-y-6 border-l border-border pl-4">
                {history.map((review) => (
                  <ReviewResult key={review.id} review={review} />
                ))}
              </div>
            </details>
          )}
        </article>
      ))}
    </div>
  );
}

export function GitHubReviews({ endpointId }: { endpointId: string }) {
  const query = useQuery({
    queryKey: ["github-bot-reviews", endpointId],
    queryFn: () => githubChatApi.reviews(endpointId),
    refetchInterval: 5000,
  });
  return (
    <section className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Latest review for each pull request. Results apply to the commit shown.
      </p>
      {query.isError ? (
        <p role="alert" className="text-sm text-destructive">
          Reviews could not be loaded.{" "}
          <Button variant="link" onClick={() => void query.refetch()}>
            Try again
          </Button>
        </p>
      ) : query.isPending ? (
        <p role="status" className="text-sm text-muted-foreground">
          Loading reviews…
        </p>
      ) : (
        <GitHubReviewList reviews={query.data} />
      )}
    </section>
  );
}
