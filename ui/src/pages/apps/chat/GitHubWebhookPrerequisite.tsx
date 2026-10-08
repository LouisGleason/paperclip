import { AlertTriangle, Info } from "lucide-react";

export function GitHubWebhookPrerequisite({
  origin,
  cloudState,
}: {
  origin: string;
  cloudState: "loading" | "active" | "required" | "unavailable";
}) {
  if (new URL(origin).protocol === "https:") return null;
  const warning = cloudState === "required" || cloudState === "unavailable";
  const Icon = warning ? AlertTriangle : Info;
  return (
    <div
      role={warning ? "alert" : "note"}
      className="flex items-start gap-3 rounded-lg border border-(--status-agent-paused)/30 bg-(--status-agent-paused)/10 p-4"
    >
      <Icon className="size-5 shrink-0 text-(--status-task-icon-todo)" />
      <div className="space-y-2 text-sm">
        <p className="font-semibold">
          GitHub needs public HTTPS webhook delivery
        </p>
        <p>
          GitHub cannot send webhooks directly to this HTTP address.
          {cloudState === "active"
            ? " Paperclip Cloud is connected and provides the HTTPS webhook. Keep this instance running to receive events."
            : cloudState === "loading"
              ? " Paperclip Cloud can provide HTTPS delivery. Checking its connection…"
              : `${cloudState === "unavailable" ? " Couldn’t confirm Cloud delivery." : ""} Connect Paperclip Cloud during setup, or configure a publicly reachable HTTPS URL before creating an App.`}
        </p>
        {warning && (
          <a
            href="https://docs.paperclip.ing/reference/deploy/https/"
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-4"
          >
            Set up public HTTPS
          </a>
        )}
      </div>
    </div>
  );
}
