/**
 * 导出 AetherReferral 主网合约推荐关系数据
 *
 * 原理：通过扫描合约事件 (ReferralBound / AdminReferralBound / FriendBound / AdminFriendBound)
 *       收集所有用户地址，再通过合约读函数批量查询完整关系数据。
 *
 * 用法：
 *   npx hardhat run scripts/exportReferralData.js --network bsc
 */

const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

// =========================================================================
// 配置
// =========================================================================

const CONTRACT_ADDRESS = "0x3810AE81750b61e8A73E1f96562e651f45d645EF";

// BSC 合约部署后的起始区块（可根据实际部署区块调整，减少扫描范围）
// 如果不确定，可以设为 0，但会很慢
const START_BLOCK = 70606323;

// 每次扫描的区块范围（BSC RPC 通常限制 5000 个区块）
const BLOCK_RANGE = 5000;

// 批量查询每批大小
const BATCH_SIZE = 100;

// 输出文件路径
const OUTPUT_DIR = path.join(__dirname, "..", "data");
const OUTPUT_FILE = path.join(OUTPUT_DIR, "referral-data.json");

// ABI（只需要读取相关的函数和事件）
const CONTRACT_ABI = [
  // 事件
  "event ReferralBound(address indexed user, address indexed referrer, uint256 timestamp)",
  "event AdminReferralBound(address indexed user, address indexed referrer, address indexed admin, uint256 timestamp)",
  "event FriendBound(address indexed user, address indexed friend, uint256 timestamp)",
  "event AdminFriendBound(address indexed user, address indexed friend, address indexed admin, uint256 timestamp)",
  // 读函数
  "function rootAddress() view returns (address)",
  "function getReferral(address user) view returns (address)",
  "function getFriend(address user) view returns (address)",
  "function hasLockedReferral(address user) view returns (bool)",
  "function hasLockedFriend(address user) view returns (bool)",
  "function getChildren(address user) view returns (address[])",
  "function getChildrenCount(address user) view returns (uint256)",
  "function batchGetUserInfo(address[]) view returns (address[], address[], bool[], bool[])",
];

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
// 步骤 1：扫描事件，收集所有相关地址
// =========================================================================
async function scanEvents(contract, endBlock) {
  logSection("步骤 1：扫描链上事件");

  const allAddresses = new Set();
  const referralEvents = [];
  const friendEvents = [];

  // 要扫描的事件过滤器
  const eventFilters = [
    { name: "ReferralBound", filter: contract.filters.ReferralBound() },
    { name: "AdminReferralBound", filter: contract.filters.AdminReferralBound() },
    { name: "FriendBound", filter: contract.filters.FriendBound() },
    { name: "AdminFriendBound", filter: contract.filters.AdminFriendBound() },
  ];

  // 带重试的事件查询（失败后等 10 秒，最多重试 3 次）
  async function queryWithRetry(filter, from, to, maxRetries = 3) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await contract.queryFilter(filter, from, to);
      } catch (err) {
        if (attempt < maxRetries) {
          logWarn(`区块 ${from}-${to} 第 ${attempt} 次查询失败: ${err.message.slice(0, 80)}`);
          logInfo(`  等待 10 秒后重试...`);
          await new Promise((r) => setTimeout(r, 10000));
        } else {
          logError(`区块 ${from}-${to} 连续 ${maxRetries} 次查询失败，跳过`);
          return null;
        }
      }
    }
  }

  // 处理查询到的事件
  function processEvents(events, name) {
    let count = 0;
    for (const event of events) {
      const args = event.args;
      if (name === "ReferralBound" || name === "AdminReferralBound") {
        allAddresses.add(args.user);
        allAddresses.add(args.referrer);
        referralEvents.push({
          user: args.user,
          referrer: args.referrer,
          timestamp: Number(args.timestamp),
          blockNumber: event.blockNumber,
          txHash: event.transactionHash,
          type: name,
        });
      } else if (name === "FriendBound" || name === "AdminFriendBound") {
        allAddresses.add(args.user);
        allAddresses.add(args.friend);
        friendEvents.push({
          user: args.user,
          friend: args.friend,
          timestamp: Number(args.timestamp),
          blockNumber: event.blockNumber,
          txHash: event.transactionHash,
          type: name,
        });
      }
      count++;
    }
    return count;
  }

  for (const { name, filter } of eventFilters) {
    logInfo(`扫描 ${name} 事件 (区块 ${START_BLOCK} -> ${endBlock})...`);

    let eventCount = 0;
    for (let from = START_BLOCK; from <= endBlock; from += BLOCK_RANGE) {
      const to = Math.min(from + BLOCK_RANGE - 1, endBlock);

      const events = await queryWithRetry(filter, from, to);
      if (events) {
        eventCount += processEvents(events, name);
      }

      // 每 50000 个区块输出一次进度
      if ((from - START_BLOCK) % 50000 === 0 && from > START_BLOCK) {
        const progress = (((from - START_BLOCK) / (endBlock - START_BLOCK)) * 100).toFixed(1);
        logInfo(`  进度: ${progress}% (区块 ${from}) | 已找到 ${eventCount} 条事件, ${allAddresses.size} 个地址`);
      }
    }

    logSuccess(`${name}: 找到 ${eventCount} 条事件`);
  }

  logSuccess(`共发现 ${allAddresses.size} 个独立地址`);
  logSuccess(`推荐关系事件: ${referralEvents.length} 条`);
  logSuccess(`好友关系事件: ${friendEvents.length} 条`);

  return { allAddresses, referralEvents, friendEvents };
}

