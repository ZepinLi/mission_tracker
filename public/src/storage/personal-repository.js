function createHttpError(response, payload) {
  const error = new Error((payload && payload.error) || "Request failed with " + response.status);
  error.status = response.status;
  error.payload = payload;
  return error;
}

export function createPersonalRepository(publicConfig = {}) {
  const apiBaseUrl = (publicConfig.apiBaseUrl || "").replace(/\/$/, "");

  async function request(path, options = {}) {
    const response = await fetch(apiBaseUrl + path, {
      credentials: "same-origin",
      headers: {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(options.headers || {}),
      },
      ...options,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    const text = await response.text();
    const payload = text ? JSON.parse(text) : null;
    if (!response.ok) {
      throw createHttpError(response, payload);
    }
    return payload;
  }

  return {
    async loadTracker() {
      return request("/api/personal-tracker");
    },
    async loadAiConfig() {
      return request("/api/ai/config");
    },
    async analyzeWithAi(payload) {
      return request("/api/ai/analyze", {
        method: "POST",
        body: payload,
      });
    },
    async chatWithAi(payload) {
      return request("/api/ai/chat", {
        method: "POST",
        body: payload,
      });
    },
    async extractMemory(payload) {
      return request("/api/ai/extract-memory", {
        method: "POST",
        body: payload,
      });
    },
    async saveTracker(state) {
      return request("/api/personal-tracker", {
        method: "PUT",
        body: state,
      });
    },
  };
}
