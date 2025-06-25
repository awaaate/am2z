# Bull Board Setup for Conversation Explorer

This guide shows how to set up Bull Board for monitoring the conversation explorer queues.

## Installation

First, install the required dependencies:

```bash
bun add express @bull-board/api @bull-board/ui @bull-board/express bullmq ioredis
bun add -D @types/express
```

## Basic Bull Board Setup

Create a new file `src/conversation-explorer/monitor/bull-board-server.ts`:

```typescript
import express from "express";
import { Queue } from "bullmq";
import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { ExpressAdapter } from "@bull-board/express";

const app = express();

// Create queue instance (same config as your distributed runtime)
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
  queues: [new BullMQAdapter(conversationQueue)],
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
```

## Running Bull Board

1. **Start Redis** (required):

   ```bash
   # Using Docker
   docker run -d -p 6379:6379 redis:latest

   # Or using local Redis installation
   redis-server
   ```

2. **Start Bull Board Server**:

   ```bash
   bun run src/conversation-explorer/monitor/bull-board-server.ts
   ```

3. **Run Conversation Explorer** (in another terminal):

   ```bash
   bun run src/conversation-explorer/examples/distributed-demo.ts
   ```

4. **Open Bull Board UI**:
   - Navigate to: http://localhost:3000/admin/queues
   - You'll see real-time queue statistics and job details

## Features Available in Bull Board

### Queue Monitoring

- ✅ **Job Counts**: See waiting, active, completed, failed jobs
- ✅ **Job Details**: View individual job data and logs
- ✅ **Real-time Updates**: Live queue statistics
- ✅ **Job Management**: Retry failed jobs, clean completed jobs

### Job Operations

- 🔄 **Retry Failed Jobs**: Click on failed jobs to retry them
- 🗑️ **Clean Queues**: Remove old completed/failed jobs
- ⏸️ **Pause/Resume**: Control queue processing
- 🔍 **Search Jobs**: Find specific jobs by ID or data

### Performance Insights

- 📊 **Throughput Metrics**: Jobs processed per minute
- ⏱️ **Processing Times**: Average job execution time
- 📈 **Queue Health**: Overall system performance
- 🚨 **Error Patterns**: Common failure reasons

## Advanced Configuration

### Multiple Queues

If you have multiple queues, add them all:

```typescript
const queues = [
  new BullMQAdapter(conversationQueue),
  new BullMQAdapter(new Queue("question-processing")),
  new BullMQAdapter(new Queue("analytics")),
];

createBullBoard({
  queues,
  serverAdapter,
});
```

### Authentication

Add basic authentication:

```typescript
app.use("/admin/queues", (req, res, next) => {
  const auth = { login: "admin", password: "secret" };
  const b64auth = (req.headers.authorization || "").split(" ")[1] || "";
  const [login, password] = Buffer.from(b64auth, "base64")
    .toString()
    .split(":");

  if (login && password && login === auth.login && password === auth.password) {
    return next();
  }

  res.set("WWW-Authenticate", 'Basic realm="401"');
  res.status(401).send("Authentication required.");
});
```

### Custom Styling

Customize the UI appearance:

```typescript
serverAdapter.setBasePath("/admin/queues");
serverAdapter.setStaticPath(
  "/admin/queues/static",
  path.join(__dirname, "static")
);
```

## Integration with Conversation Explorer

The conversation explorer automatically creates these job types:

1. **conversationExplorerChain**: Main orchestration jobs
2. **answerQuestion**: Individual question processing jobs
3. **stageRouter**: Route determination jobs
4. **analytics**: Analytics update jobs

You can monitor all these in Bull Board to understand the system flow.

## Troubleshooting

### Common Issues

1. **Redis Connection Error**:
   - Ensure Redis is running: `redis-cli ping`
   - Check Redis port: default is 6379

2. **No Jobs Appearing**:
   - Verify queue names match between runtime and Bull Board
   - Check Redis connection configuration

3. **Performance Issues**:
   - Monitor job processing times in Bull Board
   - Adjust concurrency settings in distributed runtime
   - Clean old completed jobs regularly

### Useful Commands

```bash
# Check Redis status
redis-cli ping

# View all keys in Redis
redis-cli keys "*"

# Monitor Redis operations
redis-cli monitor

# Clear all queues (use with caution!)
redis-cli flushdb
```

## Production Considerations

1. **Security**: Always add authentication in production
2. **Scaling**: Consider Redis clustering for high load
3. **Monitoring**: Set up alerts for queue backlogs
4. **Cleanup**: Implement automatic job cleanup policies
5. **Logging**: Integrate with your logging infrastructure

## Next Steps

- Explore job retry strategies
- Set up alerts for queue health
- Implement custom job progress tracking
- Add metrics collection for monitoring