// =========================================================================
// 步骤 2：批量查询所有用户的完整关系数据
// =========================================================================
async function batchQueryUsers(contract, addresses) {
  logSection("步骤 2：批量查询用户关系数据");

  const addressList = Array.from(addresses);
  const users = {};
  let processedCount = 0;

  for (let i = 0; i < addressList.length; i += BATCH_SIZE) {
    const batch = addressList.slice(i, i + BATCH_SIZE);

    try {
      const [referrers, friends, hasReferrals, hasFriends] =
        await contract.batchGetUserInfo(batch);

      for (let j = 0; j < batch.length; j++) {
        const addr = batch[j];
        const referrer = referrers[j];
        const friend = friends[j];

        users[addr] = {
          referrer: referrer === ethers.ZeroAddress ? null : referrer,
          friend: friend === ethers.ZeroAddress ? null : friend,
          hasLockedReferral: hasReferrals[j],
          hasLockedFriend: hasFriends[j],
        };
      }

      processedCount += batch.length;
      if (processedCount % 500 === 0 || processedCount === addressList.length) {
        logInfo(`已查询 ${processedCount} / ${addressList.length} 个地址`);
      }
    } catch (err) {
      logWarn(`批量查询失败，切换为逐个查询 (批次 ${i}-${i + batch.length})...`);
      // 降级为逐个查询
      for (const addr of batch) {
        try {
          const referrer = await contract.getReferral(addr);
          const friend = await contract.getFriend(addr);
          const hasRef = await contract.hasLockedReferral(addr);
          const hasFri = await contract.hasLockedFriend(addr);

          users[addr] = {
            referrer: referrer === ethers.ZeroAddress ? null : referrer,
            friend: friend === ethers.ZeroAddress ? null : friend,
            hasLockedReferral: hasRef,
            hasLockedFriend: hasFri,
          };
        } catch (singleErr) {
          logError(`查询地址 ${addr} 失败: ${singleErr.message.slice(0, 60)}`);
        }
        processedCount++;
      }
    }
  }

  logSuccess(`成功查询 ${Object.keys(users).length} 个用户数据`);
  return users;
}

// =========================================================================
// 步骤 3：查询 children 数据（可选，用于验证）
// =========================================================================
async function queryChildrenData(contract, users) {
  logSection("步骤 3：查询下线数据");

  // 找出所有有下线的地址（即被引用为 referrer 的地址）
  const referrerSet = new Set();
  for (const data of Object.values(users)) {
    if (data.referrer) {
      referrerSet.add(data.referrer);
    }
  }

  logInfo(`共 ${referrerSet.size} 个地址有下线`);

  const childrenMap = {};
  let count = 0;

  for (const referrer of referrerSet) {
    try {
      const children = await contract.getChildren(referrer);
      if (children.length > 0) {
        childrenMap[referrer] = children.map((c) => c);
      }
      count++;
      if (count % 100 === 0) {
        logInfo(`已查询 ${count} / ${referrerSet.size} 个推荐人的下线`);
      }
    } catch (err) {
      logWarn(`查询 ${referrer} 的下线失败: ${err.message.slice(0, 60)}`);
    }
  }

  logSuccess(`成功查询 ${Object.keys(childrenMap).length} 个推荐人的下线数据`);
  return childrenMap;
}

