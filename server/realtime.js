const clientsByPage = new Map();

function addClient(pageId, res) {
  if (!clientsByPage.has(pageId)) {
    clientsByPage.set(pageId, new Set());
  }
  clientsByPage.get(pageId).add(res);
  res.writeHead(200, {
    "Cache-Control": "no-store",
    "Content-Type": "text/event-stream; charset=utf-8",
    Connection: "keep-alive",
  });
  res.write("event: ready\n");
  res.write(`data: ${JSON.stringify({ pageId })}\n\n`);

  const interval = setInterval(() => {
    try {
      res.write("event: ping\n");
      res.write(`data: ${JSON.stringify({ at: new Date().toISOString() })}\n\n`);
    } catch (_error) {
      clearInterval(interval);
    }
  }, 25000);

  return () => {
    clearInterval(interval);
    clientsByPage.get(pageId)?.delete(res);
    if (!clientsByPage.get(pageId)?.size) {
      clientsByPage.delete(pageId);
    }
  };
}

function broadcastPage(pageId, type, payload = {}) {
  const clients = clientsByPage.get(pageId);
  if (!clients || !clients.size) return;
  const body = JSON.stringify({
    pageId,
    type,
    ...payload,
    at: new Date().toISOString(),
  });
  for (const res of clients) {
    try {
      res.write(`event: ${type}\n`);
      res.write(`data: ${body}\n\n`);
    } catch (_error) {
      clients.delete(res);
    }
  }
}

module.exports = {
  addClient,
  broadcastPage,
};
