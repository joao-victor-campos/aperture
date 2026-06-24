export type ConnectionEngine = 'bigquery' | 'postgres' | 'snowflake' | 'neo4j'

interface ConnectionBase {
  id: string
  name: string
  createdAt: string
  engine: ConnectionEngine
}

export interface BigQueryConnection extends ConnectionBase {
  engine: 'bigquery'
  projectId: string
  credentialType: 'adc' | 'service-account'
  serviceAccountPath?: string
}

export interface PostgresConnection extends ConnectionBase {
  engine: 'postgres'
  host: string
  port: number
  database: string
  user: string
  password: string
}

export interface SnowflakeConnection extends ConnectionBase {
  engine: 'snowflake'
  /** Account identifier, e.g. "xy12345.us-east-1" or "orgname-accountname" */
  account: string
  username: string
  password: string
  /** Warehouse to use for compute, e.g. "COMPUTE_WH" */
  warehouse: string
  /** Optional default database to scope the catalog browser */
  database?: string
  /** Optional default schema */
  schema?: string
  /** Optional role override */
  role?: string
}

export interface Neo4jConnection extends ConnectionBase {
  engine: 'neo4j'
  /** Bolt URI, e.g. "neo4j://localhost:7687" or "neo4j+s://xxxx.databases.neo4j.io" */
  uri: string
  username: string
  password: string
  /** Optional default database (Neo4j 4.0+ multi-database); defaults to "neo4j" */
  database?: string
}

export type Connection = BigQueryConnection | PostgresConnection | SnowflakeConnection | Neo4jConnection

export type ConnectionCreate =
  | Omit<BigQueryConnection, 'id' | 'createdAt'>
  | Omit<PostgresConnection, 'id' | 'createdAt'>
  | Omit<SnowflakeConnection, 'id' | 'createdAt'>
  | Omit<Neo4jConnection, 'id' | 'createdAt'>

export interface Dataset {
  id: string
  projectId: string
  name: string
  location?: string
  description?: string
}

export interface TableField {
  name: string
  type: string
  mode: 'NULLABLE' | 'REQUIRED' | 'REPEATED'
  description?: string
  fields?: TableField[]
}

/** Result row of a catalog-wide table search (no full schema metadata). */
export interface TableSearchHit {
  datasetId: string
  tableId: string
  name: string
  type: 'TABLE' | 'VIEW' | 'LABEL' | 'RELATIONSHIP_TYPE'
}

export interface Table {
  id: string
  datasetId: string
  projectId: string
  name: string
  type: 'TABLE' | 'VIEW' | 'MATERIALIZED_VIEW' | 'EXTERNAL' | 'LABEL' | 'RELATIONSHIP_TYPE'
  description?: string
  rowCount?: number
  sizeBytes?: number
  schema?: TableField[]
}

export interface QueryResult {
  columns: string[]
  rows: Record<string, unknown>[]
  rowCount: number
  executionTimeMs: number
  bytesProcessed?: number
  /** Total rows produced by the query (from BigQuery metadata) */
  totalRows?: number
  /** Opaque token for fetching the next page of results */
  pageToken?: string | null
  /** True when more pages exist */
  hasMore?: boolean
}

/**
 * Neo4j graph values, serialized for IPC transport. The Bolt driver returns
 * class instances (Node/Relationship/Path) that can't cross the structured-clone
 * boundary, so the adapter converts them to these plain, `__neo4jType`-tagged
 * objects. `identity`/`start`/`end` hold Neo4j element IDs (stable strings).
 */
export interface Neo4jNode {
  __neo4jType: 'Node'
  identity: string
  labels: string[]
  properties: Record<string, unknown>
}

export interface Neo4jRelationship {
  __neo4jType: 'Relationship'
  identity: string
  start: string
  end: string
  type: string
  properties: Record<string, unknown>
}

export interface Neo4jPath {
  __neo4jType: 'Path'
  segments: { start: Neo4jNode; relationship: Neo4jRelationship; end: Neo4jNode }[]
}

export type Neo4jGraphValue = Neo4jNode | Neo4jRelationship | Neo4jPath

/**
 * Rendering-side graph types — what react-force-graph-2d expects.
 * Distinct from the wire types (Neo4jNode/Relationship/Path) which are tagged
 * for the IPC boundary. `buildGraphFromRecords` converts wire → rendering.
 */
export interface GraphNode {
  /** Neo4j element ID — also the force-graph node id */
  id: string
  /** First label, used to seed color; '(unknown)' for orphan endpoints */
  primaryLabel: string
  /** All labels — shown in the inspector */
  labels: string[]
  properties: Record<string, unknown>
}

export interface GraphLink {
  /** Neo4j relationship element ID */
  id: string
  /** Source node id — must match a GraphNode.id */
  source: string
  /** Target node id — must match a GraphNode.id */
  target: string
  type: string
  properties: Record<string, unknown>
}

export interface GraphData {
  nodes: GraphNode[]
  links: GraphLink[]
}

// ── Result charts ────────────────────────────────────────────────────────────

export type ChartAggregate = 'none' | 'sum' | 'avg' | 'count' | 'min' | 'max'

export interface ChartConfig {
  type: 'bar' | 'line' | 'scatter'
  /** Result column used for the X axis (category). */
  xCol: string
  /** Result column used for the Y axis (value). */
  yCol: string
  aggregate: ChartAggregate
}

