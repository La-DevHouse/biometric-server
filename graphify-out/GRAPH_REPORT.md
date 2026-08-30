# Graph Report - .  (2026-08-29)

## Corpus Check
- 89 files · ~56,440 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 559 nodes · 1355 edges · 28 communities (25 shown, 3 thin omitted)
- Extraction: 96% EXTRACTED · 4% INFERRED · 0% AMBIGUOUS · INFERRED: 48 edges (avg confidence: 0.76)
- Token cost: 155,435 input · 0 output

## Community Hubs (Navigation)
- Protocol Handlers & Operation Engine
- Admin Dashboard Pages
- Server Actions & Command Dispatch
- Admin Dialog Components
- Database Init & API Routes
- Package Dependencies & Scripts
- TypeScript Configuration
- Command Catalog & Firmware Quirks
- Build Plan & Protocol Spec
- Custom Next Server & Networking
- Protocol Parser & Body Format
- Device Simulator
- Clock Sync & Traffic Spy
- Command Lifecycle & DB Schema
- Handshake Probe Tool
- Operations Unit Tests
- Admin UI & Log Tables
- TCP Sniffer Tool
- Enroll Test Script
- Parse Test Script
- Root Layout & Fonts
- Static SVG Assets
- Enroll Array Test Script
- Custom Server Entry
- Simple Enroll Test Script
- ESLint Config
- Next.js Config
- PostCSS Config

## God Nodes (most connected - your core abstractions)
1. `initDb()` - 43 edges
2. `runAsync()` - 36 edges
3. `cx()` - 25 edges
4. `useToast()` - 21 edges
5. `queueCommandForOperation()` - 20 edges
6. `notifyOperationStarted()` - 19 edges
7. `allAsync()` - 18 edges
8. `Complete Command Catalog Guide` - 17 edges
9. `parseBody()` - 16 edges
10. `compilerOptions` - 16 edges

## Surprising Connections (you probably didn't know these)
- `Initial Implementation Plan Prompt` --semantically_similar_to--> `Biometric Attendance Server Documentation`  [INFERRED] [semantically similar]
  docs/initial_plan_prompt.md → README.md
- `Docs Server Documentation (copy)` --semantically_similar_to--> `Biometric Attendance Server Documentation`  [INFERRED] [semantically similar]
  docs/README.md → README.md
- `Complete Command Catalog Guide` --semantically_similar_to--> `Server Command Catalog`  [INFERRED] [semantically similar]
  docs/COMANDOS.md → README.md
- `Admin Panel Visual Design Mockup` --semantically_similar_to--> `Admin UI (app/admin)`  [INFERRED] [semantically similar]
  docs/design/panel.html → README.md
- `Length-Prefixed Block Body Format (uint32 LE)` --semantically_similar_to--> `Protocol Body Format (JSON + concatenated binaries)`  [INFERRED] [semantically similar]
  docs/CONEXION_DISPOSITIVO_REAL.md → README.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Device HTTP Push Request Dispatch** — readme_receive_cmd, readme_send_cmd_result, readme_realtime_glog, readme_realtime_enroll_data, readme_dispatcher [EXTRACTED 1.00]
- **Block Fragmentation Assembly Flow** — readme_send_cmd_result, readme_block_fragmentation, readme_db_block_buffer, readme_protocol_handlers, readme_db_commands [EXTRACTED 1.00]
- **Mute Device Root-Cause Resolution** — docs_conexion_dispositivo_real_dispositivo_mudo, docs_conexion_dispositivo_real_net_mode, docs_conexion_dispositivo_real_post_double_slash, docs_conexion_dispositivo_real_server_ts [EXTRACTED 1.00]

## Communities (28 total, 3 thin omitted)

### Community 0 - "Protocol Handlers & Operation Engine"
Cohesion: 0.08
Nodes (62): getAsync(), runAsync(), findJsonEnd(), handleBiometricRequest(), logRawTraffic(), handleCommandResult(), handleRealtimeEnrollData(), handleRealtimeGlog() (+54 more)

