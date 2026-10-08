import { ExternalLink } from "lucide-react";
import type { ChatEndpoint } from "@/api/chatEndpoints";
import { AgentAvatarDownload } from "@/components/AgentAvatarDownload";
import { CopyText } from "@/components/CopyText";
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
    <details className="text-sm">
      <summary className="cursor-pointer text-muted-foreground">
        GitHub App name and logo
      </summary>
      <div className="mt-4 space-y-4">
        <p>
          This is your custom GitHub App
          {endpoint.botLabel ? (
            <>
              : <strong>{endpoint.botLabel}</strong>.
            </>
          ) : (
            "."
          )}
          {endpoint.providerAccountLabel && (
            <>
              {" "}
              Owned by <strong>{endpoint.providerAccountLabel}</strong>.
            </>
          )}
        </p>
        <p className="text-xs text-muted-foreground">
          GitHub derives the @mention from the App name. Upload your logo in the
          App’s Display information settings.
        </p>
        {avatarUrl && (
          <div className="flex flex-wrap items-center gap-4">
            <img
              src={avatarUrl}
              alt={`${endpoint.assignedAgentName}’s avatar for download`}
              className="size-20 rounded-lg bg-muted object-contain"
            />
            <AgentAvatarDownload
              avatarUrl={avatarUrl}
              name={endpoint.botLabel ?? endpoint.assignedAgentName}
            />
          </div>
        )}
        <a
          href={gitHubAppSettingsUrl(endpoint)}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-2 underline underline-offset-4"
        >
          Edit App name and logo on GitHub <ExternalLink className="size-3" />
        </a>
        <p className="text-xs text-muted-foreground">
          After renaming the App,{" "}
          <Link
            className="underline underline-offset-4"
            to={`/apps/chat/connect?provider=github&resume=${endpoint.id}&reconnect=1`}
          >
            reconnect this App
          </Link>{" "}
          to refresh its mention in Paperclip.
        </p>
      </div>
    </details>
  );
}
