/**
 * 模块 9：View 函数与查询 - 高级测试 (9.11 ~ 9.20)
 *
 * 测试配置查询、提取历史、动态限额、滑点配置、预览等
 *
 * 运行: npx hardhat run test/view-functions/view-advanced.test.js --network localhost
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
  assertApproxEq,
} = require("../helpers/setup");
const { advanceTimeSeconds, takeSnapshot, revertSnapshot } = require("../helpers/time");

const parseEther = hre.ethers.parseEther;
const formatEther = hre.ethers.formatEther;

async function safeBindReferral(staking, user, referrer) {
  const isBound = await staking.isBindReferral(user.address);
  if (!isBound) {
    await staking.connect(user).lockReferral(referrer);
  }
}

async function prepareUser(usdx, staking, user, stakingAddress, rootAddress) {
  await setUSDXBalance(user.address, parseEther("50000"));
  await approveUSDX(usdx, user, stakingAddress, parseEther("50000"));
  await safeBindReferral(staking, user, rootAddress);
}

async function main() {
  console.log("\n=== 模块 9：View 函数与查询 - 高级测试 (9.11~9.20) ===\n");

  const deployment = loadDeployment();
  const { ae, staking, pair, usdx } = await getContracts(deployment);
  const [deployer, ...accounts] = await hre.ethers.getSigners();
  const stakingAddress = deployment.contracts.Staking;
  const rootAddress = deployment.addresses.rootAddress;

  const runner = new TestRunner("模块 9：View 函数与查询 (高级)");

  // =========================================================================
  // 9.11 getMaxUserTotalStake: 返回 10000 USDT
  // =========================================================================
  await runner.run("9.11", "getMaxUserTotalStake 返回 10000 USDT", async () => {
    const maxTotal = await staking.getMaxUserTotalStake();
    console.log(`     getMaxUserTotalStake: ${formatEther(maxTotal)}`);
    assertEq(maxTotal, parseEther("10000"), "用户总质押上限应为 10000 USDT");
  });

  // =========================================================================
  // 9.12 getStakePeriods: 返回 5 个期限的秒数
  // =========================================================================
  await runner.run("9.12", "getStakePeriods 返回 5 个期限秒数", async () => {
    const periods = await staking.getStakePeriods();
    const expected = [
      7n * 24n * 60n * 60n,    // 7 天
      30n * 24n * 60n * 60n,   // 30 天
      90n * 24n * 60n * 60n,   // 90 天
      180n * 24n * 60n * 60n,  // 180 天
      365n * 24n * 60n * 60n,  // 365 天
    ];
    for (let i = 0; i < 5; i++) {
      const days = Number(periods[i]) / 86400;
      console.log(`     期限 ${i}: ${days} 天 (${periods[i]} 秒)`);
      assertEq(periods[i], expected[i], `期限 ${i} 应为 ${expected[i]} 秒`);
    }
  });

  // =========================================================================
  // 9.13 getUserStakeWithdrawalStatus: 验证返回所有质押的索引、可赎回状态、剩余时间
  // =========================================================================
  const snap13 = await takeSnapshot();
  await runner.run("9.13", "getUserStakeWithdrawalStatus 返回完整状态", async () => {
    const user = accounts[3];
    await prepareUser(usdx, staking, user, stakingAddress, rootAddress);

    const countBefore = Number(await staking.stakeCount(user.address));

    // 质押两笔不同期限
    await staking.connect(user).stake(parseEther("200"), 0); // 7天期
    await advanceTimeSeconds(120);
    await staking.connect(user).stake(parseEther("300"), 2); // 90天期

    // 推进 8 天（第一笔到期，第二笔未到期）
    await advanceTimeSeconds(8 * 24 * 60 * 60);

    const status = await staking.getUserStakeWithdrawalStatus(user.address);
    const indices = status[0];
    const canWithdrawArr = status[1];
    const timeRemaining = status[2];

    console.log(`     质押笔数: ${indices.length}`);
    assert(indices.length >= 2, "应至少有 2 笔质押记录");

    // 找到我们新增的两笔
    const idx1 = countBefore;     // 7天期
    const idx2 = countBefore + 1; // 90天期

    // 在返回数组中查找对应索引
    let found7d = false, found90d = false;
    for (let i = 0; i < indices.length; i++) {
      if (Number(indices[i]) === idx1) {
        found7d = true;
        assertEq(canWithdrawArr[i], true, "7天期质押 8天后应可赎回");
        assertEq(timeRemaining[i], 0n, "7天期到期后剩余时间应为 0");
        console.log(`     7天期 (index ${idx1}): canWithdraw=${canWithdrawArr[i]}, remaining=${timeRemaining[i]}`);
      }
      if (Number(indices[i]) === idx2) {
        found90d = true;
        assertEq(canWithdrawArr[i], false, "90天期质押 8天后不应可赎回");
        assert(timeRemaining[i] > 0n, "90天期应有剩余时间");
        console.log(`     90天期 (index ${idx2}): canWithdraw=${canWithdrawArr[i]}, remaining=${timeRemaining[i]}s`);
      }
    }
    assert(found7d, "应找到 7天期质押记录");
    assert(found90d, "应找到 90天期质押记录");
  });
  await revertSnapshot(snap13);

  // =========================================================================
  // 9.14 getWithdrawalHistory: 赎回后验证历史记录完整
  // =========================================================================
  const snap14 = await takeSnapshot();
  await runner.run("9.14", "getWithdrawalHistory 赎回后包含记录", async () => {
    const user = accounts[4];
    await prepareUser(usdx, staking, user, stakingAddress, rootAddress);

    const countBefore = Number(await staking.stakeCount(user.address));

    // 质押 300 USDT (30天期)
    await staking.connect(user).stake(parseEther("300"), 1);

    // 推进 31 天
    await advanceTimeSeconds(31 * 24 * 60 * 60);

    // 赎回
    await staking.connect(user).unstake(countBefore);

    const history = await staking.getWithdrawalHistory(user.address);
    console.log(`     提取历史记录数: ${history.length}`);
    assert(history.length > 0, "赎回后应有提取历史记录");

    const lastRecord = history[history.length - 1];
    console.log(`     最后一条记录 - 本金: ${formatEther(lastRecord.principalAmount)}, 用户到手: ${formatEther(lastRecord.userPayout)}`);
    assertEq(lastRecord.principalAmount, parseEther("300"), "记录中本金应为 300");
    assert(lastRecord.userPayout > 0n, "用户到手金额应 > 0");
    assert(lastRecord.withdrawalTime > 0n, "提取时间应 > 0");
  });
  await revertSnapshot(snap14);

  // =========================================================================
  // 9.15 getWithdrawalCount: 验证提取次数计数正确
  // =========================================================================
  const snap15 = await takeSnapshot();
  await runner.run("9.15", "getWithdrawalCount 计数正确", async () => {
    const user = accounts[5];
    await prepareUser(usdx, staking, user, stakingAddress, rootAddress);

    const countBefore = await staking.getWithdrawalCount(user.address);
    console.log(`     赎回前 withdrawalCount: ${countBefore}`);

    const stakeIdx = Number(await staking.stakeCount(user.address));

    // 质押并赎回
    await staking.connect(user).stake(parseEther("300"), 1);
    await advanceTimeSeconds(31 * 24 * 60 * 60);
    await staking.connect(user).unstake(stakeIdx);

    const countAfter = await staking.getWithdrawalCount(user.address);
    console.log(`     赎回后 withdrawalCount: ${countAfter}`);
    assertEq(countAfter, countBefore + 1n, "赎回后 withdrawalCount 应 +1");
  });
  await revertSnapshot(snap15);

  // =========================================================================
  // 9.16 getWithdrawalRecord: 验证指定索引的提取记录
  // =========================================================================
  const snap16 = await takeSnapshot();
  await runner.run("9.16", "getWithdrawalRecord 返回指定索引记录", async () => {
    const user = accounts[6];
    await prepareUser(usdx, staking, user, stakingAddress, rootAddress);

    const stakeIdx = Number(await staking.stakeCount(user.address));

    await staking.connect(user).stake(parseEther("500"), 1);
    await advanceTimeSeconds(31 * 24 * 60 * 60);
    await staking.connect(user).unstake(stakeIdx);

    const wCount = await staking.getWithdrawalCount(user.address);
    const record = await staking.getWithdrawalRecord(user.address, wCount - 1n);

    console.log(`     记录索引: ${wCount - 1n}`);
    console.log(`     stakeIndex: ${record.stakeIndex}`);
    console.log(`     principalAmount: ${formatEther(record.principalAmount)}`);
    console.log(`     userPayout: ${formatEther(record.userPayout)}`);
    console.log(`     interestEarned: ${formatEther(record.interestEarned)}`);

    assertEq(record.principalAmount, parseEther("500"), "本金应为 500");
    assert(record.userPayout > 0n, "用户到手应 > 0");
    assert(record.withdrawalTime > 0n, "提取时间应 > 0");
  });
  await revertSnapshot(snap16);

  // =========================================================================
  // 9.17 maxStakeAmount: 验证动态最大质押额计算
  // =========================================================================
  await runner.run("9.17", "maxStakeAmount 动态最大质押额", async () => {
    const maxAmount = await staking.maxStakeAmount();
    console.log(`     maxStakeAmount: ${formatEther(maxAmount)}`);
    // 动态最大质押额 = min(1000, 池子1% - 近期流入)
    // 应 > 0 且 <= 1000
    assert(maxAmount > 0n, "maxStakeAmount 应 > 0");
    assert(maxAmount <= parseEther("1000"), "maxStakeAmount 应 <= 1000 USDT");
  });

  // =========================================================================
  // 9.18 getRecentNetworkInflow: 验证近期网络流入量
  // =========================================================================
  const snap18 = await takeSnapshot();
  await runner.run("9.18", "getRecentNetworkInflow 返回近期流入量", async () => {
    const inflowBefore = await staking.getRecentNetworkInflow();
    console.log(`     质押前 recentNetworkInflow: ${formatEther(inflowBefore)}`);

    // 进行一笔质押
    const user = accounts[7];
    await prepareUser(usdx, staking, user, stakingAddress, rootAddress);
    await staking.connect(user).stake(parseEther("300"), 1);

    const inflowAfter = await staking.getRecentNetworkInflow();
    console.log(`     质押后 recentNetworkInflow: ${formatEther(inflowAfter)}`);
    assert(inflowAfter >= inflowBefore, "质押后网络流入量应 >= 之前");
  });
  await revertSnapshot(snap18);

  // =========================================================================
  // 9.19 getSlippageConfig: 验证滑点配置 base 15%, max 20%, impact 2%
  // =========================================================================
  await runner.run("9.19", "getSlippageConfig 返回正确滑点配置", async () => {
    const config = await staking.getSlippageConfig();
    const baseSlippage = config[0];
    const maxSlippage = config[1];
    const priceImpactThreshold = config[2];

    console.log(`     baseSlippage: ${baseSlippage} (${Number(baseSlippage) / 100}%)`);
    console.log(`     maxSlippage: ${maxSlippage} (${Number(maxSlippage) / 100}%)`);
    console.log(`     priceImpactThreshold: ${priceImpactThreshold} (${Number(priceImpactThreshold) / 100}%)`);

    assertEq(baseSlippage, 1500n, "baseSlippage 应为 1500 (15%)");
    assertEq(maxSlippage, 2000n, "maxSlippage 应为 2000 (20%)");
    assertEq(priceImpactThreshold, 200n, "priceImpactThreshold 应为 200 (2%)");
  });

  // =========================================================================
  // 9.20 previewStakeOutput: 验证预览质押输出的 USDT/AE 分配
  // =========================================================================
  await runner.run("9.20", "previewStakeOutput 预览质押输出", async () => {
    const inputAmount = parseEther("500");
    const preview = await staking.previewStakeOutput(inputAmount);
    const halfUsdtAmount = preview[0];
    const expectedAE = preview[1];
    const minAEOut = preview[2];

    console.log(`     输入: ${formatEther(inputAmount)} USDT`);
    console.log(`     halfUsdtAmount: ${formatEther(halfUsdtAmount)} USDT`);
    console.log(`     expectedAE: ${formatEther(expectedAE)} AE`);
    console.log(`     minAEOut: ${formatEther(minAEOut)} AE`);

    // halfUsdtAmount 应为输入的一半
    assertEq(halfUsdtAmount, inputAmount / 2n, "halfUsdtAmount 应为输入的一半");
    // expectedAE 应 > 0
    assert(expectedAE > 0n, "expectedAE 应 > 0");
    // minAEOut 应 <= expectedAE（考虑滑点）
    assert(minAEOut <= expectedAE, "minAEOut 应 <= expectedAE");
    assert(minAEOut > 0n, "minAEOut 应 > 0");
  });

  const allPassed = runner.summary();
  if (!allPassed) process.exit(1);
}

main()
  .then(() => process.exit(0))
  .catch((error) => { console.error(error); process.exit(1); });
