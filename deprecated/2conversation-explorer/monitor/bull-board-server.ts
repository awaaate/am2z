import { Queue } from "bullmq";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { ExpressAdapter } from "@bull-board/express";
import { createBullBoard } from "@bull-board/api";
import express from "express";
import { explorer } from "../../conversation-explorer/demo";

const app = express();

const conversationQueue = new Queue("conversation-explorer", {
  connection: {
    host: "localhost",
    port: 6379,
  },
});

// Setup Bull Board
const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath("/admin/queues");

createBullBoard({
  queues: explorer.getQueues().map((b) => new BullMQAdapter(b)),
  serverAdapter: serverAdapter,
});

// Add Bull Board UI
app.use("/admin/queues", serverAdapter.getRouter());

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({ status: "healthy", timestamp: new Date().toISOString() });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🎛️  Bull Board UI: http://localhost:${PORT}/admin/queues`);
  console.log(`💚 Health Check: http://localhost:${PORT}/health`);
  console.log("\nMake sure Redis is running on localhost:6379");
});
