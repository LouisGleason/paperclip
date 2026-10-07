import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { agents, companies, createDb } from "@paperclipai/db";
import { eq } from "drizzle-orm";
import { agentService } from "../services/agents.js";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
const support = await getEmbeddedPostgresTestSupport();
(support.supported ? describe : describe.skip)("runner policy at the common creation boundary", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;
  let companyId: string;
  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("runner-creation-");
    db = createDb(database.connectionString);
    companyId = randomUUID();
    await db.insert(companies).values({ id: companyId, name: "Runner creation", issuePrefix: "RUN" });
  }, 60_000);
  afterAll(async () => { await database?.cleanup(); });
  it.each([
    ["codex_local", "codex", undefined, "gpt-5.6-sol"],
    ["claude_local", "acpx", "claude", "claude-sonnet-5"],
    ["opencode_local", "opencode", undefined, "openai/gpt-5.6-sol"],
    ["grok_local", "acpx", "grok", "grok-4.7"],
    ["cursor", "acpx", "cursor", "composer-2.5"],
  ])("resolves internal %s creation before persistence", async (adapterType, provider, acpxAgent, model) => {
    const result = await agentService(db).create(companyId, { name: adapterType!, adapterType: adapterType!, adapterConfig: { model } });
    expect(result).toMatchObject({ adapterType: "paperclip_runner", adapterConfig: { provider, ...(acpxAgent ? { acpxAgent } : {}), model } });
    const [persisted] = await db.select().from(agents).where(eq(agents.id, result.id));
    expect(persisted.adapterType).toBe("paperclip_runner");
  });
  it("preserves explicit legacy and both saved choices on ordinary edits", async () => {
    const service = agentService(db);
    for (const runner of ["legacy", "paperclip"] as const) {
      const created = await service.create(companyId, { name: runner, adapterType: "codex_local", runner });
      const edited = await service.update(created.id, { title: "New title" });
      expect(edited?.adapterType).toBe(created.adapterType);
      expect(edited?.adapterConfig).toEqual(created.adapterConfig);
    }
  });
  it("does not turn legacy-only harnesses into native agents", async () => {
    const created = await agentService(db).create(companyId, { name: "Gemini", adapterType: "gemini_local" });
    expect(created.adapterType).toBe("gemini_local");
  });
  it("rejects incompatible settings before inserting an agent", async () => {
    await expect(agentService(db).create(companyId, { name: "Custom", adapterType: "codex_local", adapterConfig: { command: "/custom/codex" } })).rejects.toThrow("command");
    expect(await db.select().from(agents).where(eq(agents.name, "Custom"))).toHaveLength(0);
  });
});
