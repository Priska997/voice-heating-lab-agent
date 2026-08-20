import { agentInbox } from "./agent-inbox.js";
import { heaterCoordinator } from "./heater-coordinator.js";
import { heatingRequest, heatingTools, workflowInvoker } from "./heating-tools.js";
import { heatingTaskAcceptance } from "./heating-task-acceptance.js";
import { heatingWorkflow } from "./heating-workflow.js";
import { heaterDevice } from "./simulated-heater.js";

export const services = [
  heaterCoordinator,
  heaterDevice,
  heatingWorkflow,
  agentInbox,
  workflowInvoker,
  heatingRequest,
  heatingTaskAcceptance,
  heatingTools,
];
