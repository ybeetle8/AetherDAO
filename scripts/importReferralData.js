/**
 * 导入推荐关系数据到 Staking 合约
 *
 * 从 data/referral-data.json 读取导出的推荐关系，
 * 按拓扑排序（从根节点往下逐层）分批调用 batchAdminBindReferral 导入。
 *
 * 用法：
 *   npx hardhat run scripts/importReferralData.js --network localhost
 */

const hre = require("hardhat");
const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

// =========================================================================
// 配置
// =========================================================================

// 部署信息
const deployment = require("../ae-deployment.json");
const STAKING_ADDRESS = deployment.contracts.Staking;

// 导入数据文件
const DATA_FILE = path.join(__dirname, "..", "data", "referral-data.json");

// 每批导入数量
// Fork 网络下每笔交易需通过远程 RPC 读取状态，批次太大会导致 Headers Timeout
// 建议 Fork 网络用 10，主网可以适当调大
const BATCH_SIZE = 10;

// =========================================================================
// 颜色输出
// =========================================================================
const colors = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
};

function log(msg, color = colors.reset) {
  console.log(`${color}${msg}${colors.reset}`);
}
function logInfo(msg) { log(`  ℹ ${msg}`, colors.cyan); }
function logSuccess(msg) { log(`  ✓ ${msg}`, colors.green); }
function logWarn(msg) { log(`  ⚠ ${msg}`, colors.yellow); }
function logError(msg) { log(`  ✗ ${msg}`, colors.red); }
function logSection(msg) {
  log(`\n${"=".repeat(60)}`, colors.blue);
  log(`  ${msg}`, colors.blue);
  log("=".repeat(60), colors.blue);
}

// =========================================================================
// 步骤 1：加载数据并进行拓扑排序
// =========================================================================
function loadAndSort(data) {
  logSection("步骤 1：加载数据并拓扑排序");

  const { referralPairs, rootAddress } = data;
  logInfo(`根地址: ${rootAddress}`);
  logInfo(`推荐关系对数: ${referralPairs.length}`);

  // 构建邻接表：referrer -> [users]
  const childrenMap = new Map();
  const referrerOf = new Map();

  for (const { user, referrer } of referralPairs) {
    const ref = referrer.toLowerCase();
    const usr = user.toLowerCase();
    referrerOf.set(usr, ref);
    if (!childrenMap.has(ref)) {
      childrenMap.set(ref, []);
    }
    childrenMap.get(ref).push(usr);
  }

  // BFS 从根节点开始，逐层遍历，保证父节点先于子节点导入
  const sorted = [];
  const visited = new Set();
  const queue = [rootAddress.toLowerCase()];
  visited.add(rootAddress.toLowerCase());

  while (queue.length > 0) {
    const current = queue.shift();
    const children = childrenMap.get(current) || [];
    for (const child of children) {
      if (!visited.has(child)) {
        visited.add(child);
        sorted.push({ user: child, referrer: current });
        queue.push(child);
      }
    }
  }

  // 检查是否有孤立节点（referrer 不在树中）
  const missedPairs = referralPairs.filter(
    ({ user }) => !visited.has(user.toLowerCase())
  );
  if (missedPairs.length > 0) {
    logWarn(`发现 ${missedPairs.length} 个孤立节点（推荐人不在树中），将追加到末尾`);
    for (const { user, referrer } of missedPairs) {
      sorted.push({ user: user.toLowerCase(), referrer: referrer.toLowerCase() });
    }
  }

  logSuccess(`拓扑排序完成: ${sorted.length} 对推荐关系`);

  // 打印前几层结构
  const root = rootAddress.toLowerCase();
  const level1 = (childrenMap.get(root) || []).length;
  logInfo(`第 1 层下线: ${level1} 个`);
  let level2 = 0;
  for (const child of childrenMap.get(root) || []) {
    level2 += (childrenMap.get(child) || []).length;
  }
  logInfo(`第 2 层下线: ${level2} 个`);

  return sorted;
}

