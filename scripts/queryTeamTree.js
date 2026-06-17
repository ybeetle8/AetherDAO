/**
 * 递归查询团队树所有成员的质押记录 (BSC 主网)
 *
 * 功能:
 * - 通过链上事件扫描，递归查出目标地址下所有层级的团队成员
 * - 查询每个成员的质押记录详情
 *
 * 执行: npx hardhat run scripts/queryTeamTree.js --network bsc
 */

const { ethers } = require("hardhat");

// ============================================================
// 配置常量 (按需修改)
// ============================================================

// 目标地址 (查询此地址下的团队树)
const TARGET_ADDRESS = "0xB6d86540BEBEd318f7bCf42bcE9BAA19b500BD39";

// 质押合约地址
const STAKING_ADDRESS = "0xf812E0A65d01FFE2b3916F483B1BDe69d38829B3";

// 扫描天数 (往前扫多少天的事件)
const SCAN_DAYS = 7;

// RPC 单次查询最大区块范围 (pinax 限制 100000)
const MAX_BLOCK_RANGE = 95000;

// BSC 每块约 3 秒
const BLOCKS_PER_DAY = 28800;

// ============================================================

const STAKING_ABI = [
  "function getUserInfo(address user) view returns (uint128 totalStaked, uint128 teamKPI, address referrer, bool hasLocked, bool isPreacherStatus)",
  "function getUserStakeRecords(address user) view returns (tuple(uint256 index, uint40 stakeTime, uint160 amount, bool status, uint8 stakeIndex, uint256 currentValue, bool canWithdraw, uint256 timeRemaining, uint256 earnedInterest, uint256 withdrawnInterestAmount)[] orders)",
  "function getTeamPerformanceDetails(address _user) view returns (uint256 totalTeamInvestment, uint256 teamMemberCount, uint8 currentTier, uint256 nextTierThreshold, uint256 progressToNextTier)",
  "function getReferralCount(address _user) view returns (uint256)",
  "event ReferralBound(address indexed user, address indexed referrer, uint256 timestamp)",
  "event AdminReferralBound(address indexed user, address indexed referrer, address indexed admin, uint256 timestamp)",
];

const STAKE_TIERS = ["7天", "30天", "90天", "180天", "365天"];

/**
 * 分段扫描事件
 */
async function scanEvents(staking, eventName, referrerAddress, fromBlock, toBlock) {
  const allEvents = [];
  let current = fromBlock;

  while (current <= toBlock) {
    const end = Math.min(current + MAX_BLOCK_RANGE - 1, toBlock);
    try {
      const filter = staking.filters[eventName](null, referrerAddress);
      const events = await staking.queryFilter(filter, current, end);
      allEvents.push(...events);
    } catch (e) {
      // 如果还是超限，缩小范围重试
      const mid = Math.floor((current + end) / 2);
      if (mid === current) throw e;
      const part1 = await scanEvents(staking, eventName, referrerAddress, current, mid);
      const part2 = await scanEvents(staking, eventName, referrerAddress, mid + 1, end);
      allEvents.push(...part1, ...part2);
      current = end + 1;
      continue;
    }
    current = end + 1;
  }
  return allEvents;
}

/**
 * 查找某地址的所有直推地址
 */
async function findDirectReferrals(staking, address, fromBlock, toBlock) {
  const children = new Set();

  // 扫描 ReferralBound 事件
  const events1 = await scanEvents(staking, "ReferralBound", address, fromBlock, toBlock);
  for (const e of events1) {
    children.add(e.args.user.toLowerCase());
  }

  // 扫描 AdminReferralBound 事件
  const events2 = await scanEvents(staking, "AdminReferralBound", address, fromBlock, toBlock);
  for (const e of events2) {
    children.add(e.args.user.toLowerCase());
  }

  return [...children];
}

/**
 * 递归构建团队树
 */
async function buildTeamTree(staking, address, fromBlock, toBlock, depth = 0, visited = new Set()) {
  const addrLower = address.toLowerCase();
  if (visited.has(addrLower)) return [];
  visited.add(addrLower);

  const directChildren = await findDirectReferrals(staking, address, fromBlock, toBlock);
  const tree = [];

  for (const child of directChildren) {
    if (visited.has(child)) continue;
    tree.push({ address: child, depth: depth + 1, parent: address });
    // 递归查下级
    const subTree = await buildTeamTree(staking, child, fromBlock, toBlock, depth + 1, visited);
    tree.push(...subTree);
  }

  return tree;
}

