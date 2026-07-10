import "dotenv/config";
import http from "node:http";
import { startBot } from "./index.js";

// Render richiede che i Web Service aprano una porta HTTP.
// Il bot Discord non ne ha bisogno, ma questo server finto soddisfa il controllo.
const port = process.env["PORT"] || 3000;
http.createServer((_req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("Bot is running");
}).listen(port, () => {
  console.log(`Health check server listening on port ${port}`);
});

startBot();
