/**
 * 模块 5：团队等级与 KPI 测试 - 第一部分
 * 测试项 5.1 ~ 5.5
 *
 * 测试内容：
 * - 5.1 团队 KPI 计算（下级质押后上级 teamKPI 增加，不含自身）
 * - 5.2 多级 KPI 累计（A→B→C，C 质押后 B 和 A 的 teamKPI 都增加）
 * - 5.3 V1-V9 KPI 门槛值验证
 * - 5.4 个人质押等级门槛验证
 * - 5.5 双维度取低（团队 KPI V5 + 个人质押 V2 = 实际等级 V2）
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
const { advanceTimeSeconds, takeSnapshot, revertSnapshot } = require("../helpers/time");

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
  console.log("\n=== 模块 5：团队等级与 KPI 测试 - 第一部分 (5.1~5.5) ===\n");

  const snapshotId = await takeSnapshot();

  const deployment = loadDeployment();
  const { ae, staking, usdx } = await getContracts(deployment);
  const [deployer] = await hre.ethers.getSigners();
  const stakingAddress = deployment.contracts.Staking;
  const rootAddress = deployment.addresses.rootAddress;
  const parseEther = hre.ethers.parseEther;
  const formatEther = hre.ethers.formatEther;

  // 创建随机钱包，确保全新状态
  console.log("  准备测试钱包...");
  const userA = await createFundedWallet();
  const userB = await createFundedWallet();
  const userC = await createFundedWallet();
  const userD = await createFundedWallet();
  const helpers = [];
  for (let i = 0; i < 8; i++) {
    helpers.push(await createFundedWallet());
  }
  console.log("  钱包准备完成\n");

  const runner = new TestRunner("模块 5：团队等级与 KPI - 第一部分");

  // 准备所有用户余额和授权
  const allUsers = [userA, userB, userC, userD, ...helpers];
  for (const u of allUsers) {
    await prepareUser(usdx, u, stakingAddress, parseEther("50000"));
  }

  // 建立推荐链: root <- userA <- userB <- userC
  await safeBindReferral(staking, userA, rootAddress);
  await safeBindReferral(staking, userB, userA.address);
  await safeBindReferral(staking, userC, userB.address);

  // =========================================================================
  // 5.1 团队 KPI 计算：下级质押后，上级 teamKPI 增加（不含自身）
  // =========================================================================
  await runner.run("5.1", "团队 KPI 计算（下级质押增加上级 KPI，不含自身）", async () => {
    const kpiBefore_A = await staking.getTeamKpi(userA.address);
    const kpiBefore_B = await staking.getTeamKpi(userB.address);

    // userC 质押 500 USDT
    await advanceTimeSeconds(120);
    await staking.connect(userC).stake(parseEther("500"), 1);

    const kpiAfter_A = await staking.getTeamKpi(userA.address);
    const kpiAfter_B = await staking.getTeamKpi(userB.address);
    const kpiAfter_C = await staking.getTeamKpi(userC.address);

    // userB 的 KPI 应增加 500（userC 是 userB 的下级）
    assert(kpiAfter_B - kpiBefore_B === parseEther("500"),
      `userB KPI 应增加 500, 实际增加 ${formatEther(kpiAfter_B - kpiBefore_B)}`);

    // userA 的 KPI 也应增加 500（userC 是 userA 的间接下级）
    assert(kpiAfter_A - kpiBefore_A === parseEther("500"),
      `userA KPI 应增加 500, 实际增加 ${formatEther(kpiAfter_A - kpiBefore_A)}`);

    // userC 自身的 KPI 不应因自己质押而增加
    assertEq(kpiAfter_C, 0n, "userC 自身 KPI 应为 0（无下级）");
  });

  // =========================================================================
  // 5.2 多级 KPI 累计：A→B→C，C 质押后 B 和 A 的 teamKPI 都增加
  // =========================================================================
  await runner.run("5.2", "多级 KPI 累计（多级推荐链 KPI 传递）", async () => {
    // userA 自己也质押 300，验证自身质押不影响自己的 teamKPI
    const kpiBefore_A = await staking.getTeamKpi(userA.address);
    await advanceTimeSeconds(120);
    await staking.connect(userA).stake(parseEther("300"), 2);
    const kpiAfter_A = await staking.getTeamKpi(userA.address);

    // userA 自身质押不应增加自己的 teamKPI
    assertEq(kpiAfter_A, kpiBefore_A,
      "userA 自身质押不应增加自己的 teamKPI");

    // userB 质押 500，验证 userA 的 KPI 增加
    const kpiBefore_A2 = await staking.getTeamKpi(userA.address);
    await advanceTimeSeconds(120);
    await staking.connect(userB).stake(parseEther("500"), 1);
    const kpiAfter_A2 = await staking.getTeamKpi(userA.address);

    assert(kpiAfter_A2 - kpiBefore_A2 === parseEther("500"),
      `userB 质押后 userA KPI 应增加 500, 实际增加 ${formatEther(kpiAfter_A2 - kpiBefore_A2)}`);

    // 验证总 KPI：userA 的 KPI = userB 质押 + userC 质押
    const totalKPI_A = await staking.getTeamKpi(userA.address);
    console.log(`     userA teamKPI: ${formatEther(totalKPI_A)} (应为 1000 = 500+500)`);
    assert(totalKPI_A === parseEther("1000"),
      `userA 总 KPI 应为 1000, 实际 ${formatEther(totalKPI_A)}`);
  });

  // =========================================================================
  // 5.3 V1-V9 KPI 门槛值验证
  // =========================================================================
  await runner.run("5.3", "V1-V9 KPI 门槛值验证", async () => {
    const thresholds = await staking.getTeamRewardThresholds();
    // getTeamRewardThresholds 返回的顺序是 _getTeamTiers 的顺序：V9, V8, ..., V1
    const expectedThresholds = [
      parseEther("30000000"), // V9
      parseEther("10000000"), // V8
      parseEther("3000000"),  // V7
      parseEther("1000000"),  // V6
      parseEther("300000"),   // V5
      parseEther("100000"),   // V4
      parseEther("30000"),    // V3
      parseEther("10000"),    // V2
      parseEther("3000"),     // V1
    ];

    for (let i = 0; i < 9; i++) {
      assertEq(thresholds[i], expectedThresholds[i],
        `门槛[${i}] 应为 ${formatEther(expectedThresholds[i])}, 实际 ${formatEther(thresholds[i])}`);
    }
    console.log("     KPI 门槛: 3k/10k/30k/100k/300k/1M/3M/10M/30M ✓");
  });

  // =========================================================================
  // 5.4 个人质押等级门槛验证
  // =========================================================================
  await runner.run("5.4", "个人质押等级门槛验证", async () => {
    const rates = await staking.getTeamRewardRates();
    const expectedRates = [3n, 7n, 11n, 15n, 19n, 23n, 27n, 31n, 35n];

    for (let i = 0; i < 9; i++) {
      assertEq(rates[i], expectedRates[i],
        `奖励比例[${i}] 应为 ${expectedRates[i]}%, 实际 ${rates[i]}%`);
    }
    console.log("     奖励比例: 3%/7%/11%/15%/19%/23%/27%/31%/35% ✓");

    // 验证个人质押等级：通过 getTeamPerformanceDetails 间接验证
    // 用户 userA 当前质押 300 USDT，个人质押等级应为 V2 (>=300)
    // 但 teamKPI = 1000，KPI 等级为 V0 (<3000)
    // 最终等级 = min(V2, V0) = V0
    const details = await staking.getTeamPerformanceDetails(userA.address);
    console.log(`     userA: teamInvest=${formatEther(details.totalTeamInvestment)}, tier=${details.currentTier}`);
    // userA KPI=1000 < 3000(V1), 所以 KPI 等级=V0, 最终等级=V0
    assertEq(Number(details.currentTier), 0,
      `userA 等级应为 V0 (KPI=1000 < V1门槛3000)`);
  });

  // =========================================================================
  // 5.5 双维度取低：团队 KPI 达到高等级 + 个人质押低等级 = 取低
  // =========================================================================
  await runner.run("5.5", "双维度取低（KPI 高 + 个人质押低 = 取低等级）", async () => {
    // 为 userD 构建高 KPI 场景
    // userD 绑定到 root
    await safeBindReferral(staking, userD, rootAddress);

    // 让多个 helper 用户绑定到 userD 并质押，构建 KPI
    // 需要 KPI >= 3000 (V1)，让 helpers 各质押 500，需要 6 个 helper
    let helperIdx = 0;
    for (let i = 0; i < 6; i++) {
      const h = helpers[helperIdx++];
      await safeBindReferral(staking, h, userD.address);
      await stakeAmount(staking, h, parseEther("500"), parseEther);
    }

    const kpiD = await staking.getTeamKpi(userD.address);
    console.log(`     userD teamKPI: ${formatEther(kpiD)}`);
    assert(kpiD >= parseEther("3000"), `userD KPI 应 >= 3000, 实际 ${formatEther(kpiD)}`);

    // userD 自身不质押 → 个人质押等级 V0
    // KPI 等级 >= V1，但个人质押 V0 → 最终等级 V0
    let details = await staking.getTeamPerformanceDetails(userD.address);
    assertEq(Number(details.currentTier), 0,
      `userD 未质押时等级应为 V0, 实际 V${details.currentTier}`);

    // userD 质押 100 USDT → 个人质押等级 V1 (>=100)
    // KPI 等级 >= V1 → 最终等级 = min(V1, V1) = V1
    await advanceTimeSeconds(120);
    await staking.connect(userD).stake(parseEther("100"), 1);
    details = await staking.getTeamPerformanceDetails(userD.address);
    console.log(`     userD 质押100后: tier=${details.currentTier}`);
    assertEq(Number(details.currentTier), 1,
      `userD 质押100后等级应为 V1, 实际 V${details.currentTier}`);

    // 再质押到 300 → 个人质押等级 V2 (>=300)
    // 但 KPI 可能只到 V1 (3000~9999)，所以最终等级 = min(V2, V1) = V1
    await advanceTimeSeconds(120);
    await staking.connect(userD).stake(parseEther("200"), 2);
    details = await staking.getTeamPerformanceDetails(userD.address);
    const personalStake = await staking.principalBalance(userD.address);
    console.log(`     userD 质押300后: personalStake=${formatEther(personalStake)}, KPI=${formatEther(kpiD)}, tier=${details.currentTier}`);

    // 最终等级 = min(个人质押等级, KPI等级)
    // 个人质押 300 → V2, KPI 3000 → V1 → 最终 V1
    assertEq(Number(details.currentTier), 1,
      `双维度取低: 个人V2 + KPI V1 = V1, 实际 V${details.currentTier}`);
  });

  const allPassed = runner.summary();
  await revertSnapshot(snapshotId);
  if (!allPassed) process.exit(1);
}

main()
  .then(() => process.exit(0))
  .catch((error) => { console.error(error); process.exit(1); });
