import { describe, expect, it } from "vitest";
import { githubAutomaticIssueEvent } from "./chat-github-events.js";

function payload() {
  return {
    action: "opened", repository: { id: 12, full_name: "Test/Repo" },
    sender: { id: 77, login: "sender" },
    issue: { number: 2, title: "Question", body: null, user: { id: 42, login: "author", type: "User" }, labels: [{ name: "triage" }] },
  };
}
describe("GitHub issue event parsing", () => {
  it("preserves author versus sender authority and bounds untrusted content", () => {
    const input = payload();
    expect(githubAutomaticIssueEvent(input, "delivery")).toMatchObject({
      event: "issue_opened", deliveryId: "delivery", repositoryId: "12", repository: "test/repo",
      issueNumber: 2, body: "", author: { id: "42", isBot: false }, sender: { id: "77" }, labels: ["triage"],
    });
    expect(githubAutomaticIssueEvent({ ...input, issue: { ...input.issue, body: "x".repeat(30000) } }, "delivery")!.body).toHaveLength(24000);
  });
  it("rejects pull requests, other actions, malformed repositories and unsafe numeric IDs", () => {
    const input = payload();
    expect(githubAutomaticIssueEvent({ ...input, issue: { ...input.issue, pull_request: {} } }, "delivery")).toBeNull();
    expect(githubAutomaticIssueEvent({ ...input, action: "edited" }, "delivery")).toBeNull();
    expect(githubAutomaticIssueEvent({ ...input, repository: { id: 12, full_name: "test/repo/extra" } }, "delivery")).toBeNull();
    expect(githubAutomaticIssueEvent({ ...input, sender: { id: Number.MAX_SAFE_INTEGER + 1, login: "sender" } }, "delivery")).toBeNull();
    expect(githubAutomaticIssueEvent({ ...input, issue: { ...input.issue, number: 0 } }, "delivery")).toBeNull();
  });
});
