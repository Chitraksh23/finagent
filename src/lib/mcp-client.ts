import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createFilingsServer, createMarketServer } from "./servers";

export type ToolDef = { name: string; description: string; parameters: Record<string, unknown> };
export type ToolBox = {
  tools: ToolDef[];
  call(name: string, args: Record<string, unknown>): Promise<{ text: string; isError: boolean }>;
  close(): Promise<void>;
};

/**
 * The agent talks to the same MCP servers that /mcp/filings and /mcp/market expose over HTTP,
 * connected in-process so a Vercel function never has to call itself over the network.
 */
export async function connectToolbox(): Promise<ToolBox> {
  const owners = new Map<string, Client>();
  const clients: Client[] = [];
  const tools: ToolDef[] = [];

  for (const server of [createFilingsServer(), createMarketServer()]) {
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "finagent-agent", version: "0.1.0" });
    await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
    const listed = await client.listTools();
    for (const t of listed.tools) {
      owners.set(t.name, client);
      tools.push({ name: t.name, description: t.description ?? "", parameters: t.inputSchema as Record<string, unknown> });
    }
    clients.push(client);
  }

  return {
    tools,
    async call(name, args) {
      const client = owners.get(name);
      if (!client) return { text: `Error: unknown tool ${name}`, isError: true };
      const res = await client.callTool({ name, arguments: args });
      const parts = (res.content ?? []) as { type: string; text?: string }[];
      return { text: parts.filter((p) => p.type === "text").map((p) => p.text ?? "").join("\n"), isError: Boolean(res.isError) };
    },
    async close() {
      await Promise.all(clients.map((c) => c.close()));
    },
  };
}
