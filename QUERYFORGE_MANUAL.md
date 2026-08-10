# QueryForge — Complete Technical Manual & Deep-Dive Guide

> **Last Updated**: 2026-08-08  
> **Author**: Prince Kumar  
> **Repository**: https://github.com/princekr969/QueryForge-  
> **Purpose**: Distributed SQL Query Engine (inspired by AWS Athena, Google BigQuery, Apache Drill)

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [The Problem & The Solution](#2-the-problem--the-solution)
3. [Architecture Deep Dive](#3-architecture-deep-dive)
4. [Complete Tech Stack](#4-complete-tech-stack)
5. [The Data Pipeline — Step by Step](#5-the-data-pipeline--step-by-step)
6. [Core Services In Detail](#6-core-services-in-detail)
7. [Database Schema Reference](#7-database-schema-reference)
8. [gRPC Protocol Reference](#8-grpc-protocol-reference)
9. [API Reference](#9-api-reference)
10. [System Design Concepts Demonstrated](#10-system-design-concepts-demonstrated)
11. [Interview Q&A Preparation](#11-interview-qa-preparation)
12. [Deployment Guide](#12-deployment-guide)
13. [Testing Guide](#13-testing-guide)
14. [Benchmarking](#14-benchmarking)
15. [What You Can Add (Roadmap)](#15-what-you-can-add-roadmap)
16. [Troubleshooting](#16-troubleshooting)
17. [File-by-File Code Map](#17-file-by-file-code-map)

---

## 1. Project Overview

**QueryForge** is a production-grade distributed SQL query engine designed to process million-row CSV datasets across parallel worker nodes. The core idea is simple: you upload a CSV dataset, write standard SQL queries against it, and the system automatically distributes the execution across multiple worker nodes — returning results faster than any single-machine setup could.

### What Makes It Special

| Feature | Description |
|---------|-------------|
| **Predicate Pushdown** | WHERE filters applied row-by-row during CSV streaming — non-matching rows never enter memory or cross the network |
| **Partial Aggregation** | MapReduce-style: workers build local hash maps for GROUP BY, coordinator merges compact maps instead of millions of raw rows |
| **Fault Recovery** | Automatic detection of dead workers and reassignment of their partitions to healthy workers |
| **Live Streaming** | Results stream to the frontend via WebSocket as workers compute them |
| **EXPLAIN Endpoint** | Like PostgreSQL's EXPLAIN — shows full execution plan before running |
| **Full Observability** | OpenTelemetry traces + Prometheus metrics + Grafana dashboards |
| **Zero-Config Deploy** | Single `docker compose up --build` starts all 9 services |

### Benchmark Results

| Metric | Value |
|--------|-------|
| Dataset size | 2,000,000 rows |
| Single-machine time | 5,958ms |
| Distributed (3 workers) | 3,512ms |
| **Speedup** | **1.70x faster** |
| Throughput | ~570,000 rows/sec |
| Max tested | 5,000,000 rows |

---

## 2. The Problem & The Solution

### 2.1 The Problem

When you have a CSV file with millions of rows and you want to run SQL queries on it, a single machine faces several challenges:

1. **Memory limits** — Loading 2M+ rows into RAM can crash or slow down the process
2. **CPU bottleneck** — One CPU core scanning and aggregating millions of rows is slow
3. **No fault tolerance** — If the process crashes, you restart from scratch
4. **No visibility** — You have no idea what's happening during query execution
5. **Network transfer** — Even with distributed systems, sending all raw rows across the network is wasteful

### 2.2 The Solution

QueryForge solves each problem with a specific design decision:

| Problem | Solution | Implementation |
|---------|----------|----------------|
| Memory limits | Streaming + Predicate Pushdown | Workers stream CSV row-by-row, discard non-matching rows immediately |
| CPU bottleneck | Parallel workers | 3 workers process partitions independently |
| No fault tolerance | Heartbeat + Auto-reassignment | Workers heartbeat every 5s; timed-out tasks reassigned (max 3 attempts) |
| No visibility | EXPLAIN + WebSocket streaming | `/api/explain` shows plan; results stream live to UI |
| Network waste | Partial Aggregation | Workers send hash maps (~24 objects) instead of raw rows (~2M rows) |

---

## 3. Architecture Deep Dive

### 3.1 System Architecture Diagram

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

### 3.2 The 20-Step Query Execution Flow

Here is exactly what happens when you submit a query:

```
Step  1: POST /api/query  { sql, datasetId }
         → Returns { jobId } immediately (HTTP 202 Accepted)
         → Client subscribes to jobId via WebSocket

Step  2: node-sql-parser → AST (Abstract Syntax Tree)
         → Parses SQL into a structured tree

Step  3: Extract: predicates, GROUP BY, aggregations, ORDER BY, LIMIT
         → queryPlanner.js walks the AST

Step  4: Look up dataset + 3 partitions in PostgreSQL
         → SELECT * FROM datasets WHERE id = $datasetId
         → SELECT * FROM partitions WHERE dataset_id = $datasetId

Step  5: Create Job + 3 Tasks in PostgreSQL
         → INSERT INTO jobs (id, sql_query, dataset_id, status) VALUES (...)
         → INSERT INTO tasks (id, job_id, worker_id, partition_id, status) VALUES (...) x3

Step  6: Dispatch 3 gRPC ExecuteTask calls in parallel (Promise.all)
         → executeTaskOnWorker(workerAddress, taskRequest)
         → Uses server-side streaming RPC

Step  7: Each worker: getObject(MinIO) → write to /tmp/{taskId}.csv
         → downloadPartitionToFile() streams from MinIO to local temp file

Step  8: Each worker: stream CSV row-by-row → apply WHERE predicates
         → filterRowsFromFile() creates a read stream + csv-parse pipeline
         → applyPredicates() tests each row against all predicates (AND logic)

Step  9: Each worker: build local GROUP BY hash map
         → localGroupBy() creates: groupKey → { count, sums, groupValues }
         → Composite group key = pipe-delimited column values

Step 10: Each worker: stream AggregationGroup messages → coordinator
         → Workers write PartialResult messages via gRPC stream
         → For non-aggregated queries: batched in 500-row chunks

Step 11: Coordinator: merge 3 hash maps
         → mergeResults() combines partial results:
           - COUNT: sum of all counts
           - SUM: sum of all partial sums
           - AVG: computed as total_sum / total_count (NOT average of averages)
           - MAX: max of all worker MAX values
           - MIN: min of all worker MIN values

Step 12: Coordinator: compute final AVG = total_sum / total_count
         → Mathematically correct across distributed partitions

Step 13: Coordinator: apply ORDER BY on merged result
         → Numeric sort when possible, string sort fallback
         → Direction: ASC or DESC

Step 14: Coordinator: apply LIMIT
         → finalRows.slice(0, plan.limit)

Step 15: Coordinator: stream rows via WebSocket → frontend
         → pushToSubscribers() sends { type: 'row', data: row }
         → Frontend appends to state as rows arrive

Step 16: Frontend: render rows as they arrive
         → React useState updates trigger re-render
         → ResultsTable component displays with zebra striping

Step 17: Coordinator: UPDATE jobs SET status='completed'
         → Persists completion in PostgreSQL

Step 18: WebSocket: { type: 'complete', totalRows, executionTimeMs }
         → Client stops loading state, shows execution time

Step 19: OTel spans closed with row counts
         → trace spans record rows.scanned, rows.passed_filter

Step 20: Prometheus metrics updated
         → dataforge_query_duration_ms histogram recorded
         → dataforge_tasks_total counter updated
```

### 3.3 Data Upload Flow

When you upload a CSV:

```
1. Frontend POST /api/datasets/upload (multipart/form-data)
2. Multer stores file in memory (max 1GB)
3. partitionAndStore() does:
   a. Upload raw CSV to MinIO bucket 'datasets'
   b. Parse CSV into row objects
   c. Infer schema types by sampling first 100 rows
   d. Split rows into N equal partitions (default 3)
   e. Upload each partition to MinIO bucket 'partitions'
   f. Insert dataset + partition records into PostgreSQL
4. Return { datasetId, rowCount, schema, partitionCount }
```

---

## 4. Complete Tech Stack

| Layer | Technology | Version | Purpose |
|-------|-----------|---------|---------|
| **Runtime** | Node.js | 20 | JavaScript runtime for coordinator + workers |
| **Web Framework** | Express | 4.18 | REST API endpoints |
| **RPC Framework** | gRPC (`@grpc/grpc-js`) | 1.14.4 | Inter-service communication |
| **Proto Loader** | `@grpc/proto-loader` | 0.7.15 | Load protobuf definitions |
| **SQL Parser** | `node-sql-parser` | 4.18 | Parse SQL → AST |
| **Database** | PostgreSQL | 15 | Metadata storage |
| **DB Client** | `pg` | 8.11 | PostgreSQL connection pool |
| **Object Storage** | MinIO | latest | S3-compatible storage |
| **MinIO Client** | `minio` | 8.0.7 | Node.js MinIO SDK |
| **CSV Parsing** | `csv-parse` | 5.5.0 | Stream CSV rows |
| **CSV Writing** | `csv-stringify` | 6.4.0 | Convert objects to CSV |
| **Frontend** | React | 18 | UI framework |
| **Build Tool** | Vite | 5.0 | Frontend bundler + dev server |
| **Styling** | Tailwind CSS | 3.4 | Utility-first CSS |
| **HTTP Client** | Axios | 1.6.0 | Frontend API calls |
| **WebSocket** | `ws` | 8.14.0 | Real-time data streaming |
| **File Upload** | `multer` | 2.0.0 | Multipart form handling |
| **UUID** | `uuid` | 9.0.0 | Generate unique IDs |
| **CORS** | `cors` | 2.8.5 | Cross-origin requests |
| **Environment** | `dotenv` | 16.0.0 | Environment variable loading |
| **Observability** | OpenTelemetry SDK | 0.219.0 | Traces + metrics |
| **Metrics Export** | `@opentelemetry/exporter-prometheus` | 0.219.0 | Prometheus metrics endpoint |
| **Auto-Instrumentation** | `@opentelemetry/auto-instrumentations-node` | 0.57.0 | Automatic Node.js instrumentation |
| **Metrics** | Prometheus | latest | Metrics collection |
| **Dashboards** | Grafana | latest | Visualization |
| **Containerization** | Docker Compose | — | Multi-service orchestration |

---

## 5. The Data Pipeline — Step by Step

### 5.1 Component Interaction Flow

```
┌──────────┐     ┌─────────────┐     ┌──────────────┐
│  User    │────→│  Frontend   │────→│ Coordinator  │
│          │     │  (React)    │     │  (Express)   │
└──────────┘     └─────────────┘     └──────┬───────┘
       ↑                                    │
       │    WebSocket: row, complete        │ gRPC: ExecuteTask
       └────────────────────────────────────┤
                                            │
       ┌────────────────────────────────────┘
       │
┌──────▼────────┐  ┌──────────────┐  ┌──────────────┐
│   Worker 1    │  │   Worker 2   │  │   Worker 3   │
│  (gRPC server)│  │ (gRPC server)│  │ (gRPC server)│
└──────┬────────┘  └──────┬───────┘  └──────┬───────┘
       │                  │                 │
       └──────────────────┼─────────────────┘
                          │
                   ┌──────▼───────┐
                   │    MinIO     │
                   │  (S3-like)   │
                   └──────────────┘
```

### 5.2 Message Flow for a Typical Query

**SQL**: `SELECT department, COUNT(*) as total, AVG(salary) as avg_sal FROM employees WHERE age > 25 GROUP BY department ORDER BY total DESC`

```
[User] ──POST /api/query──→ [Coordinator]
                              → Returns: { jobId: "uuid-123" }

[User] ──WebSocket connect──→ [Coordinator /ws]
[User] ──{ subscribe: jobId }──→ [Coordinator]

[Coordinator] ──gRPC ExecuteTask──→ [Worker 1]  partition-0.csv
[Coordinator] ──gRPC ExecuteTask──→ [Worker 2]  partition-1.csv
[Coordinator] ──gRPC ExecuteTask──→ [Worker 3]  partition-2.csv

[Worker 1] → Download partition-0.csv from MinIO
[Worker 1] → Stream rows: apply WHERE age > 25
[Worker 1] → Build hash map: { "Engineering" → { count: 180000, sums: { salary: 14000000000 } } }
[Worker 1] → Stream AggregationGroup messages → Coordinator

[Worker 2] → Same process on partition-1.csv
[Worker 2] → { "Engineering" → { count: 181000, sums: { salary: 14100000000 } } }

[Worker 3] → Same process on partition-2.csv
[Worker 3] → { "Engineering" → { count: 180667, sums: { salary: 14000000000 } } }

[Coordinator] → Merge all groups:
                Engineering: count = 541667, sum = 42100000000
                → avg = 42100000000 / 541667 = ~77,724

[Coordinator] → Apply ORDER BY total DESC

[Coordinator] ──WebSocket──→ [Frontend] { type: "row", data: { department: "Engineering", total: 541667, avg_sal: 77724 } }
[Coordinator] ──WebSocket──→ [Frontend] { type: "row", data: { department: "Sales", ... } }
...
[Coordinator] ──WebSocket──→ [Frontend] { type: "complete", totalRows: 8, executionTimeMs: 3512 }
```

---

## 6. Core Services In Detail

### 6.1 Coordinator Services

#### 6.1.1 Query Planner (`coordinator/src/services/queryPlanner.js`)

**Purpose**: Parse SQL and generate a structured execution plan.

**How it works**:
1. Uses `node-sql-parser` to parse SQL into an AST with PostgreSQL dialect
2. Recursively walks the WHERE AST node to extract flat predicate lists
3. Supports AND-joined conditions only (per spec)
4. Extracts aggregation functions from SELECT columns
5. Extracts plain column names (non-aggregate)
6. Extracts GROUP BY, ORDER BY, and LIMIT clauses

**Output structure**:
```js
{
  tableName: "employees",
  selectColumns: ["department"],
  predicates: [
    { column: "age", operator: ">", value: "25", type: "number" }
  ],
  groupByColumns: ["department"],
  aggregations: [
    { function: "COUNT", column: "*", alias: "total" },
    { function: "AVG", column: "salary", alias: "avg_sal" }
  ],
  orderByColumn: "total",
  orderByDirection: "DESC",
  limit: 0
}
```

**Key code**:
```js
// Extract predicates recursively (supports AND)
function extractPredicates(whereNode) {
  if (whereNode.type === 'binary_expr' && whereNode.operator === 'AND') {
    return [...extractPredicates(whereNode.left), ...extractPredicates(whereNode.right)]
  }
  // ... extract comparison
}
```

**OpenTelemetry**: Creates a `query.plan` span with SQL text and extracted attributes.

---

#### 6.1.2 Partitioner (`coordinator/src/services/partitioner.js`)

**Purpose**: Read uploaded CSV, split into N equal partitions, upload to MinIO, persist metadata.

**Algorithm**:
1. Upload raw CSV to MinIO `datasets` bucket
2. Parse entire CSV into row objects using `csv-parse`
3. Infer schema by sampling first 100 rows per column:
   - Column is `number` ONLY if ALL sampled non-empty values are valid numbers
   - Otherwise `string`
4. Split rows into N equal chunks: `chunkSize = Math.ceil(rows.length / partitionCount)`
5. Upload each partition to MinIO `partitions` bucket
6. Insert dataset + partition records into PostgreSQL (transaction)

**Schema inference**:
```js
function inferType(rows, columnName) {
  const sampleSize = Math.min(rows.length, 100)
  for (let i = 0; i < sampleSize; i++) {
    const val = rows[i][columnName]
    if (val === null || val === undefined || val === '') continue
    if (isNaN(parseFloat(val)) || !isFinite(val)) return 'string'
  }
  return 'number'
}
```

**Transaction safety**: Uses `BEGIN ... COMMIT/ROLLBACK` to ensure dataset and partitions are atomic.

---

#### 6.1.3 Job Manager (`coordinator/src/services/jobManager.js`)

**Purpose**: Orchestrate the full distributed query lifecycle.

**Key responsibilities**:
- Parse SQL → execution plan
- Look up dataset + partitions
- Create job + task records
- Assign tasks to workers (round-robin)
- Dispatch tasks in parallel via gRPC
- Merge partial results
- Stream results to WebSocket subscribers
- Update job status and metrics

**Task assignment** (round-robin):
```js
for (let i = 0; i < partitions.length; i++) {
  const worker    = activeWorkers[i % activeWorkers.length]
  const partition = partitions[i]
  const taskId    = uuidv4()
  // Create task record, then dispatch
}
```

**Parallel dispatch**:
```js
const taskPromises = taskAssignments.map(async ({ taskId, worker, partition }) => {
  const partialResults = await executeTaskOnWorker(workerAddress(worker), taskRequest)
  // Update task status, collect results
})
const taskResults = await Promise.all(taskPromises)
```

**OpenTelemetry metrics created**:
- `dataforge_query_duration_ms` — histogram of query execution time
- `dataforge_tasks_total` — counter of tasks by status
- `dataforge_active_workers` — observable gauge of active workers

---

#### 6.1.4 Result Merger (`coordinator/src/services/resultMerger.js`)

**Purpose**: Merge partial results from all workers into a final result set.

**Two paths**:

**Path A: Plain rows** (no GROUP BY)
- Concatenate all rows from all workers
- Apply ORDER BY if present
- Apply LIMIT if present

**Path B: Aggregated** (GROUP BY present)
- Build a global hash map keyed by `group_key`
- Merge counts: `finalCount += partialCount`
- Merge sums: `finalSum += partialSum`
- Merge MAX: `finalMax = max(finalMax, partialMax)`
- Merge MIN: `finalMin = min(finalMin, partialMin)`
- Compute AVG: `finalAvg = totalSum / totalCount`

**Critical: AVG correctness**:
```js
// Workers send local SUM + COUNT (NOT local AVG)
// Coordinator computes: final_avg = total_sum / total_count
// This is mathematically correct — NOT "average of averages"
```

**MAX/MIN storage trick**: Since the proto only has a `sums` map, MAX and MIN values are stored with special keys:
- `__max__salary` for MAX(salary)
- `__min__salary` for MIN(salary)

---

#### 6.1.5 Fault Monitor (`coordinator/src/services/faultMonitor.js`)

**Purpose**: Detect timed-out tasks and reassign them to healthy workers.

**Algorithm**:
1. Every 5 seconds, query for tasks in `running` status that started more than 30 seconds ago
2. For each timed-out task:
   a. Check how many times this partition has been reassigned (max 3)
   b. If >= 3, mark job as failed
   c. Find a healthy worker (different from the failed one)
   d. Mark old task as `reassigned`
   e. Create new task on new worker
   f. Re-parse original SQL to reconstruct TaskRequest
   g. Fire-and-forget execution on new worker
3. Notify WebSocket subscribers of reassignment

**Key parameters**:
- `TASK_TIMEOUT_MS = 30_000` (30 seconds)
- `CHECK_INTERVAL_MS = 5_000` (check every 5 seconds)
- `MAX_REASSIGNMENT_ATTEMPTS = 3`

---

#### 6.1.6 WebSocket Server (`coordinator/src/websocket/wsServer.js`)

**Purpose**: Real-time streaming of query results to the frontend.

**Features**:
- **Subscribe model**: Clients send `{ type: 'subscribe', jobId }` to receive updates for a specific job
- **Ping/pong keepalive**: Terminates stale connections every 30s
- **Late subscriber handling**: If a job already completed, sends `complete` immediately to new subscribers
- **Cleanup**: Removes closed connections from subscriber sets

**Message types sent to clients**:
| Type | Description |
|------|-------------|
| `subscribed` | Acknowledge subscription |
| `row` | A single result row |
| `progress` | Task completion progress |
| `complete` | Query finished successfully |
| `error` | Query failed |
| `reassignment` | A task was reassigned to another worker |

---

### 6.2 Worker Services

#### 6.2.1 Task Executor (`worker/src/services/taskExecutor.js`)

**Purpose**: The core worker logic — download partition, filter rows, aggregate, stream results.

**Algorithm**:
1. Download partition CSV from MinIO to `/tmp/{taskId}.csv`
2. Create a read stream + csv-parse pipeline
3. For each row: apply predicates (pushdown)
4. If GROUP BY: build local hash map
5. Stream results back via callback
6. Clean up temp file (always, even on error)

**Batching for plain rows**:
```js
const BATCH_SIZE = 500
// Stream rows in 500-row chunks to avoid memory issues
```

**OpenTelemetry**: Creates `task.execute` span with `rows.scanned` and `rows.passed_filter` attributes.

---

#### 6.2.2 Predicate Evaluator (`worker/src/services/predicateEvaluator.js`)

**Purpose**: Apply WHERE clause predicates to a single CSV row.

**Critical design decision**: All CSV values arrive as **strings**. Numeric comparison requires explicit casting:
```js
// WRONG: row['salary'] > 50000  // string comparison
// CORRECT: parseFloat(row['salary']) > 50000  // numeric comparison
```

**Supported operators**:
- Numeric: `>`, `<`, `=`, `>=`, `<=`, `!=`, `<>`
- String: `=`, `!=`, `<>`, `>`, `<`, `>=`, `<=`

**Logic**: All predicates must pass (AND logic). Empty predicate array = pass all rows.

---

#### 6.2.3 Aggregator (`worker/src/services/aggregator.js`)

**Purpose**: Local GROUP BY partial aggregation on a worker.

**Algorithm**:
1. Create empty hash map: `groupKey → aggState`
2. For each filtered row:
   a. Build composite group key: `groupByColumns.map(col => row[col]).join('|')`
   b. If key doesn't exist, create new state with group values
   c. Update state: increment count, update sums, track max/min
3. Convert hash map to array of `AggregationGroup` proto messages

**State structure**:
```js
{
  count: 0,           // for COUNT(*)
  sums: {},           // { "salary": 140000000 } for SUM/AVG
                       // { "__max__salary": 150000 } for MAX
                       // { "__min__salary": 30000 } for MIN
  groupValues: {}     // { "department": "Engineering" }
}
```

---

#### 6.2.4 MinIO Client (`worker/src/services/minioClient.js`)

**Purpose**: Download partition CSVs from MinIO to local temp files.

**Design rationale**: Using a temp file avoids backpressure issues when piping a MinIO stream directly into csv-parse. The file acts as a buffer.

**Cleanup**: `cleanupTempFile()` is called in the `finally` block of `executeTask` — guaranteed to run even on errors.

---

#### 6.2.5 Heartbeat (`worker/src/heartbeat.js`)

**Purpose**: Send periodic heartbeats to the coordinator to signal liveness.

**Parameters**:
- `HEARTBEAT_INTERVAL_MS = 5_000` (every 5 seconds)
- Includes `active_tasks` count in heartbeat

---

### 6.3 Frontend Components

#### 6.3.1 App (`frontend/src/App.jsx`)

The main application component that orchestrates:
- Dataset fetching on mount
- Query submission via `useQuery` hook
- WebSocket message handling via `useWebSocket` hook
- State management for rows, columns, progress, completion

#### 6.3.2 SQL Editor (`frontend/src/components/SQLEditor.jsx`)

Features:
- Textarea for SQL input
- Dataset selector dropdown
- Example query buttons (pre-populates common queries)
- Explain panel integration (shows execution plan before running)
- Run Query button with loading state

#### 6.3.3 Results Table (`frontend/src/components/ResultsTable.jsx`)

Features:
- Dynamic column headers from result data
- Zebra-striped rows
- Null value display
- Numeric formatting (locale + 2 decimal places)
- **Export to CSV** button

#### 6.3.4 Worker Dashboard (`frontend/src/components/WorkerDashboard.jsx`)

Features:
- Polls `/api/workers` every 3 seconds
- Shows worker status cards with color coding:
  - `idle` → gray
  - `processing` → yellow, pulsing
  - `done` → green
  - `dead` → red
- Progress bar for task completion
- Shows active task count per worker

#### 6.3.5 Explain Panel (`frontend/src/components/ExplainPanel.jsx`)

Features:
- Fetches execution plan from `/api/explain`
- Shows:
  - Dataset info (name, rows, partition count)
  - Operation type (DISTRIBUTED_AGGREGATE or DISTRIBUTED_SCAN)
  - Predicate pushdown details
  - Aggregation strategy per function
  - ORDER BY and LIMIT application points
  - Partition assignment per worker

---

## 7. Database Schema Reference

### 7.1 Tables

#### `datasets`
| Column | Type | Description |
|--------|------|-------------|
| id | UUID PK | Unique dataset identifier |
| name | VARCHAR(255) | Display name (filename without extension) |
| original_filename | VARCHAR(255) | Original uploaded filename |
| minio_path | VARCHAR(500) | Path in MinIO datasets bucket |
| schema_json | JSONB | `{ columns: [{ name, type }] }` |
| row_count | INTEGER | Total rows in dataset |
| partition_count | INTEGER DEFAULT 3 | Number of partitions |
| created_at | TIMESTAMP | Upload timestamp |

#### `partitions`
| Column | Type | Description |
|--------|------|-------------|
| id | UUID PK | Unique partition identifier |
| dataset_id | UUID FK → datasets | Parent dataset |
| partition_index | INTEGER | 0-based index (0, 1, 2, ...) |
| minio_path | VARCHAR(500) | Path in MinIO partitions bucket |
| row_count | INTEGER | Rows in this partition |
| created_at | TIMESTAMP | Creation timestamp |

#### `workers`
| Column | Type | Description |
|--------|------|-------------|
| id | VARCHAR(100) PK | Worker identifier (e.g., "worker-1") |
| address | VARCHAR(255) | Hostname or IP |
| port | INTEGER | gRPC port |
| status | VARCHAR(50) DEFAULT 'active' | active or dead |
| last_heartbeat | TIMESTAMP | Last heartbeat received |
| registered_at | TIMESTAMP | Registration timestamp |

#### `jobs`
| Column | Type | Description |
|--------|------|-------------|
| id | UUID PK | Unique job identifier |
| sql_query | TEXT | The SQL query string |
| dataset_id | UUID FK → datasets | Target dataset |
| status | VARCHAR(50) DEFAULT 'pending' | pending / running / completed / failed |
| result_row_count | INTEGER | Final result row count |
| execution_time_ms | INTEGER | End-to-end execution time |
| created_at | TIMESTAMP | Job creation time |
| completed_at | TIMESTAMP | Job completion time |

#### `tasks`
| Column | Type | Description |
|--------|------|-------------|
| id | UUID PK | Unique task identifier |
| job_id | UUID FK → jobs | Parent job |
| worker_id | VARCHAR(100) FK → workers | Assigned worker |
| partition_id | UUID FK → partitions | Target partition |
| status | VARCHAR(50) DEFAULT 'pending' | pending / running / completed / failed / reassigned |
| started_at | TIMESTAMP | Task start time |
| completed_at | TIMESTAMP | Task completion time |
| rows_processed | INTEGER | Rows returned by this task |
| error_message | TEXT | Error details if failed |

### 7.2 Indexes

```sql
CREATE INDEX idx_partitions_dataset_id ON partitions(dataset_id)
CREATE INDEX idx_tasks_job_id           ON tasks(job_id)
CREATE INDEX idx_tasks_status           ON tasks(status)
CREATE INDEX idx_jobs_status            ON jobs(status)
```

---

## 8. gRPC Protocol Reference

### 8.1 Proto File: `proto/dataforge.proto`

#### WorkerService (Coordinator → Worker)

```protobuf
service WorkerService {
  rpc ExecuteTask(TaskRequest) returns (stream PartialResult);
  rpc Ping(PingRequest) returns (PingResponse);
}
```

#### CoordinatorService (Worker → Coordinator)

```protobuf
service CoordinatorService {
  rpc Register(WorkerInfo) returns (RegisterResponse);
  rpc Heartbeat(HeartbeatRequest) returns (HeartbeatResponse);
}
```

### 8.2 Messages

#### TaskRequest
```protobuf
message TaskRequest {
  string task_id           = 1;
  string job_id            = 2;
  string partition_path    = 3;  // MinIO object key
  repeated Predicate       predicates       = 4;
  repeated string          select_columns   = 5;
  repeated string          group_by_columns = 6;
  repeated AggregationFunc aggregations     = 7;
  string order_by_column    = 8;
  string order_by_direction = 9;  // "ASC" | "DESC"
  int32  limit              = 10; // 0 = no limit
}
```

#### PartialResult (streamed from worker)
```protobuf
message PartialResult {
  string task_id       = 1;
  bool   is_aggregated = 2;
  repeated string column_names = 3;
  repeated Row    rows         = 4;
  repeated AggregationGroup groups = 5;
  bool is_complete = 6;
}
```

#### AggregationGroup
```protobuf
message AggregationGroup {
  string group_key = 1;  // pipe-delimited composite key
  int64  count     = 2;
  map<string, double> sums         = 3;  // partial sums + __max__/__min__
  map<string, string> group_values = 4;  // group-by column values
}
```

---

## 9. API Reference

### 9.1 REST Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/datasets/upload` | Upload CSV, returns `{ datasetId, rowCount, schema }` |
| `GET`  | `/api/datasets` | List all datasets |
| `GET`  | `/api/datasets/:id` | Dataset + partition details |
| `POST` | `/api/query` | Submit SQL, returns `{ jobId }` immediately |
| `GET`  | `/api/query/jobs/:id` | Job status + per-task metrics |
| `POST` | `/api/explain` | Execution plan JSON (no query executed) |
| `GET`  | `/api/workers` | Live worker registry with heartbeat status |
| `GET`  | `/api/workers/discover` | Active workers for service discovery |
| `POST` | `/api/workers/register` | REST-based worker registration |
| `GET`  | `/api/health` | Coordinator health check |

### 9.2 WebSocket Protocol

**Connection**: `ws://localhost:3000/ws`

**Client → Server**:
```json
{ "type": "subscribe", "jobId": "uuid-here" }
```

**Server → Client**:
```json
// Row result
{ "type": "row", "data": { "department": "Engineering", "total": 541667 } }

// Progress update
{ "type": "progress", "completedTasks": 2, "totalTasks": 3 }

// Query complete
{ "type": "complete", "totalRows": 8, "executionTimeMs": 3512 }

// Error
{ "type": "error", "message": "..." }

// Task reassigned (fault recovery)
{ "type": "reassignment", "oldTaskId": "...", "newTaskId": "...", "newWorkerId": "worker-2" }
```

---

## 10. System Design Concepts Demonstrated

This project is a textbook example of several distributed systems patterns:

### 10.1 MapReduce Paradigm
- **Map**: Workers independently filter and locally aggregate their partition
- **Reduce**: Coordinator merges partial results into final output
- The entire pipeline follows the classic MapReduce model

### 10.2 Predicate Pushdown
- WHERE clauses are pushed to the worker level
- Only matching rows are processed and transferred
- This is a fundamental optimization in query engines like Presto, Spark SQL, and BigQuery

### 10.3 Partial Aggregation (Combiner Pattern)
- Workers perform local aggregation before sending results
- Dramatically reduces network traffic: ~2M rows → ~24 objects
- This is exactly how Hadoop Combiners and Spark partial aggregations work

### 10.4 Service Discovery
- Workers self-register with the coordinator on startup
- Coordinator maintains an in-memory registry + persists to PostgreSQL
- Dynamic worker discovery without hardcoded lists

### 10.5 Heartbeat-Based Failure Detection
- Workers send heartbeats every 5 seconds
- Coordinator uses a timeout (15 seconds = 3 missed heartbeats) to detect failures
- This is the standard approach in distributed systems (used by Hadoop, Cassandra, etcd)

### 10.6 Fault Tolerance & Task Reassignment
- `faultMonitor.js` implements a supervisor pattern
- Timed-out tasks are reassigned to healthy workers
- Maximum 3 reassignment attempts prevents infinite loops

### 10.7 Query Planning & EXPLAIN
- SQL parsing → AST → execution plan
- EXPLAIN endpoint returns the plan without executing
- Mirrors PostgreSQL EXPLAIN and Spark SQL's `df.explain()`

### 10.8 Observability (Three Pillars)
- **Metrics**: Prometheus histograms and counters
- **Traces**: OpenTelemetry spans for query planning, job execution, task execution
- **Logs**: Structured console logging throughout

### 10.9 Backpressure Handling
- Plain SELECT results are batched in 500-row chunks
- Prevents memory overflow on the coordinator
- Workers use streaming gRPC to avoid buffering

### 10.10 Graceful Shutdown
- SIGTERM/SIGINT handlers close all resources in order:
  1. Clear intervals (fault monitor, heartbeat checks)
  2. Close HTTP server (drain existing connections)
  3. Close gRPC server (tryShutdown)
  4. Close database pool

### 10.11 Connection Pooling
- PostgreSQL connection pool with max 20 connections
- Prevents connection exhaustion under load
- 30-second idle timeout, 2-second connection timeout

---

## 11. Interview Q&A Preparation

### Q1: "Why gRPC instead of REST between coordinator and workers?"

> gRPC supports server-side streaming natively — workers stream partial results back as they process, without buffering everything first. Our proto defines `rpc ExecuteTask(TaskRequest) returns (stream PartialResult);` which lets the coordinator start receiving results immediately. REST would require workers to finish completely before sending anything. gRPC also uses Protocol Buffers for efficient binary serialization, and the stub cache with `grpc.wait_for_ready` handles transient connection issues gracefully.

### Q2: "How do you handle a worker dying mid-query?"

> Two independent mechanisms:
> 1. **Heartbeat detection**: Workers heartbeat every 5s via gRPC. The coordinator's `heartbeatCheckInterval` marks a worker dead after 15s of silence (3 missed heartbeats).
> 2. **Task timeout monitor**: `faultMonitor.js` scans running tasks every 5s. If a task exceeds 30s without completing, it checks reassignment history (max 3 attempts) and reassigns the partition to a healthy worker. The original SQL is re-parsed to reconstruct the TaskRequest. The job continues with the remaining workers, and the frontend receives a `reassignment` WebSocket event.

### Q3: "How do you compute AVG correctly across distributed workers?"

> Workers never send local AVG. Instead, each worker computes and sends local **SUM + COUNT** for each group. The coordinator merges all partial sums and counts, then computes `final_avg = total_sum / total_count`. This is mathematically correct. Computing "average of averages" would be wrong because it doesn't account for different partition sizes. The same principle applies to MAX and MIN — workers send local extrema, and the coordinator takes the global max/min.

### Q4: "What's the bottleneck in this architecture?"

> The **coordinator is a single point of failure** and also the merge bottleneck. All partial results must come back to one node for merging, and if it fails, the entire query fails. For production I'd introduce:
> 1. Coordinator clustering with leader election (using etcd or ZooKeeper)
> 2. Sharded merge — multiple merge nodes each handling a subset of group keys
> 3. A distributed reduce phase using consistent hashing on group keys
> This mirrors how Presto uses a coordinator cluster and how Spark uses multiple reducer tasks.

### Q5: "How would you scale beyond 3 workers?"

> The system is already designed for N workers. The round-robin assignment in `jobManager.js:116` (`worker = activeWorkers[i % activeWorkers.length]`) handles any number of workers. At upload time, I'd change `partitionCount` from 3 to N, splitting the dataset into N chunks. The coordinator already uses dynamic service discovery (`/api/workers/discover`), so adding a worker is just starting a new container — it registers itself automatically. The real consideration is the merge bottleneck on the coordinator, which would need addressing beyond ~10 workers.

### Q6: "Why MinIO and not a shared filesystem?"

> Three reasons:
> 1. **Shared filesystems don't scale across distributed nodes** — NFS has performance and consistency issues
> 2. **MinIO is S3-compatible** — it mirrors cloud object storage patterns, making cloud migration trivial
> 3. **Independent access** — Each worker reads its partition independently with no coordination needed. With a shared filesystem, you'd need locking or coordination mechanisms. MinIO also provides built-in replication, erasure coding, and horizontal scaling.

### Q7: "Explain predicate pushdown in your system."

> When the SQL parser extracts WHERE conditions via `extractPredicates()`, we send them to workers in the `TaskRequest.predicates` field. The worker's `taskExecutor` applies `applyPredicates()` row-by-row during CSV streaming via a Node.js read stream + csv-parse pipeline. Non-matching rows are discarded before entering memory or being transferred across the network. For a query like `WHERE age > 25`, if 70% of rows don't match, we save 70% of memory and network bandwidth. This is exactly what databases like PostgreSQL and query engines like Spark do at the execution layer.

### Q8: "How does the frontend receive results?"

> The frontend uses a WebSocket connection to `ws://localhost:3000/ws`. After submitting a query via `POST /api/query` (which returns `jobId` immediately with HTTP 202), the client sends `{ type: 'subscribe', jobId }` over WebSocket. The coordinator's `wsServer.js` maintains a `Map<jobId, Set<WebSocket>>` of subscribers. As the `jobManager` merges results, it calls `pushToSubscribers()` which sends `{ type: 'row', data: {...} }` messages. The frontend's `useWebSocket` hook receives these and appends them to React state, causing re-render. Finally, `{ type: 'complete' }` signals the end.

### Q9: "What happens if a task times out but the worker is still alive?"

> The `faultMonitor.js` doesn't distinguish between "worker died" and "task is slow" — it uses a timeout-based approach. If a task exceeds 30 seconds, it's considered failed regardless of worker status. The task is then reassigned to another worker. This is a conservative approach that prioritizes query completion over waiting. The max 3 attempts prevents infinite loops from consistently slow partitions.

### Q10: "How do you prevent SQL injection?"

> Currently, the system has a basic safeguard: the query route checks that the SQL starts with `SELECT` and rejects anything else (`INSERT`, `UPDATE`, `DELETE`, `DROP`). However, for production readiness, I'd add:
> 1. Parameterized queries with placeholder substitution
> 2. A whitelist of allowed table names (only registered datasets)
> 3. Rate limiting on the query endpoint
> 4. Input validation on all user-provided fields
> The `node-sql-parser` library also provides some protection by only parsing valid SQL syntax.

---

## 12. Deployment Guide

### 12.1 Prerequisites

- Docker Desktop or Docker Engine
- Docker Compose (included with Docker Desktop)
- Git

### 12.2 Quick Start

```bash
# Clone the repository
git clone https://github.com/princekr969/QueryForge-
cd QueryForge-

# Start all services
docker compose up --build

# Or run in detached mode
docker compose up --build -d
```

### 12.3 Access Points

| Service | URL | Credentials |
|---------|-----|-------------|
| Frontend | http://localhost:5173 | — |
| Coordinator API | http://localhost:3000 | — |
| MinIO Console | http://localhost:9001 | minioadmin / minioadmin |
| Prometheus | http://localhost:9090 | — |
| Grafana | http://localhost:3001 | admin / admin |

### 12.4 Docker Services

The `docker-compose.yml` defines 9 services:

1. **postgres** — PostgreSQL 15 with persistent volume + schema auto-initialization
2. **minio** — S3-compatible object storage with persistent volume
3. **coordinator** — Main orchestrator (REST 3000, gRPC 50050, metrics 9464)
4. **worker-1** — Worker node (gRPC 50051, metrics 9464)
5. **worker-2** — Worker node (gRPC 50051, metrics 9464)
6. **worker-3** — Worker node (gRPC 50051, metrics 9464)
7. **frontend** — React dev server (5173)
8. **prometheus** — Metrics scraper (9090)
9. **grafana** — Dashboards (3001)

### 12.5 Health Checks

- PostgreSQL: `pg_isready` every 5s
- MinIO: `curl` health endpoint every 5s
- Coordinator waits for both to be healthy before starting

### 12.6 Stopping

```bash
# Graceful stop
docker compose down

# Stop and remove volumes (clears all data)
docker compose down -v
```

### 12.7 Fault Recovery Demo

```bash
# While a query is running, kill a worker
docker compose stop worker-2

# Coordinator detects missing heartbeat → reassigns partition
# Query completes with 2 workers

# Bring worker back online
docker compose start worker-2
```

---

## 13. Testing Guide

### 13.1 Unit Tests

Tests use Node.js's built-in test runner (`node --test`):

```bash
# Test partition splitting logic
node --test tests/partitioner.test.js

# Test predicate evaluation
node --test tests/predicateEvaluator.test.js

# Test result merging (MapReduce)
node --test tests/resultMerger.test.js
```

### 13.2 Test Coverage

| Test File | Coverage |
|-----------|----------|
| `partitioner.test.js` | Row splitting (equal, uneven, edge cases), schema type inference (number, string, mixed, empty, float) |
| `predicateEvaluator.test.js` | Numeric predicates (all operators), string predicates, multiple predicates (AND logic), edge cases (empty, missing column) |
| `resultMerger.test.js` | Plain row merging, LIMIT application, COUNT merging, SUM merging, AVG correctness, MAX/MIN merging, ORDER BY on aggregated results |

### 13.3 Manual Testing

1. Upload a CSV via the frontend drag-and-drop
2. Select the dataset from the dropdown
3. Write a SQL query or click an example
4. Click "⚡ Explain Query" to see the execution plan
5. Click "Run Query" and watch live results stream in
6. Check Grafana at http://localhost:3001 for metrics

---

## 14. Benchmarking

### 14.1 Running Benchmarks

```bash
cd benchmarks
npm install
node run_benchmark.js
```

### 14.2 What It Does

1. Generates a 2,000,000-row CSV (`id, name, age, city, salary, department`)
2. Uploads it to QueryForge
3. Runs a distributed GROUP BY query with multiple aggregations
4. Runs the same query locally (single Node.js process)
5. Prints speedup comparison

### 14.3 Benchmark Query

```sql
SELECT department,
       COUNT(*) as total,
       AVG(salary) as avg_sal,
       MAX(salary) as max_sal,
       MIN(salary) as min_sal,
       SUM(salary) as total_sal
FROM employees
WHERE age > 20
GROUP BY department
ORDER BY total DESC
```

### 14.4 Expected Output

```
════════════════════════════════════════════════════════════
  QueryForge Benchmark Results
════════════════════════════════════════════════════════════
  Rows processed:          2,000,000
  Rows returned:           8 groups

  Single-machine time:     5958ms
  Distributed (3 workers): 3512ms
  Speedup:                 1.70x faster
════════════════════════════════════════════════════════════
```

---

## 15. What You Can Add (Roadmap)

### 15.1 High-Priority Enhancements

| Feature | Description | Complexity |
|---------|-------------|------------|
| **Query Result Caching** | Cache results in Redis keyed by `(sql_hash + dataset_version)` | Medium |
| **Columnar Storage (Parquet)** | Switch from CSV to Parquet for 10x compression + column pruning | High |
| **JOIN Support** | Distributed hash joins (broadcast + shuffle) | High |
| **Authentication** | JWT-based auth + dataset-level access control | Medium |
| **Query Optimizer** | Cost-based optimizer with statistics (row counts, cardinality) | High |

### 15.2 Medium-Priority Enhancements

| Feature | Description |
|---------|-------------|
| **Partition Pruning** | Skip partitions that can't match WHERE clause based on metadata |
| **Distributed Sort** | External merge sort on workers, k-way merge on coordinator |
| **Worker Auto-Scaling** | Kubernetes HPA or AWS Auto Scaling based on queue depth |
| **Exactly-Once Semantics** | Idempotency keys to prevent double-counting on retry |
| **Coordinator HA** | Leader election (etcd/ZooKeeper) with standby coordinators |
| **Incremental Processing** | For append-only datasets, only process new partitions |
| **SQL Prepared Statements** | Parameterized queries for safety + performance |
| **Materialized Views** | Pre-computed aggregations that update incrementally |

### 15.3 Low-Priority / Nice-to-Have

| Feature | Description |
|---------|-------------|
| **Subquery Support** | Nested SELECT statements |
| **Window Functions** | ROW_NUMBER, RANK, LAG, LEAD |
| **CTEs (WITH clauses)** | Common table expressions |
| **Query Rewriting** | Automatic predicate simplification and index hints |
| **Data Compression** | Gzip/Snappy compression for partition storage |
| **Cross-Region Replication** | Multi-datacenter MinIO deployment |

---

## 16. Troubleshooting

### 16.1 Common Issues

#### "Cannot reach coordinator" during benchmark
```bash
# Make sure docker compose is running
docker compose ps

# Check coordinator logs
docker compose logs coordinator
```

#### Worker fails to register
```bash
# Check coordinator is up first
curl http://localhost:3000/api/health

# Check worker logs
docker compose logs worker-1
```

#### WebSocket not receiving results
- Ensure you subscribed with the correct `jobId`
- Check browser DevTools → Network → WS for connection status
- Verify coordinator logs for WebSocket errors

#### Query returns no results
- Check that predicates match your data types (numeric vs string)
- Use EXPLAIN to verify the execution plan
- Check worker logs for parsing errors

### 16.2 Reset Everything

```bash
# Stop all services and remove all data
docker compose down -v

# Rebuild and restart
docker compose up --build
```

---

## 17. File-by-File Code Map

### 17.1 Coordinator (`coordinator/`)

| File | Lines | Purpose |
|------|-------|---------|
| `src/index.js` | 96 | Entry point: init MinIO, start gRPC, Express, WebSocket, fault monitor |
| `src/db/index.js` | 38 | PostgreSQL connection pool (max 20, 30s idle timeout) |
| `src/grpc/coordinatorServer.js` | 130 | gRPC server: Register + Heartbeat RPCs, worker registry |
| `src/grpc/workerClient.js` | 84 | gRPC client: ExecuteTask on workers, stub caching |
| `src/routes/datasets.js` | 81 | Upload, list, get dataset endpoints |
| `src/routes/query.js` | 72 | Submit query, get job status endpoints |
| `src/routes/explain.js` | 124 | EXPLAIN endpoint — returns execution plan |
| `src/routes/workers.js` | 101 | List workers, health check, service discovery, REST registration |
| `src/services/queryPlanner.js` | 213 | SQL AST parsing → execution plan |
| `src/services/partitioner.js` | 208 | CSV parsing, schema inference, splitting, MinIO upload |
| `src/services/jobManager.js` | 250 | Full query lifecycle: plan → dispatch → merge → stream |
| `src/services/resultMerger.js` | 134 | Merge partial results: plain rows or aggregated |
| `src/services/faultMonitor.js` | 186 | Detect timeouts, reassign tasks (max 3 attempts) |
| `src/websocket/wsServer.js` | 96 | WebSocket server: subscribe, ping/pong, late subscriber handling |
| `schema.sql` | 65 | PostgreSQL schema: datasets, partitions, workers, jobs, tasks |
| `tracing.js` | 38 | OpenTelemetry SDK initialization |
| `Dockerfile` | 17 | Node 20 Alpine image |
| `package.json` | 30 | Dependencies |

### 17.2 Worker (`worker/`)

| File | Lines | Purpose |
|------|-------|---------|
| `src/index.js` | 55 | Entry point: start gRPC server, register, start heartbeat |
| `src/grpc/workerServer.js` | 69 | gRPC server: ExecuteTask + Ping RPCs |
| `src/grpc/coordinatorClient.js` | 73 | gRPC client: Register + Heartbeat to coordinator |
| `src/services/taskExecutor.js` | 142 | Core logic: download, filter, aggregate, stream, cleanup |
| `src/services/predicateEvaluator.js` | 76 | Apply WHERE predicates row-by-row |
| `src/services/aggregator.js` | 95 | Local GROUP BY hash map aggregation |
| `src/services/minioClient.js` | 65 | Download partitions from MinIO to temp files |
| `src/heartbeat.js` | 29 | Periodic heartbeat loop (every 5s) |
| `tracing.js` | 33 | OpenTelemetry SDK initialization |
| `Dockerfile` | 17 | Node 20 Alpine image |
| `package.json` | 23 | Dependencies |

### 17.3 Frontend (`frontend/`)

| File | Lines | Purpose |
|------|-------|---------|
| `src/App.jsx` | 117 | Main app: dataset fetch, query submit, WS handling |
| `src/hooks/useQuery.js` | 33 | React hook: submit SQL query, track loading/error state |
| `src/hooks/useWebSocket.js` | 63 | React hook: WebSocket connection, subscribe to job |
| `src/components/SQLEditor.jsx` | 84 | SQL input, dataset selector, example queries, explain |
| `src/components/ResultsTable.jsx` | 100 | Result table with sorting, formatting, CSV export |
| `src/components/WorkerDashboard.jsx` | 87 | Worker status cards, progress bar, polling |
| `src/components/DatasetUploader.jsx` | 95 | Drag-and-drop CSV upload with dataset list |
| `src/components/ExplainPanel.jsx` | 117 | Execution plan viewer |
| `src/index.css` | — | Tailwind imports |
| `src/main.jsx` | — | React entry point |
| `index.html` | — | HTML template |
| `vite.config.js` | — | Vite configuration |
| `tailwind.config.js` | — | Tailwind theme configuration |
| `postcss.config.js` | — | PostCSS configuration |
| `Dockerfile` | 12 | Node 20 Alpine + Vite dev server |
| `package.json` | 24 | Dependencies |

### 17.4 Shared / Infrastructure

| File | Lines | Purpose |
|------|-------|---------|
| `proto/dataforge.proto` | 106 | gRPC service definitions + message types |
| `docker-compose.yml` | 151 | 9-service orchestration |
| `.env.example` | 16 | Environment variable template |
| `benchmarks/run_benchmark.js` | 312 | 2M row benchmark script |
| `monitoring/prometheus.yml` | 19 | Prometheus scrape configuration |
| `monitoring/dashboards/dataforge.json` | — | Grafana dashboard (auto-provisioned) |
| `tests/partitioner.test.js` | 102 | Row splitting + schema inference tests |
| `tests/predicateEvaluator.test.js` | 109 | Predicate pushdown tests |
| `tests/resultMerger.test.js` | 175 | MapReduce merge tests |

---

## Appendix A: Resume Bullet

> **Built QueryForge**, a distributed SQL query engine processing 2M-row CSV datasets across 3 parallel worker nodes via gRPC streaming; implemented predicate pushdown, partial aggregation (MapReduce-style), and automatic fault recovery achieving **1.70x speedup** over single-machine execution. Stack: Node.js, gRPC, PostgreSQL, MinIO, React, OpenTelemetry, Prometheus, Grafana, Docker Compose.

---

## Appendix B: Architecture Decision Records

### ADR 1: Why gRPC over REST for worker coordination?
- **Decision**: Use gRPC with server-side streaming
- **Rationale**: Native streaming support, binary protobuf serialization, stub caching, `wait_for_ready` for resilience
- **Trade-off**: Less human-debuggable than REST, requires proto compilation

### ADR 2: Why MinIO over shared filesystem?
- **Decision**: Use MinIO (S3-compatible object storage)
- **Rationale**: Works across distributed nodes, no locking needed, mirrors cloud patterns, horizontal scaling
- **Trade-off**: Adds network latency for partition downloads

### ADR 3: Why partial aggregation instead of sending all rows?
- **Decision**: Workers send aggregated hash maps, not raw rows
- **Rationale**: For 2M rows with 8 groups: raw = ~100MB network, aggregated = ~200 bytes
- **Trade-off**: More complex merge logic on coordinator

### ADR 4: Why Node.js for the entire backend?
- **Decision**: Use Node.js for both coordinator and workers
- **Rationale**: Single language stack, excellent streaming support, fast prototyping, great gRPC support
- **Trade-off**: Single-threaded event loop can be a bottleneck for CPU-intensive aggregation

### ADR 5: Why WebSocket over Server-Sent Events?
- **Decision**: Use WebSocket for result streaming
- **Rationale**: Bidirectional communication needed for subscribe model, ping/pong keepalive, better browser support for real-time dashboards
- **Trade-off**: More complex connection management than SSE

---

*End of Manual*
