# QueryForge — Distributed SQL Query Engine

> A production-grade distributed SQL engine that processes million-row CSV datasets across parallel worker nodes. Upload a dataset, write SQL, and QueryForge distributes execution across 3 workers — returning results faster than any single-machine setup.
>
> **Architected after AWS Athena · Google BigQuery · Apache Drill**

---

## Benchmark Results

| Metric | Value |
|--------|-------|
| Dataset size | 2,000,000 rows |
| Single-machine time | 5,958ms |
| Distributed (3 workers) | 3,512ms |
| **Speedup** | **1.70x faster** |
| Throughput | ~570,000 rows/sec |
| Max tested | 5,000,000 rows ✓ |

Query: `SELECT department, COUNT(*), AVG(salary), MAX(salary), MIN(salary), SUM(salary) FROM employees WHERE age > 20 GROUP BY department ORDER BY total DESC`

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                     Frontend  (React + Vite)                         │
│         Upload · SQL Editor · ⚡ Explain · Live Worker Dashboard      │
└─────────────────────────┬───────────────────────────────────────────┘
                          │  REST + WebSocket
┌─────────────────────────▼───────────────────────────────────────────┐
│                    Coordinator  (Node.js)                             │
│                                                                       │
│  SQL Parser → Execution Plan → Job Manager → Result Merger           │
│  ⚡ EXPLAIN endpoint · Fault Monitor · WebSocket broadcaster          │
│  CoordinatorService gRPC server  (workers register here)             │
└──────────┬──────────────────┬───────────────────┬────────────────────┘
           │ gRPC             │ gRPC              │ gRPC
    ┌──────▼──────┐   ┌───────▼──────┐   ┌───────▼──────┐
    │  Worker 1   │   │   Worker 2   │   │   Worker 3   │
    │             │   │              │   │              │
    │ ① Download  │   │ ① Download   │   │ ① Download   │
    │   partition │   │   partition  │   │   partition  │
    │ ② Filter    │   │ ② Filter     │   │ ② Filter     │
    │   (WHERE)   │   │   (WHERE)    │   │   (WHERE)    │
    │ ③ Local     │   │ ③ Local      │   │ ③ Local      │
    │   GROUP BY  │   │   GROUP BY   │   │   GROUP BY   │
    │ ④ Stream    │   │ ④ Stream     │   │ ④ Stream     │
    │   results   │   │   results    │   │   results    │
    └──────┬──────┘   └───────┬──────┘   └───────┬──────┘
           └──────────────────┼───────────────────┘
                              │ All read from
                   ┌──────────▼──────────┐
                   │    MinIO  (S3)       │
                   │  datasets/          │
                   │  partitions/        │
                   └─────────────────────┘
          PostgreSQL ── metadata, jobs, tasks, workers
          Prometheus + Grafana ── metrics, dashboards
```

---

## Key Features

### ① Predicate Pushdown
WHERE filters applied **row-by-row during CSV streaming**, before any rows enter memory. Non-matching rows are discarded immediately — never transferred to coordinator.

```
Worker reads CSV:
  row 1: age=22 → WHERE age > 25 → ✗ discarded (never in memory)
  row 2: age=31 → WHERE age > 25 → ✓ kept
  row 3: age=19 → WHERE age > 25 → ✗ discarded
```

### ② Partial Aggregation (MapReduce-style)
For GROUP BY queries, each worker builds a **local hash map** on its partition. Coordinator receives 3 compact maps and merges them — not millions of raw rows.

```
Worker 1 sends:  { Engineering: { count:180000, sum:14B } }   ← 8 objects
Worker 2 sends:  { Engineering: { count:181000, sum:14.1B } } ← 8 objects  
Worker 3 sends:  { Engineering: { count:180667, sum:14B } }   ← 8 objects

Coordinator merges → final AVG = total_sum / total_count
                    (NOT average of averages — mathematically correct)
