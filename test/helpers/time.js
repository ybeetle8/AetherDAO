const hre = require("hardhat");

async function advanceTime(days) {
  const seconds = days * 24 * 60 * 60;
  await hre.network.provider.send("evm_increaseTime", [seconds]);
  await hre.network.provider.send("evm_mine");
}

async function advanceTimeSeconds(seconds) {
  await hre.network.provider.send("evm_increaseTime", [seconds]);
  await hre.network.provider.send("evm_mine");
}

async function getBlockTimestamp() {
  const block = await hre.ethers.provider.getBlock("latest");
  return block.timestamp;
}

async function takeSnapshot() {
  return await hre.network.provider.send("evm_snapshot");
}

async function revertSnapshot(snapshotId) {
  await hre.network.provider.send("evm_revert", [snapshotId]);
}

module.exports = {
  advanceTime,
  advanceTimeSeconds,
  getBlockTimestamp,
  takeSnapshot,
  revertSnapshot,
};
