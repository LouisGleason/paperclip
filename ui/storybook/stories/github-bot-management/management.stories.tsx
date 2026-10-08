import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Routes, Route } from "@/lib/router";
import { PluginLauncherProvider } from "@/plugins/launchers";
import { Layout } from "@/components/Layout";
import { ChatEndpointDetail } from "@/pages/apps/chat/ChatEndpointDetail";
import {
  GitHubPolicyEditor,
  GitHubAccessEditor,
} from "@/pages/apps/chat/GitHubBotConfiguration";
import {
  GitHubRepositoryAccess,
  GitHubReviewList,
  GitHubReviewDetail,
} from "@/pages/apps/chat/GitHubBotManagement";
import { ChatConversationList } from "@/pages/apps/chat/ChatConversationList";
import {
  GitHubAppBranding,
  GitHubBotMention,
} from "@/pages/apps/chat/GitHubAppIdentity";
import { resolveAgentAppearance } from "@paperclipai/shared";
import { agentAvatarUrl } from "@/lib/agent-avatar-url";
import {
  endpoint,
  agent,
  configuration,
  resources,
  reviews,
  conversations,
} from "./fixtures";
import { FixtureApi, type FixtureState } from "./fixture-api";

const meta = {
  title: "Connectors/GitHub bot management",
  parameters: {
    layout: "fullscreen",
    initialEntries: [`/PAP/apps/chat/${endpoint.id}/settings`],
    docs: {
      description: {
        component:
          "Production pages and components. Start with **01 Journey / Settings**, then use the actual contextual sidebar to visit Access, Reviews, and Conversations. Try editing instructions, switch tabs, and save or discard the shared draft. **02 States** covers empty, loading, recoverable error, long content, and mobile. **03 Components** isolates the policy editor, people access, repository access, review rows and detail, pending review, and conversations. Provider operations use isolated fixture APIs; these stories are not live GitHub evidence.",
      },
    },
  },
  args: { state: "populated" as FixtureState },
  argTypes: {
    state: {
      control: "select",
      options: ["populated", "empty", "loading", "error", "long"],
    },
  },
  render: ({ state }) => (
    <FixtureApi key={state} state={state}>
      <PluginLauncherProvider>
        <Routes>
          <Route path="/:companyPrefix" element={<Layout />}>
            <Route
              path="apps/chat/:endpointId/reviews/:reviewId"
              element={<ChatEndpointDetail />}
            />
            <Route
              path="apps/chat/:endpointId/:tab"
              element={<ChatEndpointDetail />}
            />
          </Route>
        </Routes>
      </PluginLauncherProvider>
    </FixtureApi>
  ),
} satisfies Meta<{ state: FixtureState }>;
export default meta;
type Story = StoryObj<typeof meta>;
const route = (tab: string) => ({
  initialEntries: [`/PAP/apps/chat/${endpoint.id}/${tab}`],
});
export const SettingsJourney: Story = { name: "01 Journey / Settings" };
export const AccessJourney: Story = {
  name: "01 Journey / Access",
  parameters: route("access"),
};
export const ReviewsJourney: Story = {
  name: "01 Journey / Reviews",
  parameters: route("reviews"),
};
export const ConversationsJourney: Story = {
  name: "01 Journey / Conversations",
  parameters: route("conversations"),
};
export const FirstUse: Story = {
  name: "02 States / No conversations",
  args: { state: "empty" },
  parameters: route("conversations"),
};
export const NoReviews: Story = {
  name: "02 States / No reviews",
  args: { state: "empty" },
  parameters: route("reviews"),
};
export const Loading: Story = {
  name: "02 States / Loading settings",
  args: { state: "loading" },
};
export const Error: Story = {
  name: "02 States / Settings failure",
  args: { state: "error" },
};
export const LongAccess: Story = {
  name: "02 States / Long repository names",
  args: { state: "long" },
  parameters: route("access"),
};
export const Mobile: Story = {
  name: "02 States / Mobile conversations",
  args: { state: "long" },
  parameters: {
    ...route("conversations"),
    viewport: { defaultViewport: "mobile1" },
  },
  globals: { viewport: { value: "mobile1", isRotated: false } },
};
function Policy() {
  const [policy, setPolicy] = useState(configuration.defaults);
  return <GitHubPolicyEditor policy={policy} onChange={setPolicy} />;
}
function People() {
  const [config, setConfig] = useState(configuration);
  return (
    <FixtureApi>
      <GitHubAccessEditor
        endpointId={endpoint.id}
        companyId={endpoint.companyId}
        configuration={config}
        onChange={setConfig}
      />
    </FixtureApi>
  );
}
function Repositories() {
  const [rows, setRows] = useState(resources);
  return (
    <GitHubRepositoryAccess
      resources={rows}
      managementUrl="https://github.com/settings/installations"
      pending={false}
      onRefresh={() => {}}
      onChange={(id, enabled) =>
        setRows(rows.map((r) => (r.id === id ? { ...r, enabled } : r)))
      }
    />
  );
}
const component = (children: React.ReactNode) => (
  <div className="max-w-3xl p-6">{children}</div>
);
export const InstructionsAndBehavior: Story = {
  name: "03 Components / Instructions and behavior",
  render: () => component(<Policy />),
};
export const PeopleAccess: Story = {
  name: "03 Components / People access",
  render: () => component(<People />),
};
export const RepositoryAccess: Story = {
  name: "03 Components / Repository access",
  render: () => component(<Repositories />),
};
export const AppIdentityAndLogo: Story = {
  name: "03 Components / App identity and logo",
  render: () =>
    component(
      <div className="space-y-6">
        <GitHubBotMention endpoint={endpoint} />
        <GitHubAppBranding
          endpoint={endpoint}
          avatarUrl={agentAvatarUrl(
            resolveAgentAppearance(agent.appearance, agent.id),
            512,
            1,
            "rest",
          )}
        />
      </div>,
    ),
};
export const ReviewHistory: Story = {
  name: "03 Components / Review rows",
  render: () =>
    component(<GitHubReviewList endpointId={endpoint.id} reviews={reviews} />),
};
export const PendingReview: Story = {
  name: "03 Components / Pending current commit",
  render: () =>
    component(
      <GitHubReviewList
        endpointId={endpoint.id}
        reviews={[
          {
            ...reviews[0],
            state: "running",
            assessment: null,
            conclusion: null,
          },
          reviews[1],
        ]}
      />,
    ),
};
export const ConversationRows: Story = {
  name: "03 Components / Conversation rows",
  render: () =>
    component(<ChatConversationList rows={conversations} provider="github" />),
};

export const ReviewDetailJourney: Story = {
  name: "01 Journey / Review detail",
  parameters: route(`reviews/${reviews[0].id}`),
};
export const ReviewDetail: Story = {
  name: "03 Components / Review detail",
  render: () =>
    component(
      <GitHubReviewDetail endpointId={endpoint.id} review={reviews[0]} />,
    ),
};