```

### ③ Automatic Fault Recovery
Workers send heartbeats every 5 seconds. If a worker misses 3 heartbeats (15s), coordinator marks it dead and reassigns its partition to a healthy worker. Max 3 reassignment attempts per partition.

### ④ EXPLAIN Endpoint (like PostgreSQL's EXPLAIN)
`POST /api/explain` returns the full execution plan before running — shows which predicates are pushed down, partition assignment per worker, aggregation strategy per function.

### ⑤ OpenTelemetry Observability
Every coordinator and worker exposes metrics on `:9464/metrics`. Custom spans on `query.plan`, `job.execute`, `task.execute` with `rows.scanned` vs `rows.passed_filter` attributes.

---

## Quick Start

```bash
git clone https://github.com/princekr969/QueryForge-
cd QueryForge-
docker compose up --build
```

**That's it.** All 9 services start automatically. No manual setup.

| Service | URL |
|---------|-----|
| **Frontend** | http://localhost:5173 |
| **Coordinator API** | http://localhost:3000 |
| **MinIO Console** | http://localhost:9001 (minioadmin / minioadmin) |
| **Prometheus** | http://localhost:9090/targets |
| **Grafana** | http://localhost:3001 (admin / admin) |

---

## SQL Support

```sql
-- Filtered scan with predicate pushdown
SELECT name, salary FROM employees WHERE salary > 60000

-- GROUP BY with multiple aggregations
SELECT department,
       COUNT(*) as total,
       AVG(salary) as avg_sal,
       MAX(salary) as max_sal,
       MIN(salary) as min_sal,
       SUM(salary) as total_sal
FROM employees
WHERE age > 25
GROUP BY department
ORDER BY total DESC

-- COUNT with filter
SELECT COUNT(*) as total FROM employees WHERE city = 'Mumbai'

-- ORDER BY + LIMIT
SELECT name, salary FROM employees ORDER BY salary DESC LIMIT 10
```

Supported aggregations: `COUNT`, `SUM`, `AVG`, `MAX`, `MIN`

---

## Query Execution — 20-Step Flow

```
1.  POST /api/query  { sql, datasetId }
2.  node-sql-parser → AST
3.  Extract: predicates, GROUP BY, aggregations, ORDER BY, LIMIT
4.  Look up dataset + 3 partitions in PostgreSQL
5.  Create Job + 3 Tasks in PostgreSQL
6.  Dispatch 3 gRPC ExecuteTask calls in parallel (Promise.all)
7.  Each worker: getObject(MinIO) → write to /tmp/{taskId}.csv
8.  Each worker: stream CSV row-by-row → apply WHERE predicates
9.  Each worker: build local GROUP BY hash map
10. Each worker: stream AggregationGroup messages → coordinator
11. Coordinator: merge 3 hash maps (SUM totals, MAX of MAXes, COUNT sums)
12. Coordinator: compute final AVG = total_sum / total_count
13. Coordinator: apply ORDER BY on merged result
14. Coordinator: apply LIMIT
15. Coordinator: stream rows via WebSocket → frontend
16. Frontend: render rows as they arrive
17. Coordinator: UPDATE jobs SET status='completed'
18. WebSocket: { type: 'complete', totalRows, executionTimeMs }
19. OTel spans closed with row counts
20. Prometheus metrics updated
```

---

## Fault Recovery Demo

While a query is running:

```bash
docker compose stop worker-2
```

Coordinator detects missing heartbeat → reassigns partition → query completes with 2 workers.

```bash
docker compose start worker-2   # brings it back online
```

---

## Running the Benchmark

```bash
cd benchmarks
npm install
node run_benchmark.js
```

Generates 2M rows → uploads → runs distributed query → runs same query single-machine → prints speedup.

---

## API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/datasets/upload` | Upload CSV, returns `{ datasetId, rowCount, schema }` |
| `GET` | `/api/datasets` | List all datasets |
| `GET` | `/api/datasets/:id` | Dataset + partition details |
| `POST` | `/api/query` | Submit SQL, returns `{ jobId }` immediately |
| `GET` | `/api/query/jobs/:id` | Job status + per-task metrics |
| `POST` | `/api/explain` | Execution plan JSON (no query executed) |
| `GET` | `/api/workers` | Live worker registry with heartbeat status |
| `GET` | `/api/health` | Coordinator health check |

