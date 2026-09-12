export function createStatementCache(prepareStatement) {
  const entries = new Map();

  return {
    get(sql) {
      let statement = entries.get(sql);
      if (!statement) {
        statement = prepareStatement(sql);
        entries.set(sql, statement);
      }
      return statement;
    },
    clear() {
      entries.clear();
    },
  };
}

export function startPeriodicTask(task, intervalMs) {
  const timer = setInterval(task, intervalMs);
  if (typeof timer.unref === "function") timer.unref();
  return () => clearInterval(timer);
}
