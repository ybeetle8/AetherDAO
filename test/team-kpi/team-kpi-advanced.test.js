/**
 * 模块 5：团队等级与 KPI 测试 - 第二部分
 * 测试项 5.6 ~ 5.9
 *
 * 测试内容：
 * - 5.6 等级动态变化（赎回后个人质押减少，等级下降）
 * - 5.7 getTeamPerformanceDetails 返回值验证
 * - 5.8 getTeamRewardThresholds 验证返回 9 个 KPI 门槛值
 * - 5.9 getTeamRewardRates 验证返回 9 个奖励比例
 */
const hre = require("hardhat");
const {
  loadDeployment,
  getContracts,
  setUSDXBalance,
  approveUSDX,
  TestRunner,
  assert,
  assertEq,
} = require("../helpers/setup");
const { advanceTime, advanceTimeSeconds, takeSnapshot, revertSnapshot } = require("../helpers/time");

/** 创建一个有 BNB 的随机钱包 */
async function createFundedWallet() {
  const wallet = hre.ethers.Wallet.createRandom().connect(hre.ethers.provider);
  const [funder] = await hre.ethers.getSigners();
  await funder.sendTransaction({ to: wallet.address, value: hre.ethers.parseEther("1") });
  return wallet;
}

async function safeBindReferral(staking, user, referrer) {
  const isBound = await staking.isBindReferral(user.address);
  if (!isBound) {
    await staking.connect(user).lockReferral(referrer);
  }
}

async function prepareUser(usdx, user, stakingAddress, amount) {
  await setUSDXBalance(user.address, amount);
  await approveUSDX(usdx, user, stakingAddress, amount);
}

async function stakeAmount(staking, user, totalAmount, parseEther) {
  let remaining = totalAmount;
  let idx = 1;
  while (remaining > 0n) {
    await advanceTimeSeconds(120);
    const maxStake = await staking.maxStakeAmount();
    const capacity = await staking.getRemainingStakeCapacity(user.address);
    const canStake = maxStake < capacity ? maxStake : capacity;
    const amt = canStake < remaining ? canStake : remaining;
    if (amt < parseEther("100")) break;
    await staking.connect(user).stake(amt, (idx % 4) + 1);
    remaining -= amt;
    idx++;
  }
}