**WebSocket:** `ws://localhost:3000/ws`
```json
// Subscribe
{ "type": "subscribe", "jobId": "..." }

// Receive
{ "type": "row",      "data": { "department": "Engineering", "total": 541667 } }
{ "type": "progress", "completedTasks": 2, "totalTasks": 3 }
{ "type": "complete", "totalRows": 8, "executionTimeMs": 3512 }
{ "type": "error",    "message": "..." }
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Coordinator | Node.js 20, Express 4, gRPC (`@grpc/grpc-js`), WebSocket (`ws`) |
| Workers | Node.js 20, gRPC server-side streaming |
| SQL Parsing | `node-sql-parser` (PostgreSQL dialect) |
| Object Storage | MinIO (S3-compatible) |
| Metadata | PostgreSQL 15 |
| Observability | OpenTelemetry SDK, Prometheus, Grafana |
| Containerisation | Docker Compose (9 services) |
| Frontend | React 18, Vite 5, Tailwind CSS 3 |

---

## Project Structure

```
QueryForge/
├── coordinator/          # Coordinator node
│   ├── src/
│   │   ├── grpc/         # CoordinatorService server + WorkerService client
│   │   ├── routes/       # datasets, query, workers, explain
│   │   ├── services/     # queryPlanner, partitioner, jobManager,
│   │   │                 # resultMerger, faultMonitor
│   │   ├── websocket/    # WebSocket server (ping/pong + job subscriptions)
│   │   └── db/           # PostgreSQL connection pool
│   ├── schema.sql
│   └── tracing.js        # OTel SDK (loaded before index.js via -r flag)
├── worker/               # Worker node
│   ├── src/
│   │   ├── grpc/         # WorkerService server + CoordinatorService client
│   │   └── services/     # taskExecutor, predicateEvaluator,
│   │                     # aggregator, minioClient
│   └── tracing.js
├── frontend/             # React + Tailwind UI
│   └── src/components/   # DatasetUploader, SQLEditor, ExplainPanel,
│                         # WorkerDashboard, ResultsTable
├── proto/
│   └── dataforge.proto  # gRPC service definitions
├── monitoring/
│   ├── prometheus.yml
│   └── provisioning/     # Grafana auto-provisioned datasource + dashboard
├── benchmarks/
│   └── run_benchmark.js  # 2M row benchmark script
└── docker-compose.yml    # 9 services, zero manual setup
```

---

## Architecture Decisions (Interview Q&A)

**Why gRPC between coordinator and workers, not REST?**
gRPC supports server-side streaming natively — workers stream partial results back as they process, without buffering everything first. REST would require workers to finish completely before sending anything, removing the streaming benefit.

**Why MinIO and not shared filesystem?**
Shared filesystem doesn't work across distributed nodes. MinIO gives each worker independent object access — worker-1 reads partition-0, worker-2 reads partition-1, both simultaneously, with no coordination needed.

**Why partial aggregation instead of sending all rows?**
For a GROUP BY query on 2M rows with 8 groups, sending raw rows means 666,667 rows per worker × 3 workers = 2M rows through the coordinator. Partial aggregation sends 8 hash map entries per worker = 24 objects total. The network difference is ~100MB vs ~200 bytes.

**What's the bottleneck right now?**
Coordinator is a single point of failure and also the merge bottleneck. For production I'd shard the merge across multiple coordinator instances, similar to how Presto uses a coordinator cluster.

**How would you scale beyond 3 workers?**
Partition count = worker count. Dynamic partitioning would split the dataset into N chunks at upload time based on registered workers. The current round-robin assignment already handles N workers — changing `partitionCount` from 3 to N is the only required change.

**Why 3 partitions specifically?**
Matched to the 3 workers in this deployment. Coordinator assigns partition[i] to worker[i % workerCount], so adding a 4th worker automatically gets partition-3 if it exists.

---

*Built by [Prince Kumar](https://github.com/princekr969)*
