import { MissionTrackerController } from "./controller.js";
import { createRepository } from "./storage/repository.js";
import { getDom } from "./ui/dom.js";

export async function bootstrapMissionTracker() {
  const publicConfig = window.MISSION_TRACKER_CONFIG || {};
  const repository = createRepository(publicConfig);
  const dom = getDom();
  const controller = new MissionTrackerController({ dom, repository });
  await controller.init();
  window.missionTrackerApp = controller;
}
