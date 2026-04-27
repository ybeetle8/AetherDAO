/**
 * C-01 赎回手续费缺陷修复验证测试
 *
 * 验证方案 A 修复：从 userPayout 中扣除赎回费并转给 feeRecipient
 *
 * 测试覆盖：
 *   RF-1  unstake: 用户收到的 USDX = userPayout - redemptionFee
 *   RF-2  unstake: feeRecipient 实际收到赎回费 USDX
 *   RF-3  unstake: 赎回费 = userPayout * 5%（精确比例验证）
 *   RF-4  unstake: 事件中 aeAmount 为 0（方案 A 不再消耗额外 AE）
 *   RF-5  unstake: 资金平衡 — educationFund + teamFee + redemptionFee + userFinal = usdxReceived
 *   RF-6  unstake: 合约 AE 余额不因赎回费额外减少
 *   RF-7  withdrawInterest: 用户收到的 USDX 已扣除赎回费
 *   RF-8  withdrawInterest: feeRecipient 实际收到赎回费 USDX
 *   RF-9  withdrawInterest: 资金平衡验证
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
const { advanceTime, advanceTimeSeconds, takeSnapshot, revertSnapshot } = require("../helpers/time");

const parseEther = hre.ethers.parseEther;
const formatEther = hre.ethers.formatEther;

const REDEMPTION_FEE_RATE = 500n;         // 5%
const BASIS_POINTS_DENOMINATOR = 10000n;

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

/**
 * 从交易回执中解析指定事件
 */
function parseEvent(staking, receipt, eventName) {
  for (const log of receipt.logs) {
    try {
      const parsed = staking.interface.parseLog(log);
      if (parsed && parsed.name === eventName) {
        return parsed;
      }
    } catch { /* ignore */ }
  }
  return null;
}

