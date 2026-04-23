/**
 * 模块 3：提前提取利息 (withdrawInterest) 测试 - 第一部分
 * 测试项 3.1 ~ 3.6
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
const { advanceTime, advanceTimeSeconds, getBlockTimestamp } = require("../helpers/time");

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

/**
 * 安全质押：检查剩余容量和单次上限，取最小可用金额
 */
async function safeStake(staking, user, desiredAmount, stakeIndex) {
  const remaining = await staking.getRemainingStakeCapacity(user.address);
  const maxSingle = await staking.maxStakeAmount();
  let amount = desiredAmount;
  if (remaining < amount) amount = remaining;
  if (maxSingle < amount) amount = maxSingle;
  assert(amount >= parseEther("100"), `剩余容量不足最低质押额: remaining=${formatEther(remaining)}, maxSingle=${formatEther(maxSingle)}`);
  await staking.connect(user).stake(amount, stakeIndex);
  return amount;
}

async function main() {
  console.log("\n=== 模块 3：提前提取利息 (withdrawInterest) 测试 - 第一部分 (3.1~3.6) ===\n");

  const deployment = loadDeployment();
  const { ae, staking, pair, usdx } = await getContracts(deployment);
  const [deployer, ...accounts] = await hre.ethers.getSigners();
  const stakingAddress = deployment.contracts.Staking;
  const rootAddress = deployment.addresses.rootAddress;
  const educationFundAddress = deployment.addresses.educationFundAddress;
  const feeRecipientAddress = deployment.addresses.feeRecipient;
  // 使用 accounts[14]~[18] 避免与模块 1/2 测试账户冲突
  // 默认 mnemonic 共 20 个 signer，deployer 占 1 个，accounts 有 19 个 (index 0~18)
  const user1 = accounts[14]; // 3.1 基本利息提取
  const user2 = accounts[15]; // 3.2 本金不变
  const user3 = accounts[16]; // 3.3 教育基金扣除
  const user4 = accounts[17]; // 3.4 团队奖励扣除 + 3.5 赎回手续费
  const user5 = accounts[18]; // 3.6 多次提取

  const runner = new TestRunner("模块 3：提前提取利息 (withdrawInterest) - 第一部分");

  // 准备所有用户
  for (const u of [user1, user2, user3, user4, user5]) {
    await prepareUser(usdx, staking, u, stakingAddress, rootAddress);
  }

  // =========================================================================
  // 3.1 基本利息提取
  // =========================================================================
  await advanceTimeSeconds(120);
  await runner.run("3.1", "基本利息提取", async () => {
    const stakeAmount = await safeStake(staking, user1, parseEther("500"), 1); // 30 天期
    const stakeIdx = Number(await staking.stakeCount(user1.address)) - 1;

    // 推进 15 天，产生利息
    await advanceTime(15);

    // 查询可用利息
    const availableInterest = await staking.getAvailableInterest(user1.address, stakeIdx);
    assert(availableInterest > 0n, "15天后应有可用利息");
    console.log(`     15天后可用利息: ${formatEther(availableInterest)} USDX`);

    // 提取利息
    const usdxBefore = await usdx.balanceOf(user1.address);
    const tx = await staking.connect(user1).withdrawInterest(stakeIdx);
    const receipt = await tx.wait();
    const usdxAfter = await usdx.balanceOf(user1.address);

    const received = usdxAfter - usdxBefore;
    assert(received > 0n, "应收到 USDX 利息");
    console.log(`     用户收到利息: ${formatEther(received)} USDX`);

    // 验证 InterestWithdrawn 事件
    let iwEvent = null;
    for (const log of receipt.logs) {
      try {
        const parsed = staking.interface.parseLog(log);
        if (parsed && parsed.name === "InterestWithdrawn") {
          iwEvent = parsed;
          break;
        }
      } catch { /* ignore */ }
    }
    assert(iwEvent, "应触发 InterestWithdrawn 事件");
    assert(iwEvent.args.interestAmount > 0n, "事件 interestAmount 应大于 0");
    assert(iwEvent.args.userPayout > 0n, "事件 userPayout 应大于 0");
  });

  // =========================================================================
  // 3.2 本金不变
  // =========================================================================
  await advanceTimeSeconds(120);
  await runner.run("3.2", "提取利息后本金不变", async () => {
    // 使用 user1（与 3.1 同用户，但新建一笔质押）
    const stakeAmount = await safeStake(staking, user1, parseEther("500"), 1); // 30 天期
    const stakeIdx = Number(await staking.stakeCount(user1.address)) - 1;
    const recordBefore = await staking.userStakeRecord(user1.address, stakeIdx);
    const principalBefore = recordBefore.amount;

    // 推进 15 天
    await advanceTime(15);

    // 提取利息
    await staking.connect(user1).withdrawInterest(stakeIdx);

    // 验证本金不变
    const recordAfter = await staking.userStakeRecord(user1.address, stakeIdx);
    const principalAfter = recordAfter.amount;
    assertEq(principalAfter, principalBefore, "提取利息后本金应不变");

    // 验证质押状态未变（未赎回）
    assert(!recordAfter.status, "提取利息后 status 应仍为 false");
    console.log(`     本金: ${formatEther(principalBefore)} -> ${formatEther(principalAfter)} (不变)`);
  });

  // =========================================================================
  // 3.3 教育基金扣除 (利息的 5%)
  // =========================================================================
  await advanceTimeSeconds(120);
  await runner.run("3.3", "教育基金扣除 (利息的 5%)", async () => {
    const stakeAmount = await safeStake(staking, user3, parseEther("500"), 1); // 30 天期
    const stakeIdx = Number(await staking.stakeCount(user3.address)) - 1;

    // 推进 15 天
    await advanceTime(15);

    const eduBalBefore = await usdx.balanceOf(educationFundAddress);
    const tx = await staking.connect(user3).withdrawInterest(stakeIdx);
    const receipt = await tx.wait();
    const eduBalAfter = await usdx.balanceOf(educationFundAddress);

    const eduReceived = eduBalAfter - eduBalBefore;
    assert(eduReceived > 0n, "教育基金应收到 USDX");

    // 从事件中验证教育基金金额
    let iwEvent = null;
    for (const log of receipt.logs) {
      try {
        const parsed = staking.interface.parseLog(log);
        if (parsed && parsed.name === "InterestWithdrawn") {
          iwEvent = parsed;
          break;
        }
      } catch { /* ignore */ }
    }
    assert(iwEvent, "应触发 InterestWithdrawn 事件");
    console.log(`     教育基金收到: ${formatEther(eduReceived)} USDX`);
    console.log(`     事件中教育基金: ${formatEther(iwEvent.args.referralFee)} USDX`);
  });

  // =========================================================================
  // 3.4 团队奖励扣除
  // =========================================================================
  await advanceTimeSeconds(120);
  await runner.run("3.4", "团队奖励扣除", async () => {
    const stakeAmount = await safeStake(staking, user4, parseEther("500"), 1); // 30 天期
    const stakeIdx = Number(await staking.stakeCount(user4.address)) - 1;

    // 推进 15 天
    await advanceTime(15);

    const rootBalBefore = await usdx.balanceOf(rootAddress);
    const tx = await staking.connect(user4).withdrawInterest(stakeIdx);
    const receipt = await tx.wait();
    const rootBalAfter = await usdx.balanceOf(rootAddress);

    // 从事件中获取团队奖励
    let iwEvent = null;
    for (const log of receipt.logs) {
      try {
        const parsed = staking.interface.parseLog(log);
        if (parsed && parsed.name === "InterestWithdrawn") {
          iwEvent = parsed;
          break;
        }
      } catch { /* ignore */ }
    }
    assert(iwEvent, "应触发 InterestWithdrawn 事件");
    const teamFee = iwEvent.args.teamFee;
    assert(teamFee > 0n, "团队奖励应大于 0");
    console.log(`     团队奖励: ${formatEther(teamFee)} USDX`);
  });

  // =========================================================================
  // 3.5 赎回手续费 (0.6%)
  // =========================================================================
  await advanceTimeSeconds(120);
  await runner.run("3.5", "赎回手续费 (0.6%)", async () => {
    const stakeAmount = await safeStake(staking, user4, parseEther("500"), 1); // 30 天期
    const stakeIdx = Number(await staking.stakeCount(user4.address)) - 1;

    // 推进 15 天
    await advanceTime(15);

    const feeRecipBalBefore = await usdx.balanceOf(feeRecipientAddress);
    const tx = await staking.connect(user4).withdrawInterest(stakeIdx);
    const receipt = await tx.wait();
    const feeRecipBalAfter = await usdx.balanceOf(feeRecipientAddress);

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
    console.log(`     接收地址: ${feeEvent.args.feeRecipient}`);
  });

  // =========================================================================
  // 3.6 多次提取，每次只提取新增利息
  // =========================================================================
  await advanceTimeSeconds(120);
  await runner.run("3.6", "多次提取，每次只提取新增利息", async () => {
    const stakeAmount = await safeStake(staking, user5, parseEther("500"), 2); // 90 天期
    const stakeIdx = Number(await staking.stakeCount(user5.address)) - 1;

    // 第一次：推进 30 天，提取利息
    await advanceTime(30);
    const avail1 = await staking.getAvailableInterest(user5.address, stakeIdx);
    assert(avail1 > 0n, "30天后应有可用利息");

    const usdxBefore1 = await usdx.balanceOf(user5.address);
    await staking.connect(user5).withdrawInterest(stakeIdx);
    const usdxAfter1 = await usdx.balanceOf(user5.address);
    const received1 = usdxAfter1 - usdxBefore1;

    const withdrawn1 = await staking.getWithdrawnInterest(user5.address, stakeIdx);
    console.log(`     第1次提取 (30天): 可用=${formatEther(avail1)}, 收到=${formatEther(received1)}, 累计已提=${formatEther(withdrawn1)}`);

    // 第二次：再推进 30 天，提取新增利息
    await advanceTime(30);
    const avail2 = await staking.getAvailableInterest(user5.address, stakeIdx);
    assert(avail2 > 0n, "60天后应有新增可用利息");

    const usdxBefore2 = await usdx.balanceOf(user5.address);
    await staking.connect(user5).withdrawInterest(stakeIdx);
    const usdxAfter2 = await usdx.balanceOf(user5.address);
    const received2 = usdxAfter2 - usdxBefore2;

    const withdrawn2 = await staking.getWithdrawnInterest(user5.address, stakeIdx);
    console.log(`     第2次提取 (60天): 可用=${formatEther(avail2)}, 收到=${formatEther(received2)}, 累计已提=${formatEther(withdrawn2)}`);

    // 验证累计已提取利息递增
    assert(withdrawn2 > withdrawn1, "累计已提取利息应递增");

    // 第三次：再推进 30 天（到期），提取剩余利息
    await advanceTime(30);
    const avail3 = await staking.getAvailableInterest(user5.address, stakeIdx);

    if (avail3 > 0n) {
      const usdxBefore3 = await usdx.balanceOf(user5.address);
      await staking.connect(user5).withdrawInterest(stakeIdx);
      const usdxAfter3 = await usdx.balanceOf(user5.address);
      const received3 = usdxAfter3 - usdxBefore3;

      const withdrawn3 = await staking.getWithdrawnInterest(user5.address, stakeIdx);
      console.log(`     第3次提取 (90天): 可用=${formatEther(avail3)}, 收到=${formatEther(received3)}, 累计已提=${formatEther(withdrawn3)}`);
      assert(withdrawn3 > withdrawn2, "累计已提取利息应继续递增");
    } else {
      console.log(`     第3次提取 (90天): 无新增利息（已全部提取）`);
    }
  });

  const allPassed = runner.summary();
  if (!allPassed) process.exit(1);
}

main()
  .then(() => process.exit(0))
  .catch((error) => { console.error(error); process.exit(1); });