// =========================================================================
// 步骤 4：构建并输出结果
// =========================================================================
function buildOutput(rootAddr, users, childrenMap, referralEvents, friendEvents) {
  logSection("步骤 4：构建输出数据");

  // 统计
  const stats = {
    totalUsers: Object.keys(users).length,
    usersWithReferral: 0,
    usersWithFriend: 0,
    totalChildren: 0,
  };

  // 构建推荐关系数组（用于迁移）
  const referralPairs = [];
  const friendPairs = [];

  for (const [addr, data] of Object.entries(users)) {
    if (data.hasLockedReferral && data.referrer) {
      stats.usersWithReferral++;
      referralPairs.push({ user: addr, referrer: data.referrer });
    }
    if (data.hasLockedFriend && data.friend) {
      stats.usersWithFriend++;
      friendPairs.push({ user: addr, friend: data.friend });
    }
  }

  for (const children of Object.values(childrenMap)) {
    stats.totalChildren += children.length;
  }

  const output = {
    exportInfo: {
      contractAddress: CONTRACT_ADDRESS,
      network: "BSC Mainnet",
      exportTime: new Date().toISOString(),
      startBlock: START_BLOCK,
    },
    rootAddress: rootAddr,
    stats,
    // 核心迁移数据：推荐关系对
    referralPairs,
    // 好友关系对
    friendPairs,
    // 完整用户数据（含状态）
    users,
    // 下线关系（用于验证）
    children: childrenMap,
    // 原始事件记录（用于审计追溯）
    events: {
      referrals: referralEvents,
      friends: friendEvents,
    },
  };

  logSuccess(`推荐关系: ${stats.usersWithReferral} 对`);
  logSuccess(`好友关系: ${stats.usersWithFriend} 对`);
  logSuccess(`总下线数: ${stats.totalChildren}`);

  return output;
}

// =========================================================================
// 主流程
// =========================================================================
async function main() {
  logSection("AetherReferral 推荐关系数据导出");

  // 连接合约
  const contract = new ethers.Contract(
    CONTRACT_ADDRESS,
    CONTRACT_ABI,
    ethers.provider
  );

  // 获取基础信息
  const rootAddr = await contract.rootAddress();
  const currentBlock = await ethers.provider.getBlockNumber();

  logInfo(`合约地址: ${CONTRACT_ADDRESS}`);
  logInfo(`根地址: ${rootAddr}`);
  logInfo(`当前区块: ${currentBlock}`);
  logInfo(`扫描起始区块: ${START_BLOCK}`);

  // 步骤 1：扫描事件
  const { allAddresses, referralEvents, friendEvents } = await scanEvents(
    contract,
    currentBlock
  );

  // 确保 rootAddress 在地址集合中
  allAddresses.add(rootAddr);

  // 步骤 2：批量查询用户数据
  const users = await batchQueryUsers(contract, allAddresses);

  // 步骤 3：查询下线数据
  const childrenMap = await queryChildrenData(contract, users);

  // 步骤 4：构建输出
  const output = buildOutput(
    rootAddr,
    users,
    childrenMap,
    referralEvents,
    friendEvents
  );

  // 保存文件
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2), "utf-8");

  logSection("导出完成");
  logSuccess(`数据已保存到: ${OUTPUT_FILE}`);
  logInfo(`文件大小: ${(fs.statSync(OUTPUT_FILE).size / 1024).toFixed(1)} KB`);

  // 输出摘要
  logSection("数据摘要");
  logInfo(`根地址: ${rootAddr}`);
  logInfo(`独立地址数: ${output.stats.totalUsers}`);
  logInfo(`推荐关系数: ${output.stats.usersWithReferral}`);
  logInfo(`好友关系数: ${output.stats.usersWithFriend}`);
  logInfo(`事件总数: ${referralEvents.length + friendEvents.length}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    logError(`导出失败: ${error.message}`);
    console.error(error);
    process.exit(1);
  });
