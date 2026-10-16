import { network, run } from "hardhat";
import { loadDeployment } from "./deployments";

// Verifies every deployed contract on Etherscan. Usage:
//   npx hardhat run scripts/verify.ts --network sepolia
async function verify(address: string, contract: string, constructorArguments: unknown[] = []) {
  try {
    await run("verify:verify", { address, contract, constructorArguments });
    console.log(`verified ${contract} ${address}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // re-running the script must not fail on contracts that are already verified
    if (/already verified/i.test(message)) console.log(`already verified ${contract} ${address}`);
    else throw error;
  }
}

async function main() {
  const deployment = loadDeployment(network.name);
  const path = (name: string, dir: string) => `contracts/${dir}/${name}.sol:${name}`;

  for (const [name, address] of Object.entries(deployment.facets)) {
    await verify(address, path(name, "facets"));
  }
  for (const [name, address] of Object.entries(deployment.initializers)) {
    await verify(address, path(name, "init"));
  }
  await verify(
    deployment.diamond,
    "contracts/Diamond.sol:Diamond",
    deployment.diamondConstructorArgs,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