async function main() {
  console.log("=".repeat(60));
  console.log("  BSC 主网 - 团队树递归质押查询");
  console.log("=".repeat(60));
  console.log(`\n目标地址:   ${TARGET_ADDRESS}`);
  console.log(`质押合约:   ${STAKING_ADDRESS}`);
  console.log(`扫描范围:   最近 ${SCAN_DAYS} 天`);

  const staking = new ethers.Contract(STAKING_ADDRESS, STAKING_ABI, ethers.provider);
  const currentBlock = await ethers.provider.getBlockNumber();
  const fromBlock = currentBlock - BLOCKS_PER_DAY * SCAN_DAYS;

  console.log(`当前区块:   ${currentBlock}`);
  console.log(`起始区块:   ${fromBlock}`);
  console.log(`区块范围:   ${currentBlock - fromBlock} 块\n`);

  // 1. 查目标地址自身信息
  console.log("-".repeat(60));
  console.log(`【根节点】 ${TARGET_ADDRESS}`);
  console.log("-".repeat(60));

  const rootInfo = await staking.getUserInfo(TARGET_ADDRESS);
  const rootTeam = await staking.getTeamPerformanceDetails(TARGET_ADDRESS);
  console.log(`  个人质押: ${ethers.formatEther(rootInfo.totalStaked)} USDX`);
  console.log(`  团队KPI:  ${ethers.formatEther(rootTeam.totalTeamInvestment)} USDX`);
  console.log(`  直推人数: ${rootTeam.teamMemberCount.toString()}`);
  console.log(`  团队等级: V${rootTeam.currentTier}`);

  // 2. 递归扫描团队树
  console.log(`\n正在扫描团队树事件 (最近${SCAN_DAYS}天)...`);
  const teamTree = await buildTeamTree(staking, TARGET_ADDRESS, fromBlock, currentBlock);

  if (teamTree.length === 0) {
    console.log("\n未找到团队成员（在扫描范围内无绑定事件）");
    console.log("提示: 如果成员是更早绑定的，请增大 SCAN_DAYS 常量");
    console.log("=".repeat(60));
    return;
  }

  console.log(`\n找到 ${teamTree.length} 个团队成员\n`);

  // 3. 查询每个成员的质押记录
  console.log("=".repeat(60));
  console.log("  团队成员质押明细");
  console.log("=".repeat(60));

  let totalTeamStaked = 0n;
  let totalStakeCount = 0;

  for (let i = 0; i < teamTree.length; i++) {
    const member = teamTree[i];
    const indent = "  ".repeat(member.depth);
    const levelTag = `[L${member.depth}]`;

    console.log(`\n${"-".repeat(60)}`);
    console.log(`${indent}${levelTag} ${member.address}`);
    console.log(`${indent}    上级: ${member.parent}`);

    try {
      const info = await staking.getUserInfo(member.address);
      console.log(`${indent}    个人质押: ${ethers.formatEther(info.totalStaked)} USDX`);
      console.log(`${indent}    团队KPI:  ${ethers.formatEther(info.teamKPI)} USDX`);

      // 查询质押记录
      const records = await staking.getUserStakeRecords(member.address);
      const activeRecords = records.filter(r => !r.status);
      console.log(`${indent}    质押笔数: ${records.length} (活跃: ${activeRecords.length})`);

      totalTeamStaked += info.totalStaked;
      totalStakeCount += records.length;

      if (records.length > 0) {
        console.log(`${indent}    --- 质押明细 ---`);
        for (const r of records) {
          const stakeDate = new Date(Number(r.stakeTime) * 1000).toLocaleString("zh-CN");
          const tierName = STAKE_TIERS[r.stakeIndex] || `档位${r.stakeIndex}`;
          const status = r.status ? "已提取" : "活跃";
          console.log(`${indent}      ${tierName} | ${ethers.formatEther(r.amount)} USDX | ${status} | ${stakeDate}`);
          if (!r.status) {
            console.log(`${indent}        当前价值: ${ethers.formatEther(r.currentValue)} USDX | 已赚: ${ethers.formatEther(r.earnedInterest)} USDX`);
          }
        }
      }
    } catch (e) {
      console.log(`${indent}    查询失败: ${e.message.slice(0, 100)}`);
    }
  }

  // 4. 汇总
  console.log(`\n${"=".repeat(60)}`);
  console.log("  汇总统计");
  console.log("=".repeat(60));
  console.log(`  团队成员总数:   ${teamTree.length}`);
  console.log(`  团队质押总额:   ${ethers.formatEther(totalTeamStaked)} USDX`);
  console.log(`  团队质押总笔数: ${totalStakeCount}`);

  // 按层级统计
  const depthMap = {};
  for (const m of teamTree) {
    depthMap[m.depth] = (depthMap[m.depth] || 0) + 1;
  }
  console.log(`\n  层级分布:`);
  for (const [depth, count] of Object.entries(depthMap).sort((a, b) => a[0] - b[0])) {
    console.log(`    第${depth}层: ${count} 人`);
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log("  查询完成");
  console.log("=".repeat(60));
}

main().catch((error) => {
  console.error("查询失败:", error.message);
  process.exitCode = 1;
});
