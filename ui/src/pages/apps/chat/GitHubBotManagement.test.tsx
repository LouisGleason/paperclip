// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  defaultGitHubReviewPolicy,
  type GitHubChatConfiguration,
  type GitHubTaskReview,
} from "@paperclipai/shared";
import { ChatEndpointDetail } from "./ChatEndpointDetail";
import { GitHubReviewList, orderedGitHubReviews } from "./GitHubBotManagement";
import { GitHubPolicyEditor } from "./GitHubBotConfiguration";
import { conversationDestination } from "./ChatConversationList";
import { queryKeys } from "@/lib/queryKeys";
import { TooltipProvider } from "@/components/ui/tooltip";
import { gitHubAppSettingsUrl, gitHubBotMention } from "./GitHubAppIdentity";
import type { ChatEndpoint } from "@/api/chatEndpoints";

const mocks = vi.hoisted(() => ({
  tab: "settings",
  reviewId: undefined as string | undefined,
  get: vi.fn(),
  config: vi.fn(),
  save: vi.fn(),
  resources: vi.fn(),
  updateResources: vi.fn(),
  reviews: vi.fn(),
  members: vi.fn(),
  links: vi.fn(),
  setBreadcrumbs: vi.fn(),
}));
vi.mock("@/api/githubChat", () => ({
  githubChatApi: {
    configuration: mocks.config,
    save: mocks.save,
    reviews: mocks.reviews,
  },
}));
vi.mock("@/api/chatEndpoints", () => ({
  chatEndpointsApi: {
    get: mocks.get,
    listResources: mocks.resources,
    updateResources: mocks.updateResources,
    listPrincipals: mocks.links,
  },
}));
vi.mock("@/api/access", () => ({ accessApi: { listMembers: mocks.members } }));
vi.mock("@/api/agents", () => ({ agentsApi: { get: vi.fn() } }));
vi.mock("@/context/BreadcrumbContext", () => ({
  useBreadcrumbs: () => ({ setBreadcrumbs: mocks.setBreadcrumbs }),
}));
vi.mock("@/context/ToastContext", () => ({
  useToast: () => ({ pushToast: vi.fn() }),
}));
vi.mock("@/components/MarkdownBody", () => ({
  MarkdownBody: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));
vi.mock("@/lib/router", () => ({
  useParams: () => ({
    endpointId: "bot",
    tab: mocks.tab,
    reviewId: mocks.reviewId,
  }),
  useNavigate: () => vi.fn(),
  Link: ({
    children,
    to,
    ...props
  }: React.ComponentProps<"a"> & { to: string }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
  Navigate: () => null,
}));
const endpoint = {
  id: "bot",
  companyId: "company",
  provider: "github",
  assignedAgentId: "agent",
  assignedAgentName: "Maya",
  status: "active",
  allowUnlinkedPeople: false,
  setup: { step: "complete" },
};
const base: GitHubChatConfiguration = {
  version: 1,
  toolsEnabled: true,
  responsibleUserId: "member",
  memberAccess: "selected",
  people: [
    {
      kind: "member",
      userId: "member",
      githubUserId: "42",
      login: "maya",
      automaticReviews: true,
    },
  ],
  defaults: {
    ...defaultGitHubReviewPolicy(),
    instructions: "Keep existing instructions",
    issueOpened: true,
  },
  repositories: {},
};

describe("GitHub bot management", () => {
  let root: Root;
  let container: HTMLDivElement;
  let client: QueryClient;
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.tab = "settings";
    mocks.reviewId = undefined;
    mocks.get.mockResolvedValue(endpoint);
    mocks.config.mockResolvedValue({
      revision: 4,
      configuration: structuredClone(base),
    });
    mocks.resources.mockResolvedValue([
      {
        id: "repo",
        type: "repository",
        label: "acme/web",
        enabled: true,
        availability: "available",
        metadata: { providerRepositoryId: "100" },
      },
    ]);
    mocks.links.mockResolvedValue([
      {
        id: "link",
        principalId: "identity",
        status: "linked",
        githubUserId: "42",
        githubLogin: "maya",
        paperclipUserId: "member",
        paperclipUserLabel: "Maya",
      },
    ]);
    mocks.members.mockResolvedValue({
      members: [
        {
          principalId: "member",
          status: "active",
          membershipRole: "owner",
          user: { name: "Maya" },
        },
      ],
    });
    mocks.reviews.mockResolvedValue([]);
    mocks.save.mockImplementation(async (_id, revision, configuration) => ({
      revision: revision + 1,
      configuration,
    }));
    mocks.updateResources.mockResolvedValue([]);
    client = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });
    client.setQueryData(queryKeys.agents.detail("agent"), {
      id: "agent",
      name: "Maya",
    });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    client.clear();
    container.remove();
  });
  async function render(tab = mocks.tab) {
    mocks.tab = tab;
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <TooltipProvider>
            <ChatEndpointDetail />
          </TooltipProvider>
        </QueryClientProvider>,
      ),
    );
    await vi.waitFor(() =>
      expect(
        container.querySelector(
          'textarea[placeholder="What should this agent do on GitHub?"]',
        ) || container.querySelector("#github-member-access"),
      ).not.toBeNull(),
    );
  }
  async function click(name: string) {
    const target = [...container.querySelectorAll("button")].find(
      (b) =>
        b.getAttribute("aria-label") === name || b.textContent?.trim() === name,
    );
    expect(target).toBeDefined();
    await act(async () => target!.click());
  }
  async function input(
    element: HTMLTextAreaElement | HTMLSelectElement,
    value: string,
  ) {
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        element instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : HTMLSelectElement.prototype,
        "value",
      )!.set!.call(element, value);
      element.dispatchEvent(
        new Event(element instanceof HTMLSelectElement ? "change" : "input", {
          bubbles: true,
        }),
      );
    });
  }
  it("shows the verified custom App mention and its own organization branding settings", async () => {
    const branded: ChatEndpoint = {
      ...endpoint,
      provider: "github",
      status: "active",
      botLabel: "Maya Reviews",
      botUsername: "maya-reviews[bot]",
      providerAccountLabel: "acme",
      setup: {
        step: "complete",
        github: {
          stage: "verify",
          ownerType: "organization",
          ownerLogin: "acme",
          appSlug: "old-draft-name",
        },
      },
    };
    mocks.get.mockResolvedValue(branded);
    await render();
    expect(
      container.querySelector('button[aria-label="Copy GitHub mention"]')
        ?.textContent,
    ).toBe("@maya-reviews");
    expect(container.textContent).toContain("This is your custom GitHub App");
    const branding = [...container.querySelectorAll("a")].find((a) =>
      a.textContent?.includes("Edit App name and logo"),
    );
    expect(branding?.href).toBe(
      "https://github.com/organizations/acme/settings/apps/maya-reviews",
    );
    expect(
      container.querySelector("a[download]")?.getAttribute("download"),
    ).toBe("Maya-Reviews-avatar.png");
    expect(mocks.save).not.toHaveBeenCalled();
    expect(
      gitHubAppSettingsUrl({
        ...branded,
        setup: {
          step: "complete",
          github: { stage: "verify", ownerType: "personal" },
        },
      }),
    ).toBe("https://github.com/settings/apps/maya-reviews");
    expect(
      gitHubAppSettingsUrl({ ...branded, setup: { step: "complete" } }),
    ).toBe("https://github.com/settings/apps");
    expect(gitHubBotMention({ botUsername: null })).toBeNull();
  });
  it("keeps one draft across Settings, Access, and read-only tabs, then saves with the original revision", async () => {
    await render();
    await input(container.querySelector("textarea")!, "Edited instructions");
    await render("access");
    await vi.waitFor(() => expect(container.textContent).toContain("@maya"));
    await click("Run automatically for @maya");
    await render("reviews");
    await render("settings");
    expect(container.querySelector("textarea")?.value).toBe(
      "Edited instructions",
    );
    expect(mocks.save).not.toHaveBeenCalled();
    await click("Save changes");
    await vi.waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
    const [id, revision, saved] = mocks.save.mock.calls[0];
    expect(id).toBe("bot");
    expect(revision).toBe(4);
    expect(saved).toEqual({
      ...base,
      defaults: { ...base.defaults, instructions: "Edited instructions" },
      people: [{ ...base.people[0], automaticReviews: false }],
    });
    await vi.waitFor(() =>
      expect(container.textContent).toContain("Changes saved."),
    );
    expect(
      [...container.querySelectorAll("button")].some(
        (b) => b.textContent === "Save changes",
      ),
    ).toBe(false);
  });
  it("retains a rejected draft and lets the user discard it", async () => {
    mocks.save.mockRejectedValue(
      new Error("Configuration changed. Reload before saving."),
    );
    await render();
    await input(container.querySelector("textarea")!, "Unsaved");
    await click("Save changes");
    await vi.waitFor(() =>
      expect(container.querySelector('[role="alert"]')?.textContent).toContain(
        "Configuration changed",
      ),
    );
    expect(container.querySelector("textarea")?.value).toBe("Unsaved");
    await click("Discard changes");
    expect(container.querySelector("textarea")?.value).toBe(
      base.defaults.instructions,
    );
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });
  it("saves repository restrictions separately without touching the behavior draft", async () => {
    await render();
    await input(container.querySelector("textarea")!, "Unsaved behavior");
    await render("access");
    await click("acme/web");
    await vi.waitFor(() =>
      expect(mocks.updateResources).toHaveBeenCalledWith("bot", [
        { id: "repo", enabled: false },
      ]),
    );
    expect(mocks.save).not.toHaveBeenCalled();
    await render("settings");
    expect(container.querySelector("textarea")?.value).toBe("Unsaved behavior");
  });
  it("creates repository overrides without overwriting defaults or duplicating field IDs", async () => {
    await render();
    await input(
      container.querySelector<HTMLSelectElement>("#github-policy-repository")!,
      "100",
    );
    await click("Use custom settings for this repository");
    const areas = [
      ...container.querySelectorAll<HTMLTextAreaElement>(
        'textarea[placeholder="What should this agent do on GitHub?"]',
      ),
    ];
    expect(areas).toHaveLength(2);
    await input(areas[1], "Repository guidance");
    const ids = [...container.querySelectorAll("[id]")].map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    await click("Save changes");
    await vi.waitFor(() => expect(mocks.save).toHaveBeenCalled());
    const saved = mocks.save.mock.calls[0][2];
    expect(saved.defaults).toEqual(base.defaults);
    expect(saved.repositories["100"].instructions).toBe("Repository guidance");
  });
  it("configures implicit linked-member events without switching to a narrower selected-member list", async () => {
    mocks.config.mockResolvedValue({
      revision: 4,
      configuration: { ...base, memberAccess: "all_linked", people: [] },
    });
    await render("access");
    await vi.waitFor(() =>
      expect(container.textContent).toContain("Configure events"),
    );
    await click("Configure events");
    await click("Save changes");
    await vi.waitFor(() => expect(mocks.save).toHaveBeenCalled());
    expect(mocks.save.mock.calls[0][2].memberAccess).toBe("all_linked");
    expect(mocks.save.mock.calls[0][2].people[0].automaticReviews).toBe(false);
  });
  it("does not show an off switch or silently enable a retained disabled bot", async () => {
    mocks.config.mockResolvedValue({
      revision: 4,
      configuration: { ...base, toolsEnabled: false },
    });
    await render("access");
    expect(
      container.querySelector('[aria-label="Use this bot’s GitHub tools"]'),
    ).toBeNull();
    expect(container.textContent).toContain("cannot start work or respond");
    await render("settings");
    await input(container.querySelector("textarea")!, "Edited instructions");
    await click("Save changes");
    await vi.waitFor(() => expect(mocks.save).toHaveBeenCalled());
    expect(mocks.save.mock.calls[0][2].toolsEnabled).toBe(false);
  });
  it("loads a direct review URL and keeps unknown reviews within the current connection", async () => {
    mocks.reviewId = "review-1";
    mocks.reviews.mockResolvedValue([
      review("review-1", "repo", 1, "2026-10-07T10:00:00Z"),
    ]);
    await render("reviews");
    await vi.waitFor(() =>
      expect(container.textContent).toContain(
        "No assessment has been submitted yet.",
      ),
    );
    expect(
      container.querySelector('a[href="/apps/chat/bot/reviews"]')?.textContent,
    ).toContain("All reviews");
    mocks.reviewId = "foreign";
    await render("reviews");
    await vi.waitFor(() =>
      expect(container.textContent).toContain("not found in this connection"),
    );
    expect(container.textContent).not.toContain(
      "No assessment has been submitted yet.",
    );
  });
  it("keeps saved automatic triggers when changing to mentions-only", async () => {
    const change = vi.fn();
    await act(async () =>
      root.render(
        <TooltipProvider>
          <GitHubPolicyEditor policy={base.defaults} onChange={change} />
        </TooltipProvider>,
      ),
    );
    await input(
      container.querySelector<HTMLSelectElement>(
        'select[id$="github-invocation"]',
      )!,
      "mentions_only",
    );
    expect(change.mock.calls[0][0]).toEqual({
      ...base.defaults,
      invocation: "mentions_only",
    });
  });
});