### Community 1 - "Admin Dashboard Pages"
Cohesion: 0.06
Nodes (53): AsistenciaPage(), AttendanceRow, formatIoTime(), getData(), revalidate, toDayBound(), CommandRow, DiagnosticoPage() (+45 more)

### Community 2 - "Server Actions & Command Dispatch"
Cohesion: 0.11
Nodes (54): afterStart(), changePrivilegeAction(), clearEnrollAction(), clearLogsAction(), createUserAction(), deleteUserAction(), opError(), queueCommandAction() (+46 more)

### Community 3 - "Admin Dialog Components"
Cohesion: 0.11
Nodes (38): cancelOperationAction(), AdminShell(), isNavActive(), NAV_ITEMS, titleFor(), TITLES, ChangePrivilegeDialog(), OPTIONS (+30 more)

### Community 4 - "Database Init & API Routes"
Cohesion: 0.07
Nodes (40): getData(), AdminLayout(), metadata, revalidate, getData(), todayPrefix(), GET(), GET() (+32 more)

### Community 5 - "Package Dependencies & Scripts"
Cohesion: 0.05
Nodes (42): eslint, eslint-config-next, next, dependencies, next, react, react-dom, sqlite3 (+34 more)

### Community 6 - "TypeScript Configuration"
Cohesion: 0.07
Nodes (28): dom, dom.iterable, esnext, **/*.mts, .next/dev/types/**/*.ts, next-env.d.ts, .next/types/**/*.ts, node_modules (+20 more)

### Community 7 - "Command Catalog & Firmware Quirks"
Cohesion: 0.13
Nodes (23): Backup Number Map (0-12), Complete Command Catalog Guide, CLEAR_ENROLL_DATA Command, DELETE_USER Command, DELETE_USER cmd_return_code Not Reliable, Firmware WS535BW1_BSCS_v1.5.31, GET_DEVICE_STATUS Command, GET_ENROLL_DATA Command (+15 more)

### Community 8 - "Build Plan & Protocol Spec"
Cohesion: 0.17
Nodes (16): Six-Phase Build Plan, RESET_FK Command, SET_WEB_SERVER_INFO Command, Initial Implementation Plan Prompt, Block Fragmentation (>8KB results), Server Command Catalog, block_buffer Table, Device as HTTP Client (polling) (+8 more)

### Community 9 - "Custom Next Server & Networking"
Cohesion: 0.18
Nodes (13): Next.js Agent Rules, CLAUDE.md AGENTS.md Include, Case Study: Mute Device (2026-08-05), Handshake Probe Tool (npm run handshake-probe), Net Mode Local vs Internet, Device Sends POST // (Next 308 Redirect), Custom Next Server (server.ts), TCP Sniffer Tool (npm run sniffer) (+5 more)

### Community 10 - "Protocol Parser & Body Format"
Cohesion: 0.26
Nodes (13): CLEAR_LOG_DATA Command, decodeLogData (12-byte packed record), decodeUserIdList (uint32 LE id), GET_LOG_DATA Command, buildResponse Framed Output, Length-Prefixed Block Body Format (uint32 LE), parseBody Dual-Format Handling, parseBody Balanced-Brace Spec (+5 more)

### Community 11 - "Device Simulator"
Cohesion: 0.29
Nodes (11): deviceState, executeCommand(), generateFakeLogs(), generateFakeUserIdList(), main(), POLL_INTERVAL, receiveCmd(), sendCmdResult() (+3 more)

### Community 12 - "Clock Sync & Traffic Spy"
Cohesion: 0.17
Nodes (12): SET_TIME Command, Device Clock Starts at Year 2000, Real Biometric Device Connection Guide, handleReceiveCmd (delivery-time time stamping), SET_TIME With Empty Params (zero clock drift), Device Connectivity Troubleshooting, Docs Server Documentation (copy), Admin Traffic Viewer (/admin/traffic) (+4 more)