async function main() {
  console.log("\n=== 模块 5：团队等级与 KPI 测试 - 第二部分 (5.6~5.9) ===\n");

  const snapshotId = await takeSnapshot();

  const deployment = loadDeployment();
  const { ae, staking, usdx } = await getContracts(deployment);
  const [deployer] = await hre.ethers.getSigners();
  const stakingAddress = deployment.contracts.Staking;
  const rootAddress = deployment.addresses.rootAddress;
  const parseEther = hre.ethers.parseEther;
  const formatEther = hre.ethers.formatEther;

  // 创建随机钱包
  console.log("  准备测试钱包...");
  const userA = await createFundedWallet();
  const userB = await createFundedWallet();
  const userC = await createFundedWallet();
  const userD = await createFundedWallet();
  const helpers = [];
  for (let i = 0; i < 16; i++) {
    helpers.push(await createFundedWallet());
  }
  console.log("  钱包准备完成\n");

  const runner = new TestRunner("模块 5：团队等级与 KPI - 第二部分");

  // 准备所有用户
  const allUsers = [userA, userB, userC, userD, ...helpers];
  for (const u of allUsers) {
    await prepareUser(usdx, u, stakingAddress, parseEther("50000"));
  }

  // 建立推荐链: root <- userA <- userB <- userC
  await safeBindReferral(staking, userA, rootAddress);
  await safeBindReferral(staking, userB, userA.address);
  await safeBindReferral(staking, userC, userB.address);

  // =========================================================================
  // 5.6 等级动态变化：赎回后个人质押减少，等级下降
  // =========================================================================
  await runner.run("5.6", "等级动态变化（赎回后等级下降）", async () => {
    // 为 userA 构建足够的 KPI（让 helpers 绑定到 userA 并质押）
    let helperIdx = 0;
    for (let i = 0; i < 8; i++) {
      const h = helpers[helperIdx++];
      await safeBindReferral(staking, h, userA.address);
      await stakeAmount(staking, h, parseEther("500"), parseEther);
    }

    const kpiA = await staking.getTeamKpi(userA.address);
    console.log(`     userA teamKPI: ${formatEther(kpiA)}`);

    // userA 质押 300 USDT（使用 7 天期限，方便快速到期赎回）
    await advanceTimeSeconds(120);
    await staking.connect(userA).stake(parseEther("300"), 0); // 7天期限

    let details = await staking.getTeamPerformanceDetails(userA.address);
    const tierBefore = Number(details.currentTier);
    console.log(`     userA 质押300后等级: V${tierBefore}`);

    // 快进 8 天让质押到期
    await advanceTime(8);

    // 赎回第一笔质押（index 0）
    await staking.connect(userA).unstake(0);

    // 赎回后个人质押减少，等级应下降
    details = await staking.getTeamPerformanceDetails(userA.address);
    const tierAfter = Number(details.currentTier);
    const personalStake = await staking.principalBalance(userA.address);
    console.log(`     userA 赎回后: personalStake=${formatEther(personalStake)}, tier=V${tierAfter}`);

    assert(tierAfter <= tierBefore,
      `赎回后等级应 <= 赎回前等级: V${tierAfter} vs V${tierBefore}`);
    // 赎回后个人质押为 0，等级应为 V0
    assertEq(tierAfter, 0, `赎回后个人质押为0，等级应为 V0, 实际 V${tierAfter}`);
  });

  // =========================================================================
  // 5.7 getTeamPerformanceDetails 返回值验证
  // =========================================================================
  await runner.run("5.7", "getTeamPerformanceDetails 返回值验证", async () => {
    // 为 userD 构建场景
    await safeBindReferral(staking, userD, rootAddress);

    // 让几个 helper 绑定到 userD 并质押
    const kpiHelpers = helpers.slice(8, 12);
    for (const h of kpiHelpers) {
      await safeBindReferral(staking, h, userD.address);
      await stakeAmount(staking, h, parseEther("500"), parseEther);
    }

    // userD 自己质押 100
    await advanceTimeSeconds(120);
    await staking.connect(userD).stake(parseEther("100"), 1);

    const details = await staking.getTeamPerformanceDetails(userD.address);

    // 验证返回值结构
    console.log(`     totalTeamInvestment: ${formatEther(details.totalTeamInvestment)}`);
    console.log(`     teamMemberCount: ${details.teamMemberCount}`);
    console.log(`     currentTier: V${details.currentTier}`);
    console.log(`     nextTierThreshold: ${formatEther(details.nextTierThreshold)}`);
    console.log(`     progressToNextTier: ${details.progressToNextTier}%`);

    // totalTeamInvestment 应 > 0（有下级质押）
    assert(details.totalTeamInvestment > 0n,
      "totalTeamInvestment 应 > 0");

    // teamMemberCount 应 = 绑定到 userD 的直接下级数
    assertEq(Number(details.teamMemberCount), kpiHelpers.length,
      `teamMemberCount 应为 ${kpiHelpers.length}`);

    // currentTier 应为有效值 (0~9)
    assert(Number(details.currentTier) >= 0 && Number(details.currentTier) <= 9,
      `currentTier 应在 0~9 范围内, 实际 ${details.currentTier}`);

    // 如果 currentTier < 9，nextTierThreshold 应 > 0
    if (Number(details.currentTier) < 9) {
      assert(details.nextTierThreshold > 0n,
        "未达 V9 时 nextTierThreshold 应 > 0");
      // progressToNextTier 应 = totalTeamInvestment * 100 / nextTierThreshold
      const expectedProgress = (details.totalTeamInvestment * 100n) / details.nextTierThreshold;
      assertEq(details.progressToNextTier, expectedProgress,
        `进度应为 ${expectedProgress}%, 实际 ${details.progressToNextTier}%`);
    }
  });

  // =========================================================================
  // 5.8 getTeamRewardThresholds 验证返回 9 个 KPI 门槛值
  // =========================================================================
  await runner.run("5.8", "getTeamRewardThresholds 返回 9 个门槛值", async () => {
    const thresholds = await staking.getTeamRewardThresholds();

    // 应返回 9 个值
    assertEq(thresholds.length, 9, "应返回 9 个门槛值");

    // 验证具体值（降序排列：V9, V8, ..., V1）
    const expected = [
      "30000000", "10000000", "3000000", "1000000", "300000",
      "100000", "30000", "10000", "3000"
    ];

    for (let i = 0; i < 9; i++) {
      assertEq(thresholds[i], parseEther(expected[i]),
        `门槛[${i}] 应为 ${expected[i]}`);
    }

    // 验证降序排列
    for (let i = 0; i < 8; i++) {
      assert(thresholds[i] > thresholds[i + 1],
        `门槛应降序: [${i}]=${formatEther(thresholds[i])} > [${i+1}]=${formatEther(thresholds[i+1])}`);
    }
  });

  // =========================================================================
  // 5.9 getTeamRewardRates 验证返回 9 个奖励比例
  // =========================================================================
  await runner.run("5.9", "getTeamRewardRates 返回 9 个奖励比例", async () => {
    const rates = await staking.getTeamRewardRates();

    // 应返回 9 个值
    assertEq(rates.length, 9, "应返回 9 个奖励比例");

    // 验证具体值（升序：V1=3%, V2=7%, ..., V9=35%）
    const expected = [3n, 7n, 11n, 15n, 19n, 23n, 27n, 31n, 35n];

    for (let i = 0; i < 9; i++) {
      assertEq(rates[i], expected[i],
        `奖励比例[${i}] 应为 ${expected[i]}%`);
    }

    // 验证升序排列
    for (let i = 0; i < 8; i++) {
      assert(rates[i] < rates[i + 1],
        `比例应升序: [${i}]=${rates[i]}% < [${i+1}]=${rates[i+1]}%`);
    }

    // 验证最高比例为 35%
    assertEq(rates[8], 35n, "V9 最高奖励比例应为 35%");
  });

  const allPassed = runner.summary();
  await revertSnapshot(snapshotId);
  if (!allPassed) process.exit(1);
}

main()
  .then(() => process.exit(0))
  .catch((error) => { console.error(error); process.exit(1); });
