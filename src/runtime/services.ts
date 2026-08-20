import { agentInbox } from "./agent-inbox.js";
import { heaterCoordinator } from "./heater-coordinator.js";
import { heatingRequest, heatingTools } from "./heating-tools.js";
import { heatingTaskRecord } from "./heating-task-record.js";
import { heatingWorkflow } from "./heating-workflow.js";
import { heaterDevice, simulatorAdmin } from "./simulated-heater.js";

export const services = [
  heaterCoordinator,
  heaterDevice,
  heatingWorkflow,
  agentInbox,
  heatingRequest,
  heatingTaskRecord,
  heatingTools,
  simulatorAdmin,
];
