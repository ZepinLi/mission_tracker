import { createHttpRepository } from "./repository-http.js";

export function createRepository(publicConfig = {}) {
  return createHttpRepository(publicConfig);
}
