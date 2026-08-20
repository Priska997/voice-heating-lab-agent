import { gatewayConfig } from "../config.js";
import { buildGateway } from "./server.js";

const app = buildGateway(gatewayConfig.restateIngressUrl);

await app.listen({ host: "0.0.0.0", port: gatewayConfig.port });
