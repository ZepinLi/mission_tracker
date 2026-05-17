import { createPersonalRepository } from "./personal-repository.js";

export function createRepository(publicConfig = {}) {
  return createPersonalRepository(publicConfig);
}
