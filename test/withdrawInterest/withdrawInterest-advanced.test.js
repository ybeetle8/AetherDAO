/**
 * 模块 3：提前提取利息 (withdrawInterest) 测试 - 第二部分
 * 测试项 3.7 ~ 3.11
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
  console.log("\n=== 模块 3：提前提取利息 (withdrawInterest) 测试 - 第二部分 (3.7~3.11) ===\n");
  const deployment = loadDeployment();
  const { ae, staking, pair, usdx } = await getContracts(deployment);
  const [deployer, ...accounts] = await hre.ethers.getSigners();
  const stakingAddress = deployment.contracts.Staking;
  const rootAddress = deployment.addresses.rootAddress;
  const educationFundAddress = deployment.addresses.educationFundAddress;
  const feeRecipientAddress = deployment.addresses.feeRecipient;

  // 使用 accounts[14]~[18]，与 basic 文件相同索引但独立运行
  const user1 = accounts[14]; // 3.7 已提取利息追踪
  const user2 = accounts[15]; // 3.8 可用利息查询
  const user3 = accounts[16]; // 3.9 无可用利息
  const user4 = accounts[17]; // 3.10 InterestWithdrawn 事件
  const user5 = accounts[18]; // 3.11 提取后继续生息

  const runner = new TestRunner("模块 3：提前提取利息 (withdrawInterest) - 第二部分");

  for (const u of [user1, user2, user3, user4, user5]) {
    await prepareUser(usdx, staking, u, stakingAddress, rootAddress);
  }

  // =========================================================================
  // 3.7 已提取利息追踪
  // =========================================================================
  await advanceTimeSeconds(120);
  await runner.run("3.7", "已提取利息追踪 (getWithdrawnInterest)", async () => {
    const stakeAmount = await safeStake(staking, user1, parseEther("500"), 2); // 90 天期
    const stakeIdx = Number(await staking.stakeCount(user1.address)) - 1;

    // 初始已提取利息应为 0
    const withdrawn0 = await staking.getWithdrawnInterest(user1.address, stakeIdx);
    assertEq(withdrawn0, 0n, "初始已提取利息应为 0");

    // 推进 30 天，提取利息
    await advanceTime(30);
    await staking.connect(user1).withdrawInterest(stakeIdx);

    const withdrawn1 = await staking.getWithdrawnInterest(user1.address, stakeIdx);
    assert(withdrawn1 > 0n, "提取后已提取利息应大于 0");
    console.log(`     第1次提取后累计: ${formatEther(withdrawn1)} USDX`);

    // 再推进 30 天，再次提取
    await advanceTime(30);
    await staking.connect(user1).withdrawInterest(stakeIdx);

    const withdrawn2 = await staking.getWithdrawnInterest(user1.address, stakeIdx);
    assert(withdrawn2 > withdrawn1, "第2次提取后累计应更大");
    console.log(`     第2次提取后累计: ${formatEther(withdrawn2)} USDX`);
  });

  // =========================================================================
  // 3.8 可用利息查询 (getAvailableInterest)
  // =========================================================================
  await advanceTimeSeconds(120);
  await runner.run("3.8", "可用利息查询 (getAvailableInterest)", async () => {
    const stakeAmount = await safeStake(staking, user1, parseEther("500"), 1); // 30 天期
    const stakeIdx = Number(await staking.stakeCount(user1.address)) - 1;

    // 刚质押时可用利息应为 0 或极小
    const avail0 = await staking.getAvailableInterest(user1.address, stakeIdx);
    console.log(`     刚质押时可用利息: ${formatEther(avail0)} USDX`);

    // 推进 10 天
    await advanceTime(10);
    const avail10 = await staking.getAvailableInterest(user1.address, stakeIdx);
    assert(avail10 > 0n, "10天后应有可用利息");
    console.log(`     10天后可用利息: ${formatEther(avail10)} USDX`);

    // 推进到 20 天
    await advanceTime(10);
    const avail20 = await staking.getAvailableInterest(user1.address, stakeIdx);
    assert(avail20 > avail10, "20天后可用利息应大于10天");
    console.log(`     20天后可用利息: ${formatEther(avail20)} USDX`);

    // 推进到 30 天（到期）
    await advanceTime(10);
    await advanceTimeSeconds(1);
    const avail30 = await staking.getAvailableInterest(user1.address, stakeIdx);
    assert(avail30 >= avail20, "30天后可用利息应 >= 20天");
    console.log(`     30天后可用利息: ${formatEther(avail30)} USDX`);

    // 验证利息随时间递增
    assert(avail30 > avail10, "可用利息应随时间递增");
  });

  // =========================================================================
  // 3.9 无可用利息（刚质押立即提取）
  // =========================================================================
  await advanceTimeSeconds(120);
  await runner.run("3.9", "无可用利息（刚质押立即提取）", async () => {
    const stakeAmount = await safeStake(staking, user3, parseEther("500"), 1); // 30 天期
    const stakeIdx = Number(await staking.stakeCount(user3.address)) - 1;

    // 刚质押立即尝试提取利息，应 revert（无可用利息）
    let reverted = false;
    try {
      await staking.connect(user3).withdrawInterest(stakeIdx);
    } catch (e) {
      reverted = true;
      assert(
        errorContains(e, "No interest available") || errorContains(e, "reverted"),
        "应提示无可用利息"
      );
    }
    assert(reverted, "刚质押立即提取利息应 revert");
    console.log(`     刚质押立即提取: 正确 revert`);
  });

  // =========================================================================
  // 3.10 InterestWithdrawn 事件验证
  // =========================================================================
  await advanceTimeSeconds(120);
  await runner.run("3.10", "InterestWithdrawn 事件验证", async () => {
    const stakeAmount = await safeStake(staking, user4, parseEther("500"), 1); // 30 天期
    const stakeIdx = Number(await staking.stakeCount(user4.address)) - 1;

    // 推进 15 天
    await advanceTime(15);

    const tx = await staking.connect(user4).withdrawInterest(stakeIdx);
    const receipt = await tx.wait();

    // 解析 InterestWithdrawn 事件
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
    // 验证所有字段
    assertEq(iwEvent.args.user, user4.address, "user 应匹配");
    assertEq(iwEvent.args.stakeIndex, BigInt(stakeIdx), "stakeIndex 应匹配");
    assert(iwEvent.args.interestAmount > 0n, "interestAmount 应大于 0");
    assert(iwEvent.args.usdxReceived > 0n, "usdxReceived 应大于 0");
    assert(iwEvent.args.aeTokensUsed > 0n, "aeTokensUsed 应大于 0");
    assert(iwEvent.args.userPayout > 0n, "userPayout 应大于 0");
    assert(iwEvent.args.timestamp > 0n, "timestamp 应大于 0");

    console.log(`     interestAmount: ${formatEther(iwEvent.args.interestAmount)}`);
    console.log(`     usdxReceived: ${formatEther(iwEvent.args.usdxReceived)}`);
    console.log(`     aeTokensUsed: ${formatEther(iwEvent.args.aeTokensUsed)}`);
    console.log(`     教育基金(referralFee): ${formatEther(iwEvent.args.referralFee)}`);
    console.log(`     团队奖励(teamFee): ${formatEther(iwEvent.args.teamFee)}`);
    console.log(`     用户到手(userPayout): ${formatEther(iwEvent.args.userPayout)}`);
  });

  // =========================================================================
  // 3.11 提取利息后继续生息
  // =========================================================================
  await advanceTimeSeconds(120);
  await runner.run("3.11", "提取利息后继续生息", async () => {
    const stakeAmount = await safeStake(staking, user5, parseEther("500"), 2); // 90 天期
    const stakeIdx = Number(await staking.stakeCount(user5.address)) - 1;

    // 推进 30 天，提取利息
    await advanceTime(30);
    const avail30 = await staking.getAvailableInterest(user5.address, stakeIdx);
    assert(avail30 > 0n, "30天后应有可用利息");
    await staking.connect(user5).withdrawInterest(stakeIdx);

    // 提取后，可用利息应为 0
    const availAfterWithdraw = await staking.getAvailableInterest(user5.address, stakeIdx);
    assertEq(availAfterWithdraw, 0n, "提取后可用利息应为 0");

    // 再推进 30 天，本金应继续生息
    await advanceTime(30);
    const avail60 = await staking.getAvailableInterest(user5.address, stakeIdx);
    assert(avail60 > 0n, "提取后继续推进30天应有新利息");
    console.log(`     30天提取后，再过30天新增利息: ${formatEther(avail60)} USDX`);

    // 验证质押记录仍然有效（未赎回）
    const record = await staking.userStakeRecord(user5.address, stakeIdx);
    assert(!record.status, "质押状态应仍为未赎回");

    // 验证本金不变
    assertEq(record.amount, stakeAmount, "本金应不变");
    console.log(`     本金仍为: ${formatEther(record.amount)} USDX，继续生息正常`);
  });

  const allPassed = runner.summary();
  if (!allPassed) process.exit(1);
}

main()
  .then(() => process.exit(0))
  .catch((error) => { console.error(error); process.exit(1); });
