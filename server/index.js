import http from "node:http";
import path from "path";
import { fileURLToPath } from "url";
import express from "express";
import { getDb } from "./db.js";
import { createRouter } from "./routes.js";
import { setupWebSocket } from "./websocket.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, "..");

getDb();

const app = express();
app.use(createRouter());

const presenterDist = path.join(rootDir, "client-presenter", "dist");
app.use("/admin", express.static(presenterDist, { index: "index.html" }));

app.get("/", (_req, res) => {
  res.sendFile(path.join(rootDir, "client-student", "index.html"));
});

const server = http.createServer(app);
setupWebSocket(server);

const port = Number(process.env.PORT) || 3000;
server.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
});
