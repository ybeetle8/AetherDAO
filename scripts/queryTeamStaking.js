/**
 * 查询指定地址的团队质押信息 (BSC 主网)
 * - 团队质押总数 (Team KPI)
 * - 直推人数
 * - 团队等级
 * - 每笔质押记录详情
 */

const { ethers } = require("hardhat");

const STAKING_ADDRESS = "0xf812E0A65d01FFE2b3916F483B1BDe69d38829B3";
const TARGET_ADDRESS = "0xB6d86540BEBEd318f7bCf42bcE9BAA19b500BD39";

// 只需要用到的函数签名
const STAKING_ABI = [
  "function getTeamKpi(address _user) view returns (uint256)",
  "function getReferralCount(address _user) view returns (uint256)",
  "function getUserInfo(address user) view returns (uint128 totalStaked, uint128 teamKPI, address referrer, bool hasLocked, bool isPreacherStatus)",
  "function getTeamPerformanceDetails(address _user) view returns (uint256 totalTeamInvestment, uint256 teamMemberCount, uint8 currentTier, uint256 nextTierThreshold, uint256 progressToNextTier)",
  "function getUserStakeRecords(address user) view returns (tuple(uint256 index, uint40 stakeTime, uint160 amount, bool status, uint8 stakeIndex, uint256 currentValue, bool canWithdraw, uint256 timeRemaining, uint256 earnedInterest, uint256 withdrawnInterestAmount)[] orders)",
  "function stakeCount(address user) view returns (uint256 count)",
  "function principalBalance(address account) view returns (uint256 balance)",
];

// 质押档位名称
const STAKE_TIERS = ["7天", "30天", "90天", "180天", "365天"];

async function main() {
  console.log("=".repeat(60));
  console.log("  BSC 主网 - 团队质押查询");
  console.log("=".repeat(60));
  console.log(`\n目标地址: ${TARGET_ADDRESS}`);
  console.log(`质押合约: ${STAKING_ADDRESS}\n`);

  const staking = new ethers.Contract(
    STAKING_ADDRESS,
    STAKING_ABI,
    ethers.provider
  );

  // 1. 查询用户基本信息
  console.log("-".repeat(60));
  console.log("【用户基本信息】");
  console.log("-".repeat(60));

  const userInfo = await staking.getUserInfo(TARGET_ADDRESS);
  console.log(`  个人质押总额: ${ethers.formatEther(userInfo.totalStaked)} USDX`);
  console.log(`  团队 KPI:     ${ethers.formatEther(userInfo.teamKPI)} USDX`);
  console.log(`  推荐人:       ${userInfo.referrer}`);
  console.log(`  已锁定推荐:   ${userInfo.hasLocked ? "是" : "否"}`);
  console.log(`  布道者状态:   ${userInfo.isPreacherStatus ? "是" : "否"}`);

  // 2. 查询团队业绩详情
  console.log("\n" + "-".repeat(60));
  console.log("【团队业绩详情】");
  console.log("-".repeat(60));

  const teamDetails = await staking.getTeamPerformanceDetails(TARGET_ADDRESS);
  console.log(`  团队质押总数: ${ethers.formatEther(teamDetails.totalTeamInvestment)} USDX`);
  console.log(`  直推人数:     ${teamDetails.teamMemberCount.toString()}`);
  console.log(`  当前等级:     V${teamDetails.currentTier}`);
  if (teamDetails.currentTier < 9) {
    console.log(`  下一等级门槛: ${ethers.formatEther(teamDetails.nextTierThreshold)} USDX`);
    console.log(`  升级进度:     ${teamDetails.progressToNextTier.toString()}%`);
  } else {
    console.log(`  已达最高等级!`);
  }

  // 3. 查询质押笔数和本金
  console.log("\n" + "-".repeat(60));
  console.log("【个人质押记录】");
  console.log("-".repeat(60));

  const count = await staking.stakeCount(TARGET_ADDRESS);
  const principal = await staking.principalBalance(TARGET_ADDRESS);
  console.log(`  质押笔数: ${count.toString()}`);
  console.log(`  活跃本金: ${ethers.formatEther(principal)} USDX`);

  // 4. 查询每笔质押详情
  if (count > 0n) {
    console.log("\n  --- 质押订单明细 ---");
    try {
      const records = await staking.getUserStakeRecords(TARGET_ADDRESS);
      for (let i = 0; i < records.length; i++) {
        const r = records[i];
        const stakeDate = new Date(Number(r.stakeTime) * 1000).toLocaleString("zh-CN");
        const tierName = STAKE_TIERS[r.stakeIndex] || `档位${r.stakeIndex}`;
        const status = r.status ? "已提取" : "活跃";

        console.log(`\n  [${i + 1}] ${tierName} | ${status}`);
        console.log(`      本金:     ${ethers.formatEther(r.amount)} USDX`);
        console.log(`      当前价值: ${ethers.formatEther(r.currentValue)} USDX`);
        console.log(`      已赚利息: ${ethers.formatEther(r.earnedInterest)} USDX`);
        console.log(`      已提利息: ${ethers.formatEther(r.withdrawnInterestAmount)} USDX`);
        console.log(`      质押时间: ${stakeDate}`);
        console.log(`      可提取:   ${r.canWithdraw ? "是" : "否"}`);
        if (r.timeRemaining > 0n) {
          const days = Number(r.timeRemaining) / 86400;
          console.log(`      剩余时间: ${days.toFixed(2)} 天`);
        }
      }
    } catch (e) {
      console.log(`  (查询订单明细失败: ${e.message})`);
    }
  }

  console.log("\n" + "=".repeat(60));
  console.log("  查询完成");
  console.log("=".repeat(60));
}

main().catch((error) => {
  console.error("查询失败:", error.message);
  process.exitCode = 1;
});