/** A query parameter ({{name}}) and its current value/type for client-side substitution. */
export interface QueryParam {
  name: string
  type: 'text' | 'number' | 'boolean' | 'raw'
  value: string
}

export interface QueryTab {
  id: string
  /** Which editor group this tab belongs to. Defaults to 'left'. */
  groupId?: 'left' | 'right'
  /** 'query' (default), 'table' (catalog inspection tab), or 'result' (pinned snapshot) */
  type?: 'query' | 'table' | 'result'
  title: string
  sql: string
  /** Detected {{name}} params for this tab, kept in sync with `sql`. */
  params?: QueryParam[]
  connectionId?: string
  /** Populated when type === 'table' */
  tableRef?: { engine: ConnectionEngine; projectId: string; datasetId: string; tableId: string }
  result?: QueryResult
  error?: string
  isRunning: boolean
  cancelled?: boolean
  logs: string[]
  savedQueryId?: string
  /** Explain plan / dry-run result (shown in ExplainPanel) */
  explainResult?: { bytesProcessed: number; plan?: string; planFormat?: 'text' | 'json' }
  isExplaining?: boolean
  /** When true, the graph view replaces the results table for this tab. */
  viewAsGraph?: boolean
  /** Which result surface this tab shows: the data table (default) or a chart. */
  resultView?: 'table' | 'chart'
  /** Persisted chart-builder selection for this tab. */
  chartConfig?: ChartConfig
}

export interface SavedQuery {
  id: string
  folderId: string | null
  title: string
  sql: string
  /** Persisted param types + default values, restored when the query is reopened. */
  params?: QueryParam[]
  connectionId?: string
  createdAt: string
  updatedAt: string
}

export interface Folder {
  id: string
  parentId: string | null
  name: string
  createdAt: string
}

export interface HistoryEntry {
  id: string
  sql: string
  connectionId: string
  connectionName: string
  executedAt: string
  durationMs: number
  rowCount: number
}

/**
 * An imported Base16 colour theme. Persisted via the main store.
 * `base` is a map of Base16 slot keys ("base00"–"base0F") to lowercase
 * hex strings without a leading `#`.
 */
export interface Theme {
  id: string
  name: string
  author?: string
  base: Record<string, string>
  importedAt: string
}

/** Validated Base16 payload returned from the file-dialog IPC. */
export interface ThemeImportPayload {
  scheme: string
  author?: string
  base: Record<string, string>
}

/**
 * Result of an update check against GitHub's /releases/latest.
 * `currentVersion` is always set; the rest are null on a failed/empty check.
 */
export interface UpdateStatus {
  currentVersion: string
  latestVersion: string | null
  updateAvailable: boolean
  /** Arch-matched DMG asset URL, or null if no matching asset was found. */
  dmgUrl: string | null
  /** The release's GitHub HTML page. */
  releaseUrl: string | null
  releaseNotes: string | null
  publishedAt: string | null
  /** ISO timestamp of when this check ran. */
  checkedAt: string
  /** Non-null when the check failed (network/HTTP/parse). */
  error: string | null
}

// ── AI chat companion ───────────────────────────────────────────────────────

export type ChatRole = 'user' | 'assistant'

export interface ChatTextBlock {
  type: 'text'
  text: string
}

export interface ChatToolUseBlock {
  type: 'tool_use'
  id: string
  name: string
  input: Record<string, unknown>
}

export interface ChatToolResultBlock {
  type: 'tool_result'
  tool_use_id: string
  content: string
  isError?: boolean
}

export type ChatContentBlock = ChatTextBlock | ChatToolUseBlock | ChatToolResultBlock

export interface ChatMessage {
  role: ChatRole
  content: ChatContentBlock[]
}

export interface ChatThread {
  id: string
  title: string
  /** The connection this thread explores. Tools run against it. */
  connectionId: string
  messages: ChatMessage[]
  createdAt: string
  updatedAt: string
}

/** Tool schema in Anthropic's shape (passed straight through to the SDK). */
export interface AiToolDef {
  name: string
  description: string
  input_schema: Record<string, unknown>
}

export interface AiCompleteRequest {
  /** Correlates AI_CHAT_STREAM push events back to this turn. */
  requestId: string
  system: string
  messages: ChatMessage[]
  tools: AiToolDef[]
}

export interface AiCompleteResponse {
  /** The assistant turn (text + any tool_use blocks). */
  message: ChatMessage
  stopReason: string | null
  /** Set when the call failed (missing key, network, etc.). message is empty then. */
  error?: string
}

/** Non-secret view of the AI config returned to the renderer. */
export interface AiConfigStatus {
  configured: boolean
  /** Last 4 chars of the key, e.g. "…a1b2"; null when unconfigured. */
  maskedHint: string | null
  model: string
  inlineCompletionEnabled: boolean
}

/** Payload to update AI config. Omit apiKey to change only the model. */
export interface AiConfigSet {
  apiKey?: string
  model?: string
  inlineCompletionEnabled?: boolean
}

// ── AI inline autocomplete ──────────────────────────────────────────────────

export interface InlineCompleteRequest {
  /** Echoed back for client-side staleness correlation. */
  requestId: string
  /** Text before the cursor. */
  prefix: string
  /** Text after the cursor. */
  suffix: string
  engine: ConnectionEngine
  /** Compact schema context (referenced tables' columns); may be empty. */
  schema: string
}

export interface InlineCompleteResponse {
  /** The text to insert at the cursor. Empty string = no suggestion. */
  text: string
  /** Set when the call failed; text is '' then. */
  error?: string
}
