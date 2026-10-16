import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { Deployment } from "./lib/deploy";

const DIR = "deployments";

export const deploymentPath = (network: string) => join(DIR, `${network}.json`);

export function saveDeployment(deployment: Deployment): string {
  mkdirSync(DIR, { recursive: true });
  const path = deploymentPath(deployment.network);
  writeFileSync(path, `${JSON.stringify(deployment, null, 2)}\n`);
  return path;
}

export function loadDeployment(network: string): Deployment {
  const path = deploymentPath(network);
  if (!existsSync(path)) throw new Error(`${path} not found, run the deploy script first`);
  return JSON.parse(readFileSync(path, "utf8")) as Deployment;
}
