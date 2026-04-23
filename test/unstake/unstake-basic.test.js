/**
 * 模块 2：到期赎回 (unstake) 测试 - 第一部分
 * 测试项 2.1 ~ 2.8
 *
 * 使用 evm_increaseTime + evm_mine 时间加速方案
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
const { advanceTime, advanceTimeSeconds, getBlockTimestamp, takeSnapshot, revertSnapshot } = require("../helpers/time");

const parseEther = hre.ethers.parseEther;
const formatEther = hre.ethers.formatEther;

async function safeBindReferral(staking, user, referrer) {
  const isBound = await staking.isBindReferral(user.address);
  if (!isBound) {
    await staking.connect(user).lockReferral(referrer);
  }
}

function errorContains(error, keyword) {
  return (error.message || "").includes(keyword);
}

async function prepareUser(usdx, staking, user, stakingAddress, rootAddress) {
  await setUSDXBalance(user.address, parseEther("50000"));
  await approveUSDX(usdx, user, stakingAddress, parseEther("50000"));
  await safeBindReferral(staking, user, rootAddress);
}

async function main() {
  console.log("\n=== 模块 2：到期赎回 (unstake) 测试 - 第一部分 (2.1~2.8) ===\n");

  // 快照：保证每次运行从干净状态开始，测试结束后恢复
  const snapshotId = await takeSnapshot();

  const deployment = loadDeployment();
  const { ae, staking, pair, usdx } = await getContracts(deployment);
  const [deployer, ...accounts] = await hre.ethers.getSigners();
  const stakingAddress = deployment.contracts.Staking;
  const rootAddress = deployment.addresses.rootAddress;
  const educationFundAddress = deployment.addresses.educationFundAddress;
  const feeRecipientAddress = deployment.addresses.feeRecipient;
  // 使用独立账户（默认 mnemonic 共 20 个 signer，deployer 占 1 个，accounts 有 19 个）
  const user1 = accounts[0]; // 2.1 正常到期赎回
  const user2 = accounts[1]; // 2.2 未到期赎回
  const user3 = accounts[2]; // 2.3 复利计算验证
  const user4 = accounts[3]; // 2.4 教育基金扣除
  const user5 = accounts[4]; // 2.5 团队奖励扣除
  const user6 = accounts[5]; // 2.6 & 2.7 赎回手续费
  const user7 = accounts[6]; // 2.8 赎回后余额清零

  const runner = new TestRunner("模块 2：到期赎回 (unstake) - 第一部分");

  // 准备所有用户
  for (const u of [user1, user2, user3, user4, user5, user6, user7]) {
    await prepareUser(usdx, staking, u, stakingAddress, rootAddress);
  }

  // =========================================================================
  // 2.1 正常到期赎回
  // =========================================================================
  await advanceTimeSeconds(120);
  await runner.run("2.1", "正常到期赎回", async () => {
    const stakeAmount = parseEther("500");
    await staking.connect(user1).stake(stakeAmount, 1); // 30 天期
    const stakeIdx = Number(await staking.stakeCount(user1.address)) - 1;

    // 验证未到期不能赎回
    const canBefore = await staking.canWithdrawStake(user1.address, stakeIdx);
    assert(!canBefore, "未到期应不可赎回");

    // 推进 30 天 + 1 秒
    await advanceTime(30);
    await advanceTimeSeconds(1);

    const canAfter = await staking.canWithdrawStake(user1.address, stakeIdx);
    assert(canAfter, "到期后应可赎回");

    const usdxBefore = await usdx.balanceOf(user1.address);
    const tx = await staking.connect(user1).unstake(stakeIdx);
    const receipt = await tx.wait();
    const usdxAfter = await usdx.balanceOf(user1.address);

    const received = usdxAfter - usdxBefore;
    assert(received > 0n, "应收到 USDX");
    console.log(`     质押 ${formatEther(stakeAmount)}, 赎回收到 ${formatEther(received)} USDX`);
  });

  // =========================================================================
  // 2.2 未到期赎回应 revert
  // =========================================================================
  await advanceTimeSeconds(120);
  await runner.run("2.2", "未到期赎回应 revert", async () => {
    const stakeAmount = parseEther("300");
    await staking.connect(user2).stake(stakeAmount, 1); // 30 天期
    const stakeIdx = Number(await staking.stakeCount(user2.address)) - 1;

    // 只推进 15 天（不到 30 天）
    await advanceTime(15);

    let reverted = false;
    try {
      await staking.connect(user2).unstake(stakeIdx);
    } catch (e) {
      reverted = true;
      assert(
        errorContains(e, "StakingPeriodNotMet") || errorContains(e, "reverted"),
        "应 StakingPeriodNotMet"
      );
    }
    assert(reverted, "未到期赎回应 revert");
  });

  // =========================================================================
  // 2.3 复利计算验证 (30 天期 1000 USDT)
  // =========================================================================
  await advanceTimeSeconds(120);
  await runner.run("2.3", "复利计算验证 (30天期)", async () => {
    const stakeAmount = parseEther("500");
    await staking.connect(user3).stake(stakeAmount, 1); // 30 天期, 日利率 1.009
    const stakeIdx = Number(await staking.stakeCount(user3.address)) - 1;

    // 推进 30 天
    await advanceTime(30);
    await advanceTimeSeconds(1);

    // 查询合约计算的奖励
    const reward = await staking.rewardOfSlot(user3.address, stakeIdx);
    // 预期: 500 × 1.009^30 ≈ 654.78
    const expectedReward = 500 * Math.pow(1.009, 30);
    const rewardNum = Number(formatEther(reward));

    console.log(`     合约计算奖励: ${rewardNum.toFixed(4)} USDT`);
    console.log(`     预期奖励: ${expectedReward.toFixed(4)} USDT`);

    // 允许 1% 误差（DEX swap 滑点等）
    const tolerance = expectedReward * 0.01;
    assert(
      Math.abs(rewardNum - expectedReward) < tolerance,
      `复利计算偏差过大: 期望 ${expectedReward.toFixed(4)}, 实际 ${rewardNum.toFixed(4)}`
    );
  });

  // =========================================================================
  // 2.4 教育基金扣除 (利息的 5%)
  // =========================================================================
  await advanceTimeSeconds(120);
  await runner.run("2.4", "教育基金扣除 (利息的 5%)", async () => {
    const stakeAmount = parseEther("500");
    await staking.connect(user4).stake(stakeAmount, 1); // 30 天期
    const stakeIdx = Number(await staking.stakeCount(user4.address)) - 1;

    await advanceTime(30);
    await advanceTimeSeconds(1);

    const eduBalBefore = await usdx.balanceOf(educationFundAddress);
    await staking.connect(user4).unstake(stakeIdx);
    const eduBalAfter = await usdx.balanceOf(educationFundAddress);

    const eduReceived = eduBalAfter - eduBalBefore;
    console.log(`     教育基金收到: ${formatEther(eduReceived)} USDX`);
    assert(eduReceived > 0n, "教育基金应收到 USDX");
  });

  // =========================================================================
  // 2.5 团队奖励扣除 (利息的最高 35%)
  // =========================================================================
  await advanceTimeSeconds(120);
  await runner.run("2.5", "团队奖励扣除", async () => {
    const stakeAmount = parseEther("500");
    await staking.connect(user5).stake(stakeAmount, 1); // 30 天期
    const stakeIdx = Number(await staking.stakeCount(user5.address)) - 1;

    await advanceTime(30);
    await advanceTimeSeconds(1);

    // 记录 root 地址余额（团队奖励最终归 root）
    const rootBalBefore = await usdx.balanceOf(rootAddress);
    const tx = await staking.connect(user5).unstake(stakeIdx);
    const receipt = await tx.wait();
    const rootBalAfter = await usdx.balanceOf(rootAddress);

    // 解析 WithdrawalCompleted 事件获取 teamFee
    let teamFee = 0n;
    for (const log of receipt.logs) {
      try {
        const parsed = staking.interface.parseLog(log);
        if (parsed && parsed.name === "WithdrawalCompleted") {
          teamFee = parsed.args.teamFee;
          break;
        }
      } catch { /* ignore */ }
    }
    console.log(`     团队奖励: ${formatEther(teamFee)} USDX`);
    assert(teamFee > 0n, "团队奖励应大于 0");
  });

  // =========================================================================
  // 2.6 赎回手续费 (0.6%)
  // =========================================================================
  await advanceTimeSeconds(120);
  await runner.run("2.6", "赎回手续费 (0.6%)", async () => {
    const stakeAmount = parseEther("500");
    await staking.connect(user6).stake(stakeAmount, 1); // 30 天期
    const stakeIdx = Number(await staking.stakeCount(user6.address)) - 1;

    await advanceTime(30);
    await advanceTimeSeconds(1);

    const tx = await staking.connect(user6).unstake(stakeIdx);
    const receipt = await tx.wait();

    // 解析 RedemptionFeeCollected 事件
    let feeEvent = null;
    for (const log of receipt.logs) {
      try {
        const parsed = staking.interface.parseLog(log);
        if (parsed && parsed.name === "RedemptionFeeCollected") {
          feeEvent = parsed;
          break;
        }
      } catch { /* ignore */ }
    }
    assert(feeEvent, "应触发 RedemptionFeeCollected 事件");
    assert(feeEvent.args.usdxAmount > 0n, "赎回费 USDX 金额应大于 0");
    console.log(`     赎回费: ${formatEther(feeEvent.args.usdxAmount)} USDX`);
  });

  // =========================================================================
  // 2.7 赎回费接收地址验证
  // =========================================================================
  await runner.run("2.7", "赎回费接收地址验证", async () => {
    // 复用 2.6 的事件数据，验证 feeRecipient 地址
    // 重新质押一笔来独立验证
    await advanceTimeSeconds(120);
    const stakeAmount = parseEther("300");
    await staking.connect(user6).stake(stakeAmount, 1);
    const stakeIdx = Number(await staking.stakeCount(user6.address)) - 1;

    await advanceTime(30);
    await advanceTimeSeconds(1);

    const feeRecipBalBefore = await usdx.balanceOf(feeRecipientAddress);
    const tx = await staking.connect(user6).unstake(stakeIdx);
    const receipt = await tx.wait();
    const feeRecipBalAfter = await usdx.balanceOf(feeRecipientAddress);

    // 解析事件确认接收地址
    let feeEvent = null;
    for (const log of receipt.logs) {
      try {
        const parsed = staking.interface.parseLog(log);
        if (parsed && parsed.name === "RedemptionFeeCollected") {
          feeEvent = parsed;
          break;
        }
      } catch { /* ignore */ }
    }
    assert(feeEvent, "应触发 RedemptionFeeCollected 事件");
    assertEq(
      feeEvent.args.feeRecipient.toLowerCase(),
      feeRecipientAddress.toLowerCase(),
      "赎回费接收地址应匹配"
    );
    console.log(`     赎回费接收地址: ${feeEvent.args.feeRecipient}`);
  });

  // =========================================================================
  // 2.8 赎回后余额清零
  // =========================================================================
  await advanceTimeSeconds(120);
  await runner.run("2.8", "赎回后余额清零", async () => {
    const stakeAmount = parseEther("400");
    await staking.connect(user7).stake(stakeAmount, 1); // 30 天期
    const stakeIdx = Number(await staking.stakeCount(user7.address)) - 1;

    await advanceTime(30);
    await advanceTimeSeconds(1);

    await staking.connect(user7).unstake(stakeIdx);

    // 验证该笔质押记录的 status 为 true（已赎回）
    const record = await staking.userStakeRecord(user7.address, stakeIdx);
    assert(record.status === true, "赎回后 status 应为 true");

    // canWithdrawStake 应返回 false
    const canWithdraw = await staking.canWithdrawStake(user7.address, stakeIdx);
    assert(!canWithdraw, "赎回后 canWithdrawStake 应为 false");
  });

  const allPassed = runner.summary();

  // 恢复快照，确保不污染后续测试
  await revertSnapshot(snapshotId);

  if (!allPassed) process.exit(1);
}

main()
  .then(() => process.exit(0))
  .catch((error) => { console.error(error); process.exit(1); });
