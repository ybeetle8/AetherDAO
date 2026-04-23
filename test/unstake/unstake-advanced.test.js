/**
 * 模块 2：到期赎回 (unstake) 测试 - 第二部分
 * 测试项 2.9 ~ 2.15
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
  console.log("\n=== 模块 2：到期赎回 (unstake) 测试 - 第二部分 (2.9~2.15) ===\n");

  // 快照：保证每次运行从干净状态开始，测试结束后恢复
  const snapshotId = await takeSnapshot();

  const deployment = loadDeployment();
  const { ae, staking, pair, usdx } = await getContracts(deployment);
  const [deployer, ...accounts] = await hre.ethers.getSigners();
  const stakingAddress = deployment.contracts.Staking;
  const rootAddress = deployment.addresses.rootAddress;
  // 使用独立账户（默认 mnemonic 共 20 个 signer，deployer 占 1 个，accounts 有 19 个）
  const user8 = accounts[7];   // 2.9 重复赎回
  const user9 = accounts[8];   // 2.10 多笔质押独立赎回
  const user10 = accounts[9];  // 2.11 WithdrawalCompleted 事件
  const user11 = accounts[10]; // 2.12 提取历史记录
  const user12 = accounts[11]; // 2.13 各期限收益验证
  const user13 = accounts[12]; // 2.14 已提取部分利息后赎回
  const user14 = accounts[13]; // 2.15 RedemptionFeeCollected 事件

  const runner = new TestRunner("模块 2：到期赎回 (unstake) - 第二部分");

  // 准备所有用户
  for (const u of [user8, user9, user10, user11, user12, user13, user14]) {
    await prepareUser(usdx, staking, u, stakingAddress, rootAddress);
  }

  // =========================================================================
  // 2.9 重复赎回应 revert
  // =========================================================================
  await advanceTimeSeconds(120);
  await runner.run("2.9", "重复赎回应 revert", async () => {
    const stakeAmount = parseEther("300");
    await staking.connect(user8).stake(stakeAmount, 1); // 30 天期
    const stakeIdx = Number(await staking.stakeCount(user8.address)) - 1;

    await advanceTime(30);
    await advanceTimeSeconds(1);

    // 第一次赎回应成功
    await staking.connect(user8).unstake(stakeIdx);

    // 第二次赎回应 revert
    let reverted = false;
    try {
      await staking.connect(user8).unstake(stakeIdx);
    } catch (e) {
      reverted = true;
      assert(
        errorContains(e, "AlreadyWithdrawn") || errorContains(e, "reverted"),
        "应 AlreadyWithdrawn"
      );
    }
    assert(reverted, "重复赎回应 revert");
  });

  // =========================================================================
  // 2.10 多笔质押独立赎回
  // =========================================================================
  await advanceTimeSeconds(120);
  await runner.run("2.10", "多笔质押独立赎回", async () => {
    // 质押 3 笔不同期限
    await staking.connect(user9).stake(parseEther("200"), 1); // 30 天
    await advanceTimeSeconds(120);
    await staking.connect(user9).stake(parseEther("300"), 2); // 90 天
    await advanceTimeSeconds(120);
    await staking.connect(user9).stake(parseEther("400"), 2); // 90 天

    const count = Number(await staking.stakeCount(user9.address));
    const idx0 = count - 3;
    const idx1 = count - 2;
    const idx2 = count - 1;

    // 推进 30 天，只有第一笔到期
    await advanceTime(30);
    await advanceTimeSeconds(1);

    assert(await staking.canWithdrawStake(user9.address, idx0), "第1笔应可赎回");
    assert(!(await staking.canWithdrawStake(user9.address, idx1)), "第2笔应不可赎回");
    assert(!(await staking.canWithdrawStake(user9.address, idx2)), "第3笔应不可赎回");

    // 赎回第一笔
    await staking.connect(user9).unstake(idx0);

    // 验证第二、三笔不受影响
    const record1 = await staking.userStakeRecord(user9.address, idx1);
    const record2 = await staking.userStakeRecord(user9.address, idx2);
    assert(!record1.status, "第2笔应未赎回");
    assert(!record2.status, "第3笔应未赎回");

    // 推进到 90 天，赎回第二笔
    await advanceTime(60);
    await advanceTimeSeconds(1);

    assert(await staking.canWithdrawStake(user9.address, idx1), "第2笔应可赎回");
    await staking.connect(user9).unstake(idx1);

    // 第三笔仍未赎回
    const record2After = await staking.userStakeRecord(user9.address, idx2);
    assert(!record2After.status, "第3笔仍应未赎回");
  });

  // =========================================================================
  // 2.11 WithdrawalCompleted 事件验证
  // =========================================================================
  await advanceTimeSeconds(120);
  await runner.run("2.11", "WithdrawalCompleted 事件验证", async () => {
    const stakeAmount = parseEther("500");
    await staking.connect(user10).stake(stakeAmount, 1); // 30 天期
    const stakeIdx = Number(await staking.stakeCount(user10.address)) - 1;

    await advanceTime(30);
    await advanceTimeSeconds(1);

    const tx = await staking.connect(user10).unstake(stakeIdx);
    const receipt = await tx.wait();

    let wcEvent = null;
    for (const log of receipt.logs) {
      try {
        const parsed = staking.interface.parseLog(log);
        if (parsed && parsed.name === "WithdrawalCompleted") {
          wcEvent = parsed;
          break;
        }
      } catch { /* ignore */ }
    }

    assert(wcEvent, "应触发 WithdrawalCompleted 事件");
    assertEq(wcEvent.args.user, user10.address, "user 应匹配");
    assertEq(wcEvent.args.stakeIndex, BigInt(stakeIdx), "stakeIndex 应匹配");
    assert(wcEvent.args.principalAmount > 0n, "principalAmount 应大于 0");
    assert(wcEvent.args.calculatedReward > 0n, "calculatedReward 应大于 0");
    assert(wcEvent.args.usdxReceived > 0n, "usdxReceived 应大于 0");
    assert(wcEvent.args.aeTokensUsed > 0n, "aeTokensUsed 应大于 0");
    assert(wcEvent.args.userPayout > 0n, "userPayout 应大于 0");
    assert(wcEvent.args.withdrawalTime > 0n, "withdrawalTime 应大于 0");

    console.log(`     本金: ${formatEther(wcEvent.args.principalAmount)}`);
    console.log(`     计算奖励: ${formatEther(wcEvent.args.calculatedReward)}`);
    console.log(`     USDX收到: ${formatEther(wcEvent.args.usdxReceived)}`);
    console.log(`     教育基金: ${formatEther(wcEvent.args.referralFee)}`);
    console.log(`     团队奖励: ${formatEther(wcEvent.args.teamFee)}`);
    console.log(`     用户到手: ${formatEther(wcEvent.args.userPayout)}`);
  });

  // =========================================================================
  // 2.12 提取历史记录
  // =========================================================================
  await advanceTimeSeconds(120);
  await runner.run("2.12", "提取历史记录", async () => {
    const stakeAmount = parseEther("300");
    await staking.connect(user11).stake(stakeAmount, 1); // 30 天期
    const stakeIdx = Number(await staking.stakeCount(user11.address)) - 1;

    const countBefore = Number(await staking.getWithdrawalCount(user11.address));

    await advanceTime(30);
    await advanceTimeSeconds(1);
    await staking.connect(user11).unstake(stakeIdx);

    const countAfter = Number(await staking.getWithdrawalCount(user11.address));
    assertEq(countAfter, countBefore + 1, "提取记录数应+1");

    // 验证记录内容
    const record = await staking.getWithdrawalRecord(user11.address, countAfter - 1);
    assertEq(record.stakeIndex, BigInt(stakeIdx), "记录 stakeIndex 应匹配");
    assert(record.principalAmount > 0n, "记录 principalAmount 应大于 0");
    assert(record.userPayout > 0n, "记录 userPayout 应大于 0");
    assert(record.withdrawalTime > 0n, "记录 withdrawalTime 应大于 0");

    // 验证 getWithdrawalHistory 包含该记录
    const history = await staking.getWithdrawalHistory(user11.address);
    assert(history.length >= 1, "历史记录应至少有 1 条");
    console.log(`     提取历史记录数: ${history.length}`);
  });

  // =========================================================================
  // 2.13 各期限收益验证 (7/30/90/180/365 天)
  // =========================================================================
  await advanceTimeSeconds(120);
  await runner.run("2.13", "各期限收益验证", async () => {
    const stakeAmount = parseEther("200");
    const rates = [1.006, 1.009, 1.011, 1.015, 1.020];
    const periods = [7, 30, 90, 180, 365];

    // 质押 5 笔不同期限
    for (let i = 0; i < 5; i++) {
      await advanceTimeSeconds(120);
      // 7 天期限只能用一次，先重置
      if (i === 0 && await staking.has7DayStakeBeenUsed(user12.address)) {
        await staking.connect(deployer).reset7DayStakeUsage(user12.address);
      }
      const maxS = await staking.maxStakeAmount();
      if (maxS < stakeAmount) {
        console.log(`     期限 ${periods[i]}天: maxStakeAmount 不足，跳过`);
        continue;
      }
      await staking.connect(user12).stake(stakeAmount, i);
    }

    const count = Number(await staking.stakeCount(user12.address));
    console.log(`     已质押 ${count} 笔`);

    // 推进 365 天（最长期限），所有质押都到期
    await advanceTime(365);
    await advanceTimeSeconds(1);

    // 验证每笔的复利计算
    for (let i = 0; i < count; i++) {
      const record = await staking.userStakeRecord(user12.address, i);
      const stakeIndex = Number(record.stakeIndex);
      const reward = await staking.rewardOfSlot(user12.address, i);
      const expectedReward = Number(formatEther(record.amount)) * Math.pow(rates[stakeIndex], periods[stakeIndex]);
      const rewardNum = Number(formatEther(reward));
      const tolerance = expectedReward * 0.01;

      console.log(`     期限 ${periods[stakeIndex]}天: 合约=${rewardNum.toFixed(4)}, 预期=${expectedReward.toFixed(4)}`);
      assert(
        Math.abs(rewardNum - expectedReward) < tolerance,
        `期限 ${periods[stakeIndex]}天 复利偏差过大`
      );
    }
  });

  // =========================================================================
  // 2.14 已提取部分利息后赎回
  // =========================================================================
  await advanceTimeSeconds(120);
  await runner.run("2.14", "已提取部分利息后赎回", async () => {
    const stakeAmount = parseEther("500");
    await staking.connect(user13).stake(stakeAmount, 1); // 30 天期
    const stakeIdx = Number(await staking.stakeCount(user13.address)) - 1;

    // 推进 15 天，提取一半时间的利息
    await advanceTime(15);

    const availBefore = await staking.getAvailableInterest(user13.address, stakeIdx);
    console.log(`     15天后可用利息: ${formatEther(availBefore)} USDX`);
    assert(availBefore > 0n, "15天后应有可用利息");

    const usdxBefore1 = await usdx.balanceOf(user13.address);
    await staking.connect(user13).withdrawInterest(stakeIdx);
    const usdxAfter1 = await usdx.balanceOf(user13.address);
    const interestReceived = usdxAfter1 - usdxBefore1;
    console.log(`     提取利息收到: ${formatEther(interestReceived)} USDX`);

    // 验证已提取利息记录
    const withdrawn = await staking.getWithdrawnInterest(user13.address, stakeIdx);
    assert(withdrawn > 0n, "已提取利息应大于 0");

    // 推进到 30 天到期
    await advanceTime(15);
    await advanceTimeSeconds(1);

    // 赎回
    const usdxBefore2 = await usdx.balanceOf(user13.address);
    const tx = await staking.connect(user13).unstake(stakeIdx);
    const receipt = await tx.wait();
    const usdxAfter2 = await usdx.balanceOf(user13.address);
    const unstakeReceived = usdxAfter2 - usdxBefore2;
    console.log(`     赎回收到: ${formatEther(unstakeReceived)} USDX`);

    // 赎回应成功，且总收益 = 提取利息 + 赎回金额（扣除各项费用后）
    assert(unstakeReceived > 0n, "赎回应收到 USDX");
  });

  // =========================================================================
  // 2.15 RedemptionFeeCollected 事件验证
  // =========================================================================
  await advanceTimeSeconds(120);
  await runner.run("2.15", "RedemptionFeeCollected 事件验证", async () => {
    const stakeAmount = parseEther("400");
    await staking.connect(user14).stake(stakeAmount, 1); // 30 天期
    const stakeIdx = Number(await staking.stakeCount(user14.address)) - 1;

    await advanceTime(30);
    await advanceTimeSeconds(1);

    const tx = await staking.connect(user14).unstake(stakeIdx);
    const receipt = await tx.wait();

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
    assertEq(feeEvent.args.user, user14.address, "user 应匹配");
    assertEq(feeEvent.args.stakeIndex, BigInt(stakeIdx), "stakeIndex 应匹配");
    assert(feeEvent.args.aeAmount > 0n, "aeAmount 应大于 0");
    assert(feeEvent.args.usdxAmount > 0n, "usdxAmount 应大于 0");
    assert(feeEvent.args.timestamp > 0n, "timestamp 应大于 0");

    console.log(`     赎回费 AE: ${formatEther(feeEvent.args.aeAmount)}`);
    console.log(`     赎回费 USDX: ${formatEther(feeEvent.args.usdxAmount)}`);
    console.log(`     接收地址: ${feeEvent.args.feeRecipient}`);
  });

  const allPassed = runner.summary();

  // 恢复快照，确保不污染后续测试
  await revertSnapshot(snapshotId);

  if (!allPassed) process.exit(1);
}

main()
  .then(() => process.exit(0))
  .catch((error) => { console.error(error); process.exit(1); });
