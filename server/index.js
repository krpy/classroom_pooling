import http from "node:http";
import path from "path";
import { fileURLToPath } from "url";
import express from "express";
import { getDb } from "./db.js";
import { createRouter } from "./routes.js";
import { setupWebSocket } from "./websocket.js";
import { getAdminUiPassword } from "./envAdminUi.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, "..");

getDb();

if (getAdminUiPassword()) {
  console.log("[admin] ADMIN_UI_PASSWORD is set — admin API and presenter WS require the gate.");
} else {
  console.log("[admin] ADMIN_UI_PASSWORD is not set — admin API is open (dev-style).");
}

const app = express();
// Admin UI static files must run before the API router: the router applies
// requireAdminUiPassword to all /api traffic and would block GET /admin/ with 401.
const presenterDist = path.join(rootDir, "client-presenter", "dist");
app.use("/admin", express.static(presenterDist, { index: "index.html" }));

app.use(createRouter());

app.get("/", (_req, res) => {
  res.sendFile(path.join(rootDir, "client-student", "index.html"));
});

const server = http.createServer(app);
setupWebSocket(server);

const port = Number(process.env.PORT) || 3000;
server.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
});