function review(
  id: string,
  repositoryId: string,
  pullNumber: number,
  createdAt: string,
  updatedAt = createdAt,
) {
  return {
    id,
    repositoryId,
    pullNumber,
    createdAt,
    updatedAt,
    repository: "acme/web",
    headSha: id,
    issueId: "task",
    event: { title: "Review focus handling" },
    state: "queued",
    assessment: null,
    conclusion: null,
  } as GitHubTaskReview;
}
describe("review history and thread labels", () => {
  it("keeps every review in creation order, independent of late updates to an older head", () => {
    const old = review(
      "old",
      "repo",
      1,
      "2026-10-07T10:00:00Z",
      "2026-10-07T14:00:00Z",
    );
    const current = review("current", "repo", 1, "2026-10-07T11:00:00Z");
    const other = review("other", "another-repo", 1, "2026-10-07T12:00:00Z");
    expect(orderedGitHubReviews([old, current, other])).toEqual([
      other,
      current,
      old,
    ]);
  });
  it("does not present a previous passing score as the pending current commit’s result", async () => {
    const old = review("old", "repo", 1, "2026-10-07T10:00:00Z");
    old.state = "completed";
    old.conclusion = "success";
    old.assessment = {
      reviewedCommit: "old",
      score: 5,
      complete: true,
      summary: "Previous result",
      rationale: "Complete",
      findings: [],
      coverage: { reviewedPaths: [], omittedPaths: [], limitations: [] },
    };
    const current = review("current", "repo", 1, "2026-10-07T11:00:00Z");
    const container = document.createElement("div");
    const root = createRoot(container);
    try {
      await act(async () =>
        root.render(
          <GitHubReviewList endpointId="bot" reviews={[old, current]} />,
        ),
      );
      const rows = [...container.querySelectorAll("li")];
      expect(rows).toHaveLength(2);
      expect(rows[0].textContent).toContain("Queued");
      expect(rows[0].textContent).not.toContain("5/5");
      expect(rows[0].querySelector("a")?.getAttribute("href")).toBe(
        "/apps/chat/bot/reviews/current",
      );
      expect(rows[1].textContent).toContain("5/5 · Passed");
      expect(rows[1].querySelector("a")?.getAttribute("href")).toBe(
        "/apps/chat/bot/reviews/old",
      );
      expect(container.querySelector("details")).toBeNull();
    } finally {
      await act(async () => root.unmount());
    }
  });
  it("identifies GitHub thread numbers while preserving labels for other providers and invalid URLs", () => {
    const row = {
      externalLabel: "acme/web",
      externalUrl: "https://github.com/acme/web/issues/42#issuecomment-1",
    } as any;
    expect(conversationDestination(row, "github")).toBe("acme/web #42");
    expect(conversationDestination(row, "slack")).toBe("acme/web");
    expect(
      conversationDestination({ ...row, externalUrl: "invalid" }, "github"),
    ).toBe("acme/web");
  });
});