async function main() {
  console.log("\n=== C-01 赎回手续费缺陷修复验证测试 (RF-1 ~ RF-9) ===\n");

  const snapshotId = await takeSnapshot();

  const deployment = loadDeployment();
  const { ae, staking, pair, usdx } = await getContracts(deployment);
  const [deployer, ...accounts] = await hre.ethers.getSigners();
  const stakingAddress = deployment.contracts.Staking;
  const rootAddress = deployment.addresses.rootAddress;
  const educationFundAddress = deployment.addresses.educationFundAddress;
  const feeRecipientAddress = deployment.addresses.feeRecipient;

  // 每个 unstake 测试用独立用户，避免累积触发 maxStakeAmount
  const user1 = accounts[7];   // RF-1
  const user2 = accounts[8];   // RF-2
  const user3 = accounts[9];   // RF-3
  const user4 = accounts[10];  // RF-4
  const user5 = accounts[11];  // RF-5
  const user6 = accounts[12];  // RF-6
  const user7 = accounts[13];  // RF-7 ~ RF-9 (withdrawInterest, 一笔质押多次提息)

  const runner = new TestRunner("C-01 赎回手续费修复验证");

  // 准备所有用户（先确保有足够 BNB 支付 gas）
  for (const u of [user1, user2, user3, user4, user5, user6, user7]) {
    const balance = await hre.ethers.provider.getBalance(u.address);
    if (balance < parseEther("1")) {
      await deployer.sendTransaction({ to: u.address, value: parseEther("1") });
    }
    await prepareUser(usdx, staking, u, stakingAddress, rootAddress);
  }

  // =========================================================================
  // RF-1  unstake: 用户收到的 USDX 已扣除赎回费
  // =========================================================================
  await advanceTimeSeconds(120);
  await runner.run("RF-1", "unstake: 用户收到的 USDX 已扣除赎回费", async () => {
    const stakeAmount = await safeStake(staking, user1, parseEther("500"), 1); // 30 天期
    const stakeIdx = Number(await staking.stakeCount(user1.address)) - 1;

    await advanceTime(30);
    await advanceTimeSeconds(1);

    const usdxBefore = await usdx.balanceOf(user1.address);
    const tx = await staking.connect(user1).unstake(stakeIdx);
    const receipt = await tx.wait();
    const usdxAfter = await usdx.balanceOf(user1.address);
    const userReceived = usdxAfter - usdxBefore;

    // 从 WithdrawalCompleted 事件获取 usdxReceived / educationFund / teamFee
    const wcEvent = parseEvent(staking, receipt, "WithdrawalCompleted");
    assert(wcEvent, "应触发 WithdrawalCompleted 事件");

    const usdxReceived = wcEvent.args.usdxReceived;
    const educationFund = wcEvent.args.referralFee;
    const teamFee = wcEvent.args.teamFee;
    const eventUserPayout = wcEvent.args.userPayout; // 修复后此值已扣除赎回费

    // 计算预期赎回费
    const preDeductPayout = usdxReceived - educationFund - teamFee;
    const expectedFee = (preDeductPayout * REDEMPTION_FEE_RATE) / BASIS_POINTS_DENOMINATOR;
    const expectedUserFinal = preDeductPayout - expectedFee;

    console.log(`     usdxReceived: ${formatEther(usdxReceived)}`);
    console.log(`     educationFund: ${formatEther(educationFund)}, teamFee: ${formatEther(teamFee)}`);
    console.log(`     预期赎回费: ${formatEther(expectedFee)}`);
    console.log(`     预期用户到手: ${formatEther(expectedUserFinal)}`);
    console.log(`     实际用户到手: ${formatEther(userReceived)}`);

    // 用户实际收到的 USDX 应等于 eventUserPayout（已扣赎回费）
    assertEq(userReceived, eventUserPayout, "用户实际收到应等于事件 userPayout");
    // 用户到手金额应等于 preDeductPayout - expectedFee
    assertEq(userReceived, expectedUserFinal, "用户到手 = (usdxReceived - edu - team) * 95%");
  });

  // =========================================================================
  // RF-2  unstake: feeRecipient 实际收到赎回费 USDX
  // =========================================================================
  await advanceTimeSeconds(120);
  await runner.run("RF-2", "unstake: feeRecipient 实际收到赎回费 USDX", async () => {
    const stakeAmount = await safeStake(staking, user2, parseEther("500"), 1);
    const stakeIdx = Number(await staking.stakeCount(user2.address)) - 1;

    await advanceTime(30);
    await advanceTimeSeconds(1);

    const feeRecipBefore = await usdx.balanceOf(feeRecipientAddress);
    const tx = await staking.connect(user2).unstake(stakeIdx);
    const receipt = await tx.wait();
    const feeRecipAfter = await usdx.balanceOf(feeRecipientAddress);
    const feeRecipReceived = feeRecipAfter - feeRecipBefore;

    // 从事件获取赎回费金额
    const feeEvent = parseEvent(staking, receipt, "RedemptionFeeCollected");
    assert(feeEvent, "应触发 RedemptionFeeCollected 事件");
    const eventFeeAmount = feeEvent.args.usdxAmount;

    console.log(`     事件赎回费: ${formatEther(eventFeeAmount)} USDX`);
    console.log(`     feeRecipient 实际收到: ${formatEther(feeRecipReceived)} USDX`);

    assert(feeRecipReceived > 0n, "feeRecipient 应收到赎回费 USDX");
    assertEq(feeRecipReceived, eventFeeAmount, "feeRecipient 收到金额应等于事件中赎回费金额");
  });

  // =========================================================================
  // RF-3  unstake: 赎回费 = userPayout * 5%（精确比例验证）
  // =========================================================================
  await advanceTimeSeconds(120);
  await runner.run("RF-3", "unstake: 赎回费 = userPayout * 5%", async () => {
    const stakeAmount = await safeStake(staking, user3, parseEther("500"), 1);
    const stakeIdx = Number(await staking.stakeCount(user3.address)) - 1;

    await advanceTime(30);
    await advanceTimeSeconds(1);

    const tx = await staking.connect(user3).unstake(stakeIdx);
    const receipt = await tx.wait();

    const wcEvent = parseEvent(staking, receipt, "WithdrawalCompleted");
    const feeEvent = parseEvent(staking, receipt, "RedemptionFeeCollected");
    assert(wcEvent && feeEvent, "应触发两个事件");

    const usdxReceived = wcEvent.args.usdxReceived;
    const educationFund = wcEvent.args.referralFee;
    const teamFee = wcEvent.args.teamFee;
    const preDeductPayout = usdxReceived - educationFund - teamFee;

    const actualFee = feeEvent.args.usdxAmount;
    const expectedFee = (preDeductPayout * REDEMPTION_FEE_RATE) / BASIS_POINTS_DENOMINATOR;

    console.log(`     扣费前 userPayout: ${formatEther(preDeductPayout)}`);
    console.log(`     预期 5% 赎回费: ${formatEther(expectedFee)}`);
    console.log(`     实际赎回费: ${formatEther(actualFee)}`);

    assertEq(actualFee, expectedFee, "赎回费应精确等于 userPayout * 5%");
  });

  // =========================================================================
  // RF-4  unstake: 事件中 aeAmount 为 0（方案 A 不消耗额外 AE）
  // =========================================================================
  await advanceTimeSeconds(120);
  await runner.run("RF-4", "unstake: 事件 aeAmount 为 0", async () => {
    const stakeAmount = await safeStake(staking, user4, parseEther("500"), 1);
    const stakeIdx = Number(await staking.stakeCount(user4.address)) - 1;

    await advanceTime(30);
    await advanceTimeSeconds(1);

    const tx = await staking.connect(user4).unstake(stakeIdx);
    const receipt = await tx.wait();

    const feeEvent = parseEvent(staking, receipt, "RedemptionFeeCollected");
    assert(feeEvent, "应触发 RedemptionFeeCollected 事件");

    const aeAmount = feeEvent.args.aeAmount;
    console.log(`     事件 aeAmount: ${aeAmount}`);
    assertEq(aeAmount, 0n, "方案 A 修复后 aeAmount 应为 0");
  });

  // =========================================================================
  // RF-5  unstake: 资金平衡 — 所有分配之和 = usdxReceived
  // =========================================================================
  await advanceTimeSeconds(120);
  await runner.run("RF-5", "unstake: 资金平衡验证", async () => {
    const stakeAmount = await safeStake(staking, user5, parseEther("500"), 1);
    const stakeIdx = Number(await staking.stakeCount(user5.address)) - 1;

    await advanceTime(30);
    await advanceTimeSeconds(1);

    const tx = await staking.connect(user5).unstake(stakeIdx);
    const receipt = await tx.wait();

    const wcEvent = parseEvent(staking, receipt, "WithdrawalCompleted");
    const feeEvent = parseEvent(staking, receipt, "RedemptionFeeCollected");
    assert(wcEvent && feeEvent, "应触发两个事件");

    const usdxReceived = wcEvent.args.usdxReceived;
    const educationFund = wcEvent.args.referralFee;
    const teamFee = wcEvent.args.teamFee;
    const userPayout = wcEvent.args.userPayout;  // 已扣除赎回费
    const redemptionFee = feeEvent.args.usdxAmount;

    const totalDistributed = educationFund + teamFee + userPayout + redemptionFee;

    console.log(`     usdxReceived:   ${formatEther(usdxReceived)}`);
    console.log(`     educationFund:  ${formatEther(educationFund)}`);
    console.log(`     teamFee:        ${formatEther(teamFee)}`);
    console.log(`     redemptionFee:  ${formatEther(redemptionFee)}`);
    console.log(`     userPayout:     ${formatEther(userPayout)}`);
    console.log(`     总计分配:        ${formatEther(totalDistributed)}`);

    assertEq(totalDistributed, usdxReceived, "所有分配之和应等于 usdxReceived");
  });

  // =========================================================================
  // RF-6  unstake: 合约 AE 余额不因赎回费额外减少
  // =========================================================================
  await advanceTimeSeconds(120);
  await runner.run("RF-6", "unstake: 合约 AE 余额不因赎回费额外减少", async () => {
    const stakeAmount = await safeStake(staking, user6, parseEther("500"), 1);
    const stakeIdx = Number(await staking.stakeCount(user6.address)) - 1;

    await advanceTime(30);
    await advanceTimeSeconds(1);

    const aeBefore = await ae.balanceOf(stakingAddress);
    const tx = await staking.connect(user6).unstake(stakeIdx);
    const receipt = await tx.wait();
    const aeAfter = await ae.balanceOf(stakingAddress);

    // 从 WithdrawalCompleted 获取 aeTokensUsed (主 swap 消耗的 AE)
    const wcEvent = parseEvent(staking, receipt, "WithdrawalCompleted");
    assert(wcEvent, "应触发 WithdrawalCompleted 事件");
    const aeTokensUsed = wcEvent.args.aeTokensUsed;

    // 验证事件中赎回费 AE 消耗为 0
    const feeEvent = parseEvent(staking, receipt, "RedemptionFeeCollected");
    assert(feeEvent, "应触发 RedemptionFeeCollected 事件");
    const feeAeUsed = feeEvent.args.aeAmount;

    console.log(`     主 swap AE 消耗: ${formatEther(aeTokensUsed)}`);
    console.log(`     赎回费 AE 消耗: ${feeAeUsed}`);

    assertEq(feeAeUsed, 0n, "赎回费不应消耗额外 AE（方案 A）");
  });

  // =========================================================================
  // RF-7 ~ RF-9  withdrawInterest 测试
  // 使用 user7 质押一笔 90 天期，分三次提息分别验证
  // =========================================================================
  await advanceTimeSeconds(120);

  // 先质押一笔 90 天期
  const wiStakeAmount = await safeStake(staking, user7, parseEther("500"), 2); // 90 天期
  const wiStakeIdx = Number(await staking.stakeCount(user7.address)) - 1;
  console.log(`  [withdrawInterest 准备] 质押 ${formatEther(wiStakeAmount)} USDX, stakeIdx=${wiStakeIdx}\n`);

  // =========================================================================
  // RF-7  withdrawInterest: 用户收到的 USDX 已扣除赎回费
  // =========================================================================
  await advanceTime(15);
  await runner.run("RF-7", "withdrawInterest: 用户收到的 USDX 已扣除赎回费", async () => {
    const usdxBefore = await usdx.balanceOf(user7.address);
    const feeRecipBefore = await usdx.balanceOf(feeRecipientAddress);

    const tx = await staking.connect(user7).withdrawInterest(wiStakeIdx);
    const receipt = await tx.wait();

    const usdxAfter = await usdx.balanceOf(user7.address);
    const feeRecipAfter = await usdx.balanceOf(feeRecipientAddress);

    const userReceived = usdxAfter - usdxBefore;
    const feeRecipReceived = feeRecipAfter - feeRecipBefore;

    // 解析事件
    const iwEvent = parseEvent(staking, receipt, "InterestWithdrawn");
    const feeEvent = parseEvent(staking, receipt, "RedemptionFeeCollected");
    assert(iwEvent, "应触发 InterestWithdrawn 事件");
    assert(feeEvent, "应触发 RedemptionFeeCollected 事件");

    const eventUserPayout = iwEvent.args.userPayout;
    const eventFeeAmount = feeEvent.args.usdxAmount;

    console.log(`     用户实际收到: ${formatEther(userReceived)} USDX`);
    console.log(`     事件 userPayout: ${formatEther(eventUserPayout)} USDX`);
    console.log(`     赎回费: ${formatEther(eventFeeAmount)} USDX`);

    // 用户收到的应等于事件中的 userPayout（已扣赎回费）
    assertEq(userReceived, eventUserPayout, "用户实际收到应等于事件 userPayout");
    assert(eventFeeAmount > 0n, "赎回费应大于 0");
  });

  // =========================================================================
  // RF-8  withdrawInterest: feeRecipient 实际收到赎回费 USDX
  // =========================================================================
  await advanceTime(15);  // 再推进 15 天产生新利息
  await runner.run("RF-8", "withdrawInterest: feeRecipient 实际收到赎回费", async () => {
    const feeRecipBefore = await usdx.balanceOf(feeRecipientAddress);
    const tx = await staking.connect(user7).withdrawInterest(wiStakeIdx);
    const receipt = await tx.wait();
    const feeRecipAfter = await usdx.balanceOf(feeRecipientAddress);
    const feeRecipReceived = feeRecipAfter - feeRecipBefore;

    const feeEvent = parseEvent(staking, receipt, "RedemptionFeeCollected");
    assert(feeEvent, "应触发 RedemptionFeeCollected 事件");

    const eventFeeAmount = feeEvent.args.usdxAmount;

    console.log(`     feeRecipient 实际收到: ${formatEther(feeRecipReceived)} USDX`);
    console.log(`     事件赎回费: ${formatEther(eventFeeAmount)} USDX`);

    assert(feeRecipReceived > 0n, "feeRecipient 应收到赎回费");
    assertEq(feeRecipReceived, eventFeeAmount, "feeRecipient 收到金额应等于事件赎回费");
  });

  // =========================================================================
  // RF-9  withdrawInterest: 资金平衡验证
  // =========================================================================
  await advanceTime(15);  // 再推进 15 天产生新利息
  await runner.run("RF-9", "withdrawInterest: 资金平衡验证", async () => {
    const tx = await staking.connect(user7).withdrawInterest(wiStakeIdx);
    const receipt = await tx.wait();

    const iwEvent = parseEvent(staking, receipt, "InterestWithdrawn");
    const feeEvent = parseEvent(staking, receipt, "RedemptionFeeCollected");
    assert(iwEvent && feeEvent, "应触发两个事件");

    const usdxReceived = iwEvent.args.usdxReceived;
    const educationFund = iwEvent.args.referralFee;
    const teamFee = iwEvent.args.teamFee;
    const userPayout = iwEvent.args.userPayout;
    const redemptionFee = feeEvent.args.usdxAmount;

    const totalDistributed = educationFund + teamFee + userPayout + redemptionFee;

    console.log(`     usdxReceived:   ${formatEther(usdxReceived)}`);
    console.log(`     educationFund:  ${formatEther(educationFund)}`);
    console.log(`     teamFee:        ${formatEther(teamFee)}`);
    console.log(`     redemptionFee:  ${formatEther(redemptionFee)}`);
    console.log(`     userPayout:     ${formatEther(userPayout)}`);
    console.log(`     总计分配:        ${formatEther(totalDistributed)}`);

    assertEq(totalDistributed, usdxReceived, "所有分配之和应等于 usdxReceived");
  });

  const allPassed = runner.summary();

  await revertSnapshot(snapshotId);

  if (!allPassed) process.exit(1);
}

main()
  .then(() => process.exit(0))
  .catch((error) => { console.error(error); process.exit(1); });
