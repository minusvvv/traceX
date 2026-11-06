// Share cold-start work across concurrent requests; failed attempts can be retried.
export function createConnectionManager({isConnected, connect}) {
  let pending;
  return async uri => {
    if (pending) return pending;
    if (isConnected()) return;
    pending = Promise.resolve().then(() => connect(uri));
    try { await pending; }
    finally { pending = undefined; }
  };
}