// =========================================================================
// 步骤 2：分批导入
// =========================================================================
async function batchImport(staking, sortedPairs) {
  logSection("步骤 2：分批导入推荐关系");

  const totalPairs = sortedPairs.length;
  const totalBatches = Math.ceil(totalPairs / BATCH_SIZE);
  let importedCount = 0;
  let skippedCount = 0;
  let failedBatches = 0;

  logInfo(`总计 ${totalPairs} 对, 分 ${totalBatches} 批, 每批 ${BATCH_SIZE} 对`);

  for (let i = 0; i < totalPairs; i += BATCH_SIZE) {
    const batch = sortedPairs.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;

    const users = batch.map((p) => p.user);
    const referrers = batch.map((p) => p.referrer);

    // 重试逻辑
    let success = false;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const tx = await staking.batchAdminBindReferral(users, referrers);
        const receipt = await tx.wait();

        // 统计实际绑定数（通过事件计数）
        const boundEvents = receipt.logs.filter((log) => {
          try {
            const parsed = staking.interface.parseLog(log);
            return parsed && parsed.name === "AdminReferralBound";
          } catch {
            return false;
          }
        });

        const batchImported = boundEvents.length;
        const batchSkipped = batch.length - batchImported;
        importedCount += batchImported;
        skippedCount += batchSkipped;

        logInfo(
          `批次 ${batchNum}/${totalBatches}: 导入 ${batchImported}, 跳过 ${batchSkipped} | ` +
          `gas: ${receipt.gasUsed.toString()} | 累计: ${importedCount}/${totalPairs}`
        );

        success = true;
        break;
      } catch (err) {
        if (attempt < 3) {
          logWarn(`批次 ${batchNum} 第 ${attempt} 次失败: ${err.message.slice(0, 80)}`);
          logInfo(`  等待 10 秒后重试...`);
          await new Promise((r) => setTimeout(r, 10000));
        } else {
          logError(`批次 ${batchNum} 连续 3 次失败，跳过该批次`);
          logError(`  错误: ${err.message.slice(0, 120)}`);
          failedBatches++;
        }
      }
    }
  }

  return { importedCount, skippedCount, failedBatches };
}

// =========================================================================
// 步骤 3：全量验证导入结果
// =========================================================================
const VERIFY_BATCH_SIZE = 50;

async function verifyImport(staking, sortedPairs, rootAddress) {
  logSection("步骤 3：全量验证导入结果");

  const total = sortedPairs.length;
  let verified = 0;
  let failed = 0;
  const failedList = [];

  logInfo(`开始全量验证 ${total} 对推荐关系...`);

  for (let i = 0; i < total; i += VERIFY_BATCH_SIZE) {
    const batch = sortedPairs.slice(i, i + VERIFY_BATCH_SIZE);

    // 并发查询这一批的链上数据
    const results = await Promise.all(
      batch.map(async ({ user, referrer }) => {
        try {
          const [onChainReferrer, isBound] = await Promise.all([
            staking.getReferral(user),
            staking.isBindReferral(user),
          ]);
          return { user, referrer, onChainReferrer, isBound, error: null };
        } catch (err) {
          return { user, referrer, onChainReferrer: null, isBound: false, error: err.message };
        }
      })
    );

    for (const r of results) {
      if (r.error) {
        failed++;
        failedList.push({
          user: r.user,
          expectedReferrer: r.referrer,
          reason: `查询出错: ${r.error.slice(0, 80)}`,
        });
      } else if (!r.isBound) {
        failed++;
        failedList.push({
          user: r.user,
          expectedReferrer: r.referrer,
          reason: "未绑定 (isBindReferral=false)",
        });
      } else if (r.onChainReferrer.toLowerCase() !== r.referrer.toLowerCase()) {
        failed++;
        failedList.push({
          user: r.user,
          expectedReferrer: r.referrer,
          actualReferrer: r.onChainReferrer,
          reason: `推荐人不匹配: 期望 ${r.referrer}, 实际 ${r.onChainReferrer}`,
        });
      } else {
        verified++;
      }
    }

    // 每 200 条输出一次进度
    const processed = Math.min(i + VERIFY_BATCH_SIZE, total);
    if (processed % 200 === 0 || processed === total) {
      logInfo(`验证进度: ${processed}/${total} | 通过: ${verified}, 失败: ${failed}`);
    }
  }

  // 输出失败详情
  if (failedList.length > 0) {
    logWarn(`\n--- 验证失败详情 (${failedList.length} 条) ---`);
    for (const item of failedList) {
      logError(`  用户: ${item.user}`);
      logError(`    期望推荐人: ${item.expectedReferrer}`);
      if (item.actualReferrer) {
        logError(`    实际推荐人: ${item.actualReferrer}`);
      }
      logError(`    原因: ${item.reason}`);
    }
  }

  // 验证根地址状态
  const rootBound = await staking.isBindReferral(rootAddress);
  logInfo(`根地址 ${rootAddress} 绑定状态: ${rootBound ? "已绑定" : "未绑定"}`);

  logSuccess(`全量验证完成: ${verified} 通过, ${failed} 失败 (共 ${total} 对)`);

  return { verified, failed, failedList };
}

