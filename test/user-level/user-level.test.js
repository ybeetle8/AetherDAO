/**
 * 用户等级查询测试
 *
 * 测试内容：
 * - 从链上查询用户等级（通过 getTeamPerformanceDetails）
 * - 打印用户等级信息
 */
const hre = require("hardhat");
const {
  loadDeployment,
  getContracts,
  setUSDXBalance,
  approveUSDX,
  TestRunner,
} = require("../helpers/setup");
const { advanceTimeSeconds, takeSnapshot, revertSnapshot } = require("../helpers/time");

async function createFundedWallet() {
  const wallet = hre.ethers.Wallet.createRandom().connect(hre.ethers.provider);
  // 直接通过 hardhat_setBalance 设置 BNB，避免 funder 余额不足
  await hre.network.provider.send("hardhat_setBalance", [
    wallet.address,
    "0x56BC75E2D63100000", // 100 BNB
  ]);
  return wallet;
}

async function main() {
  console.log("\n=== 用户等级查询测试 ===\n");

  const snapshotId = await takeSnapshot();

  const deployment = loadDeployment();
  const { staking, usdx } = await getContracts(deployment);
  const stakingAddress = deployment.contracts.Staking;
  const rootAddress = deployment.addresses.rootAddress;
  const parseEther = hre.ethers.parseEther;
  const formatEther = hre.ethers.formatEther;

  const runner = new TestRunner("用户等级查询");

  // 创建测试用户
  const user = await createFundedWallet();
  console.log(`  测试用户地址: ${user.address}`);

  // 准备余额和授权
  await setUSDXBalance(user.address, parseEther("50000"));
  await approveUSDX(usdx, user, stakingAddress, parseEther("50000"));

  // 绑定推荐人到 root
  await staking.connect(user).lockReferral(rootAddress);

  // =========================================================================
  // 查询未质押时的等级
  // =========================================================================
  await runner.run("1", "查询未质押用户等级", async () => {
    const details = await staking.getTeamPerformanceDetails(user.address);
    console.log(`     当前等级: V${details.currentTier}`);
    console.log(`     团队投资总额: ${formatEther(details.totalTeamInvestment)}`);
    console.log(`     团队人数: ${details.teamMemberCount}`);
    console.log(`     下一等级门槛: ${formatEther(details.nextTierThreshold)}`);
    console.log(`     升级进度: ${details.progressToNextTier}%`);
  });

  // =========================================================================
  // 质押后查询等级
  // =========================================================================
  await runner.run("2", "质押 300 USDX 后查询用户等级", async () => {
    await advanceTimeSeconds(120);
    await staking.connect(user).stake(parseEther("300"), 1);

    const details = await staking.getTeamPerformanceDetails(user.address);
    console.log(`     当前等级: V${details.currentTier}`);
    console.log(`     团队投资总额: ${formatEther(details.totalTeamInvestment)}`);
    console.log(`     下一等级门槛: ${formatEther(details.nextTierThreshold)}`);
    console.log(`     升级进度: ${details.progressToNextTier}%`);

    // 个人质押 300 >= V2 门槛(300)，但团队 KPI=0 < V1 门槛(3000)
    // 双维度取低 → V0
    console.log(`     (个人质押达 V2，但团队 KPI 为 0，双维度取低 → V0)`);
  });

  // =========================================================================
  // 也可以通过 getUserInfo 获取原始数据
  // =========================================================================
  await runner.run("3", "通过 getUserInfo 查询用户信息", async () => {
    const info = await staking.getUserInfo(user.address);
    console.log(`     totalStaked: ${formatEther(info.totalStaked)}`);
    console.log(`     teamKPI: ${formatEther(info.teamKPI)}`);
    console.log(`     referrer: ${info.referrer}`);
    console.log(`     hasLockedReferral: ${info.hasLockedReferral}`);
    console.log(`     isPreacherStatus: ${info.isPreacherStatus}`);
  });

  const allPassed = runner.summary();
  await revertSnapshot(snapshotId);
  if (!allPassed) process.exit(1);
}

main()
  .then(() => process.exit(0))
  .catch((error) => { console.error(error); process.exit(1); });
