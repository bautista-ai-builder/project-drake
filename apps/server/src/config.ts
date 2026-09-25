import { serverConfigSchema, type ServerConfig } from "@drake/contracts";

export const loadConfig = (environment: NodeJS.ProcessEnv = process.env): ServerConfig =>
  serverConfigSchema.parse(environment);

