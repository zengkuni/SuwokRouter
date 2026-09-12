import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";

const OPTIONAL_FIELDS = [
  "displayName", "email", "globalPriority", "defaultModel",
  "accessToken", "refreshToken", "expiresAt", "tokenType",
  "scope", "projectId", "apiKey", "testStatus",
  "lastTested", "lastError", "lastErrorAt", "rateLimitedUntil", "expiresIn", "errorCode",
  "consecutiveUseCount", "idToken", "lastRefreshAt",
];

function rowToConn(row) {
  if (!row) return null;
  const extra = parseJson(row.data, {});
  return {
    ...extra,
    id: row.id,
    provider: row.provider,
    authType: row.authType,
    name: row.name,
    email: row.email,
    priority: row.priority,
    isActive: row.isActive === 1 || row.isActive === true,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

const ROUTING_DATA_FIELDS = [
  "lastUsedAt",
  "consecutiveUseCount",
  "deprioritizeUntil",
  "backoffLevel",
  "rateLimitedUntil",
  "lastError",
  "testStatus",
];

function rowToRoutingConn(row) {
  if (!row) return null;
  const extra = parseJson(row.data, {}) || {};
  const connection = {
    id: row.id,
    provider: row.provider,
    authType: row.authType,
    name: row.name,
    email: row.email,
    priority: row.priority,
    isActive: row.isActive === 1 || row.isActive === true,
  };

  for (const field of ROUTING_DATA_FIELDS) {
    if (extra[field] !== undefined) connection[field] = extra[field];
  }
  for (const [key, value] of Object.entries(extra)) {
    if (key.startsWith("modelLock_") && value) connection[key] = value;
  }
  return connection;
}

function connToRow(c) {
  const { id, provider, authType, name, email, priority, isActive, createdAt, updatedAt, ...rest } = c;
  return {
    id,
    provider,
    authType,
    name: name ?? null,
    email: email ?? null,
    priority: priority ?? null,
    isActive: isActive === false ? 0 : 1,
    data: stringifyJson(rest),
    createdAt,
    updatedAt,
  };
}

function upsert(db, c) {
  const r = connToRow(c);
  db.run(
    `INSERT INTO providerConnections(id, provider, authType, name, email, priority, isActive, data, createdAt, updatedAt)
     VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       provider=excluded.provider, authType=excluded.authType, name=excluded.name,
       email=excluded.email, priority=excluded.priority, isActive=excluded.isActive,
       data=excluded.data, updatedAt=excluded.updatedAt`,
    [r.id, r.provider, r.authType, r.name, r.email, r.priority, r.isActive, r.data, r.createdAt, r.updatedAt]
  );
}

function deriveConnectionName(data, fallbackName) {
  if (data.provider === "github") {
    return data.providerSpecificData?.githubLogin
      || data.providerSpecificData?.githubEmail
      || data.email
      || data.providerSpecificData?.githubName
      || fallbackName;
  }
  return fallbackName;
}

function normalizeConnectionName(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeApiKey(value) {
  return typeof value === "string" ? value.trim() : "";
}

function conflictError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function nextGeneratedConnectionName(existingRows, preferredName = "") {
  const used = new Set(
    existingRows
      .map((connection) => normalizeConnectionName(connection.name).toLowerCase())
      .filter(Boolean)
  );
  const match = normalizeConnectionName(preferredName).match(
    /^(swayrouter-account|sway-account)(\d*)$/i
  );
  const base = match?.[1] || "swayrouter-account";
  let suffix = match?.[2] ? Number(match[2]) : 0;

  while (true) {
    const candidate = `${base}${suffix || ""}`;
    if (!used.has(candidate.toLowerCase())) return candidate;
    suffix += 1;
  }
}

function findDuplicateApiKey(existingRows, apiKey, ignoreId) {
  const normalized = normalizeApiKey(apiKey);
  if (!normalized) return null;
  return existingRows.find(
    (connection) =>
      connection.id !== ignoreId &&
      connection.authType === "apikey" &&
      normalizeApiKey(connection.apiKey) === normalized
  ) || null;
}

function findDuplicateConnectionName(existingRows, name, ignoreId) {
  const normalized = normalizeConnectionName(name).toLowerCase();
  if (!normalized) return null;
  return existingRows.find(
    (connection) =>
      connection.id !== ignoreId &&
      connection.authType === "apikey" &&
      normalizeConnectionName(connection.name).toLowerCase() === normalized
  ) || null;
}

export async function getProviderConnections(filter = {}) {
  const db = await getAdapter();
  const where = ["1 = 1"];
  const params = [];
  if (filter.provider) { where.push("provider = ?"); params.push(filter.provider); }
  if (filter.authType) { where.push("authType = ?"); params.push(filter.authType); }
  if (filter.isActive !== undefined) { where.push("isActive = ?"); params.push(filter.isActive ? 1 : 0); }

  if (filter.ids) {
    const idList = [...filter.ids];
    if (idList.length === 0) return [];
    const placeholders = idList.map(() => "?").join(", ");
    where.push(`id IN (${placeholders})`);
    params.push(...idList);
  }
  const sql = `SELECT * FROM providerConnections WHERE ${where.join(" AND ")}`;
  const rows = db.all(sql, params);
  const list = rows.map(rowToConn);
  list.sort((a, b) => (a.priority || 999) - (b.priority || 999));
  return list;
}

export async function getProviderConnectionsForRouting(filter = {}) {
  const db = await getAdapter();
  const where = ["1 = 1"];
  const params = [];
  if (filter.provider) { where.push("provider = ?"); params.push(filter.provider); }
  if (filter.isActive !== undefined) { where.push("isActive = ?"); params.push(filter.isActive ? 1 : 0); }
  if (filter.authType) { where.push("authType = ?"); params.push(filter.authType); }

  const rows = db.all(
    `SELECT id, provider, authType, name, email, priority, isActive, data
     FROM providerConnections WHERE ${where.join(" AND ")}
     ORDER BY COALESCE(priority, 999), id`,
    params,
  );
  return rows.map(rowToRoutingConn);
}

export async function getActiveProviderRows() {
  const db = await getAdapter();
  const rows = db.all(
    `SELECT * FROM (
       SELECT *, ROW_NUMBER() OVER (
         PARTITION BY provider
         ORDER BY COALESCE(priority, 999), updatedAt DESC
       ) AS rn
       FROM providerConnections
       WHERE isActive = 1
     ) WHERE rn = 1`
  );
  return rows.map(rowToConn);
}

export async function getProviderConnectionById(id) {
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM providerConnections WHERE id = ?`, [id]);
  return rowToConn(row);
}

const PRIORITY_GAP = 1024;

function gapPriorityBelow(existingRows, prevPriority) {
  let p = (Number(prevPriority) || 0) + PRIORITY_GAP;

  const taken = new Set();
  for (const c of existingRows) {
    if (c.priority !== null && c.priority !== undefined) taken.add(c.priority);
  }
  let i = 0;
  while (taken.has(p) && i < PRIORITY_GAP) { p += 1; i += 1; }
  return p;
}

function normalizePriorities(db, providerId) {
  const list = db.all(`SELECT * FROM providerConnections WHERE provider = ?`, [providerId]).map(rowToConn);
  list.sort((a, b) => {
    const pDiff = (a.priority || 0) - (b.priority || 0);
    if (pDiff !== 0) return pDiff;
    return new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0);
  });
  list.forEach((c, i) => {
    db.run(`UPDATE providerConnections SET priority = ? WHERE id = ?`, [i + 1, c.id]);
  });
}

export async function createProviderConnection(data) {
  const db = await getAdapter();
  const now = new Date().toISOString();
  let result;

  db.transaction(() => {
    const all = db.all(`SELECT * FROM providerConnections WHERE provider = ?`, [data.provider]).map(rowToConn);

    const incomingApiKey = normalizeApiKey(data.apiKey);
    if (data.authType === "apikey" && incomingApiKey) {
      if (findDuplicateApiKey(all, incomingApiKey)) {
        throw conflictError(
          "DUPLICATE_API_KEY",
          "This API key is already connected to this provider"
        );
      }
    }

    let existing = null;
    if (data.authType === "oauth" && data.email) {
      const incomingUsername = data.providerSpecificData?.username;
      const incomingWs = data.providerSpecificData?.chatgptAccountId;
      existing = all.find(c => {
        if (c.authType !== "oauth" || c.email !== data.email) return false;

        if (data.provider === "codex") {
          const existingWs = c.providerSpecificData?.chatgptAccountId;
          return !!incomingWs && !!existingWs && incomingWs === existingWs;
        }

        const existingWs = c.providerSpecificData?.chatgptAccountId;
        if (incomingWs && existingWs) return incomingWs === existingWs;
        if (incomingWs && !existingWs) return false;
        if (!incomingWs && existingWs) return false;

        const existingUsername = c.providerSpecificData?.username;
        if (incomingUsername && existingUsername) {
          return incomingUsername === existingUsername;
        }
        if (incomingUsername || existingUsername) return false;
        return true;
      });
    }

    if (existing) {
      const merged = { ...existing, ...data, updatedAt: now };
      upsert(db, merged);
      result = merged;
      return;
    }

    const requestedName = normalizeConnectionName(data.name);
    let connectionName = requestedName || null;
    if (data.authType === "apikey" || data.authType === "api_key") {
      if (data.autoName === true || !requestedName) {
        connectionName = nextGeneratedConnectionName(all, requestedName);
      } else if (findDuplicateConnectionName(all, requestedName)) {
        throw conflictError(
          "DUPLICATE_CONNECTION_NAME",
          "A connection with this account name already exists for this provider"
        );
      }
    }
    if (!connectionName && (data.authType === "oauth" || data.authType === "access_token")) {
      connectionName = deriveConnectionName(data, data.email || `Account ${all.length + 1}`);
    }
    let connectionPriority = data.priority;
    if (connectionPriority === undefined || connectionPriority === null) {

      connectionPriority = gapPriorityBelow(
        all,
        all.reduce((m, c) => {
          const p = Number(c.priority) || 0;
          return p > m ? p : m;
        }, 0)
      );
    }

    const conn = {
      id: uuidv4(),
      provider: data.provider,
      authType: data.authType || "oauth",
      name: connectionName,
      priority: connectionPriority,
      isActive: data.isActive !== undefined ? data.isActive : true,
      createdAt: now,
      updatedAt: now,
    };
    for (const f of OPTIONAL_FIELDS) {
      if (data[f] !== undefined && data[f] !== null) {
        conn[f] = f === "apiKey" ? incomingApiKey : data[f];
      }
    }
    if (data.providerSpecificData && Object.keys(data.providerSpecificData).length > 0) {
      conn.providerSpecificData = data.providerSpecificData;
    }
    if (data.email !== undefined) conn.email = data.email;

    upsert(db, conn);
    result = conn;
  });

  return result;
}

export async function updateProviderConnection(id, data) {
  const db = await getAdapter();
  let result;
  db.transaction(() => {
    const row = db.get(`SELECT * FROM providerConnections WHERE id = ?`, [id]);
    if (!row) { result = null; return; }
    const existing = rowToConn(row);
    const providerRows = db
      .all(`SELECT * FROM providerConnections WHERE provider = ?`, [existing.provider])
      .map(rowToConn);
    const normalizedUpdate = { ...data };

    if (existing.authType === "apikey") {
      if (data.apiKey !== undefined) {
        normalizedUpdate.apiKey = normalizeApiKey(data.apiKey);
        if (findDuplicateApiKey(providerRows, normalizedUpdate.apiKey, id)) {
          throw conflictError(
            "DUPLICATE_API_KEY",
            "This API key is already connected to this provider"
          );
        }
      }
      if (data.name !== undefined) {
        normalizedUpdate.name = normalizeConnectionName(data.name);
        if (findDuplicateConnectionName(providerRows, normalizedUpdate.name, id)) {
          throw conflictError(
            "DUPLICATE_CONNECTION_NAME",
            "A connection with this account name already exists for this provider"
          );
        }
      }
    }

    const merged = { ...existing, ...normalizedUpdate, updatedAt: new Date().toISOString() };
    upsert(db, merged);
    if (data.priority !== undefined) normalizePriorities(db, existing.provider);
    result = merged;
  });
  return result;
}

export async function deleteProviderConnection(id) {
  const db = await getAdapter();
  let ok = false;
  db.transaction(() => {
    const row = db.get(`SELECT provider FROM providerConnections WHERE id = ?`, [id]);
    if (!row) return;
    db.run(`DELETE FROM providerConnections WHERE id = ?`, [id]);
    ok = true;
  });
  return ok;
}

export async function deleteProviderConnectionsByProvider(providerId) {
  const db = await getAdapter();
  const before = db.get(`SELECT COUNT(*) AS n FROM providerConnections WHERE provider = ?`, [providerId]);
  db.run(`DELETE FROM providerConnections WHERE provider = ?`, [providerId]);
  return before?.n || 0;
}

export async function reorderProviderConnections(providerId) {
  const db = await getAdapter();
  db.transaction(() => normalizePriorities(db, providerId));
}

export async function getProviderConnectionsPaged(filter = {}) {
  const db = await getAdapter();
  const where = [];
  const params = [];

  if (filter.provider) { where.push("provider = ?"); params.push(filter.provider); }
  if (filter.providerPrefixes?.length) {
    const prefixes = filter.providerPrefixes.filter((prefix) => typeof prefix === "string" && prefix.length > 0);
    if (prefixes.length) {
      where.push(`(${prefixes.map(() => "provider LIKE ?").join(" OR ")})`);
      params.push(...prefixes.map((prefix) => `${prefix}%`));
    }
  }
  if (filter.authType) { where.push("authType = ?"); params.push(filter.authType); }
  if (filter.isActive !== undefined) { where.push("isActive = ?"); params.push(filter.isActive ? 1 : 0); }
  if (filter.search) {
    const q = `%${filter.search}%`;
    where.push("(name LIKE ? OR email LIKE ? OR id LIKE ?)");
    params.push(q, q, q);
  }

  const whereClause = where.length ? ` WHERE ${where.join(" AND ")}` : "";

  const countRow = db.get(`SELECT COUNT(*) AS total FROM providerConnections${whereClause}`, params);
  const total = countRow?.total || 0;

  const page = Math.max(1, Number(filter.page) || 1);
  const pageSize = Math.max(1, Math.min(500, Number(filter.pageSize) || 25));
  const offset = (page - 1) * pageSize;

  const cap = Number.isFinite(Number(filter.limit)) && Number(filter.limit) > 0
    ? Math.min(500, Math.floor(Number(filter.limit)))
    : null;
  const cappedSize = cap === null ? pageSize : Math.max(0, Math.min(pageSize, cap - offset));
  const pageSizeApplied = cappedSize > 0 ? cappedSize : 0;

  const rows = pageSizeApplied > 0 ? db.all(
    `SELECT * FROM providerConnections${whereClause} ORDER BY COALESCE(priority, 999), id LIMIT ? OFFSET ?`,
    [...params, pageSizeApplied, offset]
  ) : [];
  const connections = rows.map(rowToConn);

  return { connections, total };
}

export async function countProviderConnections() {
  const db = await getAdapter();
  const rows = db.all(
    `SELECT provider,
            COUNT(*) AS total,
            SUM(CASE WHEN isActive = 1 THEN 1 ELSE 0 END) AS active,
            SUM(CASE WHEN isActive = 0 THEN 1 ELSE 0 END) AS inactive
     FROM providerConnections
     GROUP BY provider`
  );
  return rows.map(r => ({
    provider: r.provider,
    total: r.total,
    active: r.active,
    inactive: r.inactive,
  }));
}

export async function countConnectionsByProxyPool() {
  const db = await getAdapter();
  const rows = db.all(`
    SELECT COALESCE(
      json_extract(data, '$.providerSpecificData.proxyPoolId'),
      json_extract(data, '$.proxyPoolId')
    ) AS proxyPoolId, COUNT(*) AS total
    FROM providerConnections
    WHERE COALESCE(
      json_extract(data, '$.providerSpecificData.proxyPoolId'),
      json_extract(data, '$.proxyPoolId')
    ) IS NOT NULL
    GROUP BY proxyPoolId
  `);
  return new Map(rows.map((row) => [String(row.proxyPoolId), Number(row.total) || 0]));
}

export async function cleanupProviderConnections() {
  const db = await getAdapter();
  const fieldsToCheck = [
    "displayName", "email", "globalPriority", "defaultModel",
    "accessToken", "refreshToken", "expiresAt", "tokenType",
    "scope", "projectId", "apiKey", "testStatus",
    "lastTested", "lastError", "lastErrorAt", "rateLimitedUntil", "expiresIn",
    "consecutiveUseCount",
  ];
  let cleaned = 0;
  db.transaction(() => {
    const rows = db.all(`SELECT * FROM providerConnections`);
    for (const row of rows) {
      const conn = rowToConn(row);
      let dirty = false;
      for (const f of fieldsToCheck) {
        if (conn[f] === null || conn[f] === undefined) {
          if (f in conn) { delete conn[f]; cleaned++; dirty = true; }
        }
      }
      if (conn.providerSpecificData && Object.keys(conn.providerSpecificData).length === 0) {
        delete conn.providerSpecificData;
        cleaned++;
        dirty = true;
      }
      if (dirty) upsert(db, conn);
    }
  });
  return cleaned;
}
