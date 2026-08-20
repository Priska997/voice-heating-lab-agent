import * as restate from "@restatedev/restate-sdk";

import { runtimeConfig } from "../config.js";
import { services } from "./services.js";

restate.serve({
  services,
  port: runtimeConfig.restateEndpointPort,
});
