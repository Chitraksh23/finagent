import { handleMcp } from "../../../lib/mcp-http";
import { createMarketServer } from "../../../lib/servers";

export const maxDuration = 30;
export const dynamic = "force-dynamic";

const handler = (req: Request) => handleMcp(req, createMarketServer);
export { handler as GET, handler as POST, handler as DELETE };