// =========================================================================
// 主流程
// =========================================================================
async function main() {
  logSection("推荐关系导入到 Staking 合约");

  // 检查数据文件
  if (!fs.existsSync(DATA_FILE)) {
    logError(`数据文件不存在: ${DATA_FILE}`);
    logInfo(`请先运行 exportReferralData.js 导出数据`);
    process.exit(1);
  }

  // 加载数据
  const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
  logInfo(`数据来源: ${data.exportInfo.contractAddress}`);
  logInfo(`导出时间: ${data.exportInfo.exportTime}`);

  // 连接合约
  const [deployer] = await ethers.getSigners();
  logInfo(`操作地址: ${deployer.address}`);
  logInfo(`Staking 合约: ${STAKING_ADDRESS}`);

  const staking = await ethers.getContractAt(
    "contracts/AE-Staking/src/interfaces/IStaking.sol:IStaking",
    STAKING_ADDRESS
  );

  // 检查根地址
  const onChainRoot = await staking.getRootAddress();
  logInfo(`合约根地址: ${onChainRoot}`);

  if (onChainRoot.toLowerCase() !== data.rootAddress.toLowerCase()) {
    logWarn(`根地址不一致! 数据文件: ${data.rootAddress}, 合约: ${onChainRoot}`);
    logWarn(`将使用合约的根地址作为基准，替换数据中的根地址`);
    // 替换数据中引用旧根地址的 referrer
    const oldRoot = data.rootAddress.toLowerCase();
    const newRoot = onChainRoot.toLowerCase();
    for (const pair of data.referralPairs) {
      if (pair.referrer.toLowerCase() === oldRoot) {
        pair.referrer = newRoot;
      }
    }
    data.rootAddress = onChainRoot;
  }

  // 步骤 1: 拓扑排序
  const sortedPairs = loadAndSort(data);

  if (sortedPairs.length === 0) {
    logWarn("没有需要导入的推荐关系");
    return;
  }

  // 步骤 2: 分批导入
  const { importedCount, skippedCount, failedBatches } = await batchImport(
    staking,
    sortedPairs
  );

  // 步骤 3: 全量验证
  const { verified, failed, failedList } = await verifyImport(
    staking,
    sortedPairs,
    data.rootAddress
  );

  // 输出总结
  logSection("导入完成");
  logSuccess(`成功导入: ${importedCount} 对推荐关系`);
  if (skippedCount > 0) logWarn(`跳过（已绑定/无效）: ${skippedCount} 对`);
  if (failedBatches > 0) logError(`失败批次: ${failedBatches} 个`);
  logInfo(`全量验证: ${verified} 通过, ${failed} 失败 (共 ${sortedPairs.length} 对)`);
  if (failedList.length > 0) {
    logError(`有 ${failedList.length} 条推荐关系未成功导入，请检查上方详情`);
  } else {
    logSuccess(`所有推荐关系已成功导入并验证通过!`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    logError(`导入失败: ${error.message}`);
    console.error(error);
    process.exit(1);
  });