### Community 13 - "Command Lifecycle & DB Schema"
Cohesion: 0.24
Nodes (11): SET_FK_NAME Command, Device Capabilities Nested in fk_info, better-sqlite3 as Fixed Stack Decision, Admin Commands Page (/admin/commands), Command Lifecycle WAIT to RUN to RESULT, Database Module (lib/db.ts), commands Table, devices Table (+3 more)

### Community 14 - "Handshake Probe Tool"
Cohesion: 0.27
Nodes (9): dump(), Greeting, GREETINGS, PROBE_PORT, QUIET_MS, server, stamp(), zkChecksum() (+1 more)

### Community 15 - "Operations Unit Tests"
Cohesion: 0.25
Nodes (6): advance, completeCurrentStep(), currentCommand(), db, ops, persist

### Community 16 - "Admin UI & Log Tables"
Cohesion: 0.33
Nodes (7): Body Trailing NUL/newline Padding, Admin Panel Visual Design Mockup, Admin Dashboard (/admin), Admin Logs Page (/admin/logs), Admin UI (app/admin), attendance_logs Table, realtime_glog Request Type

### Community 17 - "TCP Sniffer Tool"
Cohesion: 0.48
Nodes (6): log(), render(), server, SNIFF_PORT, stamp(), UPSTREAM_PORT

### Community 18 - "Enroll Test Script"
Cohesion: 0.29
Nodes (6): enrollBinary1, enrollBinary2, enrollBody, enrollJson, options, req

### Community 19 - "Parse Test Script"
Cohesion: 0.33
Nodes (5): enrollBinary1, enrollBinary2, enrollBody, enrollJson, result

### Community 20 - "Root Layout & Fonts"
Cohesion: 0.40
Nodes (3): barlow, barlowCondensed, metadata

### Community 21 - "Static SVG Assets"
Cohesion: 0.70
Nodes (5): File Icon (SVG), Globe Icon (SVG), Next.js Wordmark Logo (SVG), Vercel Triangle Logo (SVG), Window / Browser Icon (SVG)

### Community 22 - "Enroll Array Test Script"
Cohesion: 0.40
Nodes (4): body, enrollJson, options, req

### Community 23 - "Custom Server Entry"
Cohesion: 0.40
Nodes (3): app, handle, port

### Community 24 - "Simple Enroll Test Script"
Cohesion: 0.50
Nodes (3): body, options, req

## Knowledge Gaps
- **164 isolated node(s):** `db`, `ops`, `advance`, `persist`, `db` (+159 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **3 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `initDb()` connect `Database Init & API Routes` to `Protocol Handlers & Operation Engine`, `Admin Dashboard Pages`, `Server Actions & Command Dispatch`?**
  _High betweenness centrality (0.043) - this node is a cross-community bridge._
- **Why does `runAsync()` connect `Protocol Handlers & Operation Engine` to `Server Actions & Command Dispatch`, `Database Init & API Routes`?**
  _High betweenness centrality (0.032) - this node is a cross-community bridge._
- **Why does `allAsync()` connect `Admin Dashboard Pages` to `Protocol Handlers & Operation Engine`, `Server Actions & Command Dispatch`, `Database Init & API Routes`?**
  _High betweenness centrality (0.022) - this node is a cross-community bridge._
- **What connects `db`, `ops`, `advance` to the rest of the system?**
  _164 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Protocol Handlers & Operation Engine` be split into smaller, more focused modules?**
  _Cohesion score 0.07922991484635321 - nodes in this community are weakly interconnected._
- **Should `Admin Dashboard Pages` be split into smaller, more focused modules?**
  _Cohesion score 0.061971830985915494 - nodes in this community are weakly interconnected._
- **Should `Server Actions & Command Dispatch` be split into smaller, more focused modules?**
  _Cohesion score 0.11279953243717125 - nodes in this community are weakly interconnected._