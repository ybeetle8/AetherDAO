const hre = require("hardhat");

// 质押等级对应的天数
const TIER_DAYS = {
  0: 7,
  1: 30,
  2: 90,
  3: 180,
  4: 365,
};

const TIER_NAMES = {
  0: "7天质押",
  1: "30天质押",
  2: "90天质押",
  3: "180天质押",
  4: "365天质押",
};

/**
 * 获取当前区块时间信息
 */
async function getTimeInfo() {
  const block = await hre.ethers.provider.getBlock("latest");
  const timestamp = block.timestamp;
  const date = new Date(timestamp * 1000);
  return {
    blockNumber: block.number,
    timestamp,
    utc: date.toISOString().replace("T", " ").replace(".000Z", " UTC"),
    local: date.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" }) + " UTC+8",
  };
}

/**
 * 格式化秒数为可读时间
 */
function formatDuration(seconds) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  const parts = [];
  if (days > 0) parts.push(`${days} 天`);
  if (hours > 0) parts.push(`${hours} 小时`);
  if (minutes > 0) parts.push(`${minutes} 分钟`);
  if (secs > 0) parts.push(`${secs} 秒`);
  return parts.join(" ") || "0 秒";
}

/**
 * 推进 EVM 时间
 */
async function advanceTime(seconds) {
  await hre.network.provider.send("evm_increaseTime", [seconds]);
  await hre.network.provider.send("evm_mine");
}

/**
 * 创建快照
 */
async function takeSnapshot() {
  return await hre.network.provider.send("evm_snapshot");
}

/**
 * 回滚快照
 */
async function revertSnapshot(snapshotId) {
  const success = await hre.network.provider.send("evm_revert", [snapshotId]);
  return success;
}

async function main() {
  console.log("\n=== AetherDAO 时间跳转工具 ===\n");

  const { DAYS, HOURS, SECONDS: SECS, TIER, QUERY, SNAPSHOT, REVERT } = process.env;

  // 优先级: REVERT > SNAPSHOT > QUERY > TIER > DAYS > HOURS > SECONDS

  // --- 回滚快照 ---
  if (REVERT) {
    const before = await getTimeInfo();
    console.log("操作: 回滚到快照", REVERT);
    console.log(`\n回滚前:`);
    console.log(`  区块号:   #${before.blockNumber}`);
    console.log(`  区块时间: ${before.utc}`);
    console.log(`  本地时间: ${before.local}`);

    const success = await revertSnapshot(REVERT);
    if (!success) {
      console.log("\n❌ 回滚失败，快照 ID 可能无效或已被使用");
      return;
    }

    const after = await getTimeInfo();
    console.log(`\n回滚后:`);
    console.log(`  区块号:   #${after.blockNumber}`);
    console.log(`  区块时间: ${after.utc}`);
    console.log(`  本地时间: ${after.local}`);
    console.log("\n✅ 快照回滚成功");
    return;
  }

  // --- 创建快照 ---
  if (SNAPSHOT) {
    const info = await getTimeInfo();
    const snapshotId = await takeSnapshot();
    console.log("操作: 创建快照");
    console.log(`\n当前状态:`);
    console.log(`  区块号:   #${info.blockNumber}`);
    console.log(`  区块时间: ${info.utc}`);
    console.log(`  本地时间: ${info.local}`);
    console.log(`\n✅ 快照已创建`);
    console.log(`  快照 ID: ${snapshotId}`);
    console.log(`\n回滚命令: REVERT=${snapshotId} npx hardhat run scripts/timeTravel.js --network localhost`);
    return;
  }

  // --- 查询时间 ---
  if (QUERY) {
    const info = await getTimeInfo();
    console.log("操作: 查询当前区块时间");
    console.log(`\n当前状态:`);
    console.log(`  区块号:   #${info.blockNumber}`);
    console.log(`  区块时间: ${info.utc}`);
    console.log(`  本地时间: ${info.local}`);
    console.log(`  时间戳:   ${info.timestamp}`);
    return;
  }

  // --- 计算跳转秒数 ---
  let totalSeconds = 0;
  let description = "";

  if (TIER !== undefined) {
    const tier = parseInt(TIER);
    if (!(tier in TIER_DAYS)) {
      console.log("❌ 无效的质押等级，支持 0-4");
      console.log("  0 = 7天, 1 = 30天, 2 = 90天, 3 = 180天, 4 = 365天");
      return;
    }
    totalSeconds = TIER_DAYS[tier] * 86400 + 1; // +1秒确保到期
    description = `跳转 ${TIER_DAYS[tier]} 天 (${TIER_NAMES[tier]})`;
  } else if (DAYS) {
    const days = parseFloat(DAYS);
    totalSeconds = Math.floor(days * 86400);
    description = `跳转 ${days} 天`;
  } else if (HOURS) {
    const hours = parseFloat(HOURS);
    totalSeconds = Math.floor(hours * 3600);
    description = `跳转 ${hours} 小时`;
  } else if (SECS) {
    totalSeconds = parseInt(SECS);
    description = `跳转 ${totalSeconds} 秒`;
  } else {
    console.log("用法 (通过环境变量控制):\n");
    console.log("  时间跳转:");
    console.log("    DAYS=7     npx hardhat run scripts/timeTravel.js --network localhost");
    console.log("    HOURS=12   npx hardhat run scripts/timeTravel.js --network localhost");
    console.log("    SECONDS=60 npx hardhat run scripts/timeTravel.js --network localhost");
    console.log("");
    console.log("  按质押等级跳转:");
    console.log("    TIER=0     npx hardhat run scripts/timeTravel.js --network localhost  # 7天");
    console.log("    TIER=1     npx hardhat run scripts/timeTravel.js --network localhost  # 30天");
    console.log("    TIER=2     npx hardhat run scripts/timeTravel.js --network localhost  # 90天");
    console.log("    TIER=3     npx hardhat run scripts/timeTravel.js --network localhost  # 180天");
    console.log("    TIER=4     npx hardhat run scripts/timeTravel.js --network localhost  # 365天");
    console.log("");
    console.log("  快照管理:");
    console.log("    SNAPSHOT=1   npx hardhat run scripts/timeTravel.js --network localhost");
    console.log("    REVERT=0x1   npx hardhat run scripts/timeTravel.js --network localhost");
    console.log("");
    console.log("  查询时间:");
    console.log("    QUERY=1    npx hardhat run scripts/timeTravel.js --network localhost");
    return;
  }

  if (totalSeconds <= 0) {
    console.log("❌ 跳转时间必须大于 0");
    return;
  }

  // --- 执行时间跳转 ---
  const before = await getTimeInfo();
  console.log(`操作: ${description} (${totalSeconds.toLocaleString()} 秒)\n`);
  console.log(`跳转前:`);
  console.log(`  区块号:   #${before.blockNumber}`);
  console.log(`  区块时间: ${before.utc}`);
  console.log(`  本地时间: ${before.local}`);

  await advanceTime(totalSeconds);

  const after = await getTimeInfo();
  console.log(`\n跳转后:`);
  console.log(`  区块号:   #${after.blockNumber}`);
  console.log(`  区块时间: ${after.utc}`);
  console.log(`  本地时间: ${after.local}`);

  console.log(`\n✅ 已推进: ${formatDuration(totalSeconds)}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ 执行失败:", error.message);
    process.exit(1);
  });
