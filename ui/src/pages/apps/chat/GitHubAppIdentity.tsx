import { ChevronRight, ExternalLink } from "lucide-react";
import type { ChatEndpoint } from "@/api/chatEndpoints";
import { AgentAvatarDownload } from "@/components/AgentAvatarDownload";
import { CopyText } from "@/components/CopyText";
import { Button } from "@/components/ui/button";
import { Link } from "@/lib/router";

export function gitHubBotMention(endpoint: Pick<ChatEndpoint, "botUsername">) {
  const slug = endpoint.botUsername?.replace(/^@/, "").replace(/\[bot\]$/, "");
  return slug ? `@${slug}` : null;
}

export function gitHubAppSettingsUrl(endpoint: ChatEndpoint) {
  const github = endpoint.setup?.github;
  const slug = gitHubBotMention(endpoint)?.slice(1);
  if (!slug) return "https://github.com/settings/apps";
  if (github?.ownerType === "organization" && github.ownerLogin)
    return `https://github.com/organizations/${encodeURIComponent(github.ownerLogin)}/settings/apps/${encodeURIComponent(slug)}`;
  if (github?.ownerType === "personal")
    return `https://github.com/settings/apps/${encodeURIComponent(slug)}`;
  // Legacy manual connections may not record ownership type. Never assume it.
  return "https://github.com/settings/apps";
}

export function GitHubBotMention({ endpoint }: { endpoint: ChatEndpoint }) {
  const mention = gitHubBotMention(endpoint);
  return mention ? (
    <CopyText
      text={mention}
      ariaLabel="Copy GitHub mention"
      title="Copy GitHub mention"
      className="break-all font-mono text-xs"
    >
      {mention}
    </CopyText>
  ) : null;
}

/** Optional provider-owned branding, shared by completion and management. */
export function GitHubAppBranding({
  endpoint,
  avatarUrl,
}: {
  endpoint: ChatEndpoint;
  avatarUrl?: string;
}) {
  return (
    <details className="group text-sm">
      <summary className="flex cursor-pointer list-none items-center gap-2 text-muted-foreground hover:text-foreground">
        <ChevronRight className="size-4 shrink-0 transition-transform group-open:rotate-90" />
        GitHub App name and logo
      </summary>
      <div className="mt-4 space-y-4">
        <p className="text-sm text-muted-foreground">
          Change the name or upload a logo in the App’s Display information settings on GitHub.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          {avatarUrl && <>
            <img
              src={avatarUrl}
              alt={`${endpoint.assignedAgentName}’s avatar for download`}
              className="size-12 shrink-0 object-contain"
            />
            <AgentAvatarDownload
              avatarUrl={avatarUrl}
              name={endpoint.botLabel ?? endpoint.assignedAgentName}
            />
          </>}
          <Button variant="outline" asChild>
            <a href={gitHubAppSettingsUrl(endpoint)} target="_blank" rel="noreferrer"
              aria-label="Edit App name and logo on GitHub">
              Edit on GitHub <ExternalLink className="size-4" />
            </a>
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Renaming also changes its @mention.{" "}
          <Link
            className="underline underline-offset-4"
            to={`/apps/chat/connect?provider=github&resume=${endpoint.id}&reconnect=1`}
          >
            Reconnect afterward
          </Link>{" "}to update it here.
        </p>
      </div>
    </details>
  );
}
