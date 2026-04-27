/**
 * C-02: withdrawInterest + unstake 双重利息漏洞修复验证测试
 * 测试项 DI-1 ~ DI-7
 *
 * 验证 _burn() 中扣除已提取利息后, unstake 不会重复发放利息
 * 修复方案: 方案 A — 在 _burn() 中读取 withdrawnInterest 并从 reward 中扣除
 */
const hre = require("hardhat");
const {
  loadDeployment,
  getContracts,
  setUSDXBalance,
  approveUSDX,
  TestRunner,
  assert,
  assertApproxEq,
} = require("../helpers/setup");
const { advanceTime, advanceTimeSeconds, takeSnapshot, revertSnapshot } = require("../helpers/time");

const parseEther = hre.ethers.parseEther;
const formatEther = hre.ethers.formatEther;

async function safeBindReferral(staking, user, referrer) {
  const isBound = await staking.isBindReferral(user.address);
  if (!isBound) {
    await staking.connect(user).lockReferral(referrer);
  }
}

async function setBNBBalance(address) {
  await hre.network.provider.send("hardhat_setBalance", [
    address,
    "0x56BC75E2D63100000", // 100 BNB
  ]);
}

async function prepareUser(usdx, staking, user, stakingAddress, rootAddress) {
  await setBNBBalance(user.address);
  await setUSDXBalance(user.address, parseEther("50000"));
  await approveUSDX(usdx, user, stakingAddress, parseEther("50000"));
  await safeBindReferral(staking, user, rootAddress);
}

/**
 * 安全质押: 检查剩余容量和单次上限
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
function parseEvent(receipt, contract, eventName) {
  for (const log of receipt.logs) {
    try {
      const parsed = contract.interface.parseLog(log);
      if (parsed && parsed.name === eventName) return parsed;
    } catch { /* ignore */ }
  }
  return null;
}

async function main() {
  console.log("\n=== C-02: withdrawInterest + unstake 双重利息漏洞修复验证 (DI-1~DI-7) ===\n");

  const snapshotId = await takeSnapshot();

  const deployment = loadDeployment();
  const { ae, staking, pair, usdx } = await getContracts(deployment);
  const [deployer, ...accounts] = await hre.ethers.getSigners();
  const stakingAddress = deployment.contracts.Staking;
  const rootAddress = deployment.addresses.rootAddress;

  // 使用 accounts[0]~[6] (快照隔离, 不影响其他测试)
  const user1 = accounts[0]; // DI-1: 仅 unstake (无 withdrawInterest)
  const user2 = accounts[1]; // DI-2: 单次 withdrawInterest 后 unstake
  const user3 = accounts[2]; // DI-3: 多次 withdrawInterest 后 unstake
  const user4 = accounts[3]; // DI-4: 到期后 withdrawInterest 再 unstake
  const user5 = accounts[4]; // DI-5: 提取全部利息后立即 unstake
  const user6 = accounts[5]; // DI-6: 对照组 — 两用户同额质押比较
  const user7 = accounts[6]; // DI-6: 对照组用户 B
  const user8 = accounts[7]; // DI-7: 费用基数验证

  const runner = new TestRunner("C-02: 双重利息漏洞修复验证");

  // 准备所有用户
  for (const u of [user1, user2, user3, user4, user5, user6, user7, user8]) {
    await prepareUser(usdx, staking, u, stakingAddress, rootAddress);
  }

  // =========================================================================
  // DI-1: 仅 unstake (无 withdrawInterest) — 行为不变
  // 验证修复不影响正常 unstake 流程
  // =========================================================================
  await advanceTimeSeconds(120);
  await runner.run("DI-1", "仅 unstake (无 withdrawInterest) 行为不变", async () => {
    const stakeAmount = await safeStake(staking, user1, parseEther("500"), 1); // 30 天期
    const stakeIdx = Number(await staking.stakeCount(user1.address)) - 1;

    // 推进 30 天到期
    await advanceTime(30);
    await advanceTimeSeconds(1);

    // 验证 withdrawnInterest 为 0
    const withdrawn = await staking.getWithdrawnInterest(user1.address, stakeIdx);
    assert(withdrawn === 0n, "未调用 withdrawInterest 时已提取利息应为 0");

    // 执行 unstake
    const usdxBefore = await usdx.balanceOf(user1.address);
    const tx = await staking.connect(user1).unstake(stakeIdx);
    const receipt = await tx.wait();
    const usdxAfter = await usdx.balanceOf(user1.address);

    const received = usdxAfter - usdxBefore;
    assert(received > stakeAmount * 80n / 100n, "用户应收到接近本金+利息的 USDX (扣费后)");

    // 从事件中获取利息信息
    const wcEvent = parseEvent(receipt, staking, "WithdrawalCompleted");
    assert(wcEvent, "应触发 WithdrawalCompleted 事件");
    const interestEarned = wcEvent.args.interestEarned;
    assert(interestEarned > 0n, "利息应大于 0");

    console.log(`     质押: ${formatEther(stakeAmount)} USDX`);
    console.log(`     收到: ${formatEther(received)} USDX`);
    console.log(`     利息: ${formatEther(interestEarned)} USDX`);
  });

  // =========================================================================
  // DI-2: 单次 withdrawInterest 后 unstake — 总利息 = 全额利息
  // 核心测试: 验证 unstake 不会重复发放已提取的利息
  // =========================================================================
  await advanceTimeSeconds(120);
  await runner.run("DI-2", "单次 withdrawInterest 后 unstake, 总利息不超过全额利息", async () => {
    const stakeAmount = await safeStake(staking, user2, parseEther("500"), 2); // 90 天期
    const stakeIdx = Number(await staking.stakeCount(user2.address)) - 1;

    // 推进 60 天, 提取利息
    await advanceTime(60);
    const usdxBeforeWI = await usdx.balanceOf(user2.address);
    const wiTx = await staking.connect(user2).withdrawInterest(stakeIdx);
    const wiReceipt = await wiTx.wait();
    const usdxAfterWI = await usdx.balanceOf(user2.address);
    const wiReceived = usdxAfterWI - usdxBeforeWI;

    const wiEvent = parseEvent(wiReceipt, staking, "InterestWithdrawn");
    assert(wiEvent, "应触发 InterestWithdrawn 事件");
    const wiInterestAmount = wiEvent.args.interestAmount; // swap 前的利息额

    console.log(`     60天提取利息 (到账): ${formatEther(wiReceived)} USDX`);
    console.log(`     60天提取利息 (swap 前): ${formatEther(wiInterestAmount)} USDX`);

    // 验证 withdrawnInterest 已更新
    const withdrawnAfterWI = await staking.getWithdrawnInterest(user2.address, stakeIdx);
    assert(withdrawnAfterWI > 0n, "withdrawnInterest 应已更新");

    // 推进到 90 天到期
    await advanceTime(30);
    await advanceTimeSeconds(1);

    // 查询到期时的 full reward (合约层面, 未扣除已提取)
    const fullReward = await staking.rewardOfSlot(user2.address, stakeIdx);
    const fullInterest = fullReward - stakeAmount;
    console.log(`     到期 full reward: ${formatEther(fullReward)} USDX`);
    console.log(`     到期 full interest: ${formatEther(fullInterest)} USDX`);

    // 执行 unstake
    const usdxBeforeUS = await usdx.balanceOf(user2.address);
    const usTx = await staking.connect(user2).unstake(stakeIdx);
    const usReceipt = await usTx.wait();
    const usdxAfterUS = await usdx.balanceOf(user2.address);
    const usReceived = usdxAfterUS - usdxBeforeUS;

    const wcEvent = parseEvent(usReceipt, staking, "WithdrawalCompleted");
    assert(wcEvent, "应触发 WithdrawalCompleted 事件");
    const usInterestEarned = wcEvent.args.interestEarned;

    console.log(`     unstake 收到: ${formatEther(usReceived)} USDX`);
    console.log(`     unstake 利息 (事件): ${formatEther(usInterestEarned)} USDX`);

    // [核心断言] unstake 的 interestEarned 应远小于 full interest
    // 因为大部分利息已通过 withdrawInterest 提取
    assert(
      usInterestEarned < fullInterest,
      `unstake 利息 (${formatEther(usInterestEarned)}) 应小于全额利息 (${formatEther(fullInterest)})`
    );

    // [核心断言] 总利息到账额 ≈ 全额利息的到账额 (两次分别扣费, 允许 15% 偏差)
    // 总用户到账 = wiReceived + usReceived - stakeAmount (扣除本金部分)
    // 注意: usReceived 包含本金返还
    const totalUserInterestReceived = wiReceived + usReceived - stakeAmount;
    console.log(`     总利息到账 (两次合计): ${formatEther(totalUserInterestReceived)} USDX`);
    console.log(`     全额利息 (扣费前): ${formatEther(fullInterest)} USDX`);

    // 如果漏洞未修复, 总利息到账会接近 fullInterest 的 2 倍
    // 修复后, 总利息到账应 <= fullInterest (因为扣了费)
    assert(
      totalUserInterestReceived <= fullInterest,
      `总利息到账 (${formatEther(totalUserInterestReceived)}) 不应超过全额利息 (${formatEther(fullInterest)}), 否则存在双重利息`
    );
  });

  // =========================================================================
  // DI-3: 多次 withdrawInterest 后 unstake — 总利息不超额
  // =========================================================================
  await advanceTimeSeconds(120);
  await runner.run("DI-3", "多次 withdrawInterest 后 unstake, 总利息不超额", async () => {
    const stakeAmount = await safeStake(staking, user3, parseEther("500"), 2); // 90 天期
    const stakeIdx = Number(await staking.stakeCount(user3.address)) - 1;

    let totalWiReceived = 0n;

    // 第1次: 推进 30 天, 提取利息
    await advanceTime(30);
    const usdxB1 = await usdx.balanceOf(user3.address);
    await staking.connect(user3).withdrawInterest(stakeIdx);
    const usdxA1 = await usdx.balanceOf(user3.address);
    const wi1 = usdxA1 - usdxB1;
    totalWiReceived += wi1;
    console.log(`     第1次提取 (30天): ${formatEther(wi1)} USDX`);

    // 第2次: 再推进 30 天, 提取利息
    await advanceTime(30);
    const usdxB2 = await usdx.balanceOf(user3.address);
    await staking.connect(user3).withdrawInterest(stakeIdx);
    const usdxA2 = await usdx.balanceOf(user3.address);
    const wi2 = usdxA2 - usdxB2;
    totalWiReceived += wi2;
    console.log(`     第2次提取 (60天): ${formatEther(wi2)} USDX`);

    // 第3次: 再推进 30 天到期, 提取剩余利息
    await advanceTime(30);
    const avail3 = await staking.getAvailableInterest(user3.address, stakeIdx);
    if (avail3 > 0n) {
      const usdxB3 = await usdx.balanceOf(user3.address);
      await staking.connect(user3).withdrawInterest(stakeIdx);
      const usdxA3 = await usdx.balanceOf(user3.address);
      const wi3 = usdxA3 - usdxB3;
      totalWiReceived += wi3;
      console.log(`     第3次提取 (90天): ${formatEther(wi3)} USDX`);
    }
    await advanceTimeSeconds(1);

    // 查询全额利息
    const fullReward = await staking.rewardOfSlot(user3.address, stakeIdx);
    const fullInterest = fullReward - stakeAmount;
    console.log(`     全额利息: ${formatEther(fullInterest)} USDX`);
    console.log(`     withdrawInterest 累计到账: ${formatEther(totalWiReceived)} USDX`);

    // 执行 unstake
    const usdxBeforeUS = await usdx.balanceOf(user3.address);
    const usTx = await staking.connect(user3).unstake(stakeIdx);
    const usReceipt = await usTx.wait();
    const usdxAfterUS = await usdx.balanceOf(user3.address);
    const usReceived = usdxAfterUS - usdxBeforeUS;

    console.log(`     unstake 收到: ${formatEther(usReceived)} USDX`);

    // [核心断言] 总利息到账不超过全额利息
    const totalUserInterest = totalWiReceived + usReceived - stakeAmount;
    console.log(`     总利息到账: ${formatEther(totalUserInterest)} USDX`);

    assert(
      totalUserInterest <= fullInterest,
      `总利息到账 (${formatEther(totalUserInterest)}) 不应超过全额利息 (${formatEther(fullInterest)})`
    );
  });

  // =========================================================================
  // DI-4: 到期后 withdrawInterest 提取全部利息, 再 unstake
  // unstake 的 reward 应基本等于本金, interestEarned ≈ 0
  // =========================================================================
  await advanceTimeSeconds(120);
  await runner.run("DI-4", "到期后 withdrawInterest 再 unstake, unstake 利息趋近 0", async () => {
    const stakeAmount = await safeStake(staking, user4, parseEther("500"), 1); // 30 天期
    const stakeIdx = Number(await staking.stakeCount(user4.address)) - 1;

    // 推进到到期
    await advanceTime(30);
    await advanceTimeSeconds(1);

    // 先 withdrawInterest 提取全部利息
    const usdxBeforeWI = await usdx.balanceOf(user4.address);
    await staking.connect(user4).withdrawInterest(stakeIdx);
    const usdxAfterWI = await usdx.balanceOf(user4.address);
    const wiReceived = usdxAfterWI - usdxBeforeWI;
    console.log(`     withdrawInterest 到账: ${formatEther(wiReceived)} USDX`);

    // 确认已全部提取
    const availableAfter = await staking.getAvailableInterest(user4.address, stakeIdx);
    assert(availableAfter === 0n, "全部利息应已提取完毕");

    // 执行 unstake
    const usdxBeforeUS = await usdx.balanceOf(user4.address);
    const usTx = await staking.connect(user4).unstake(stakeIdx);
    const usReceipt = await usTx.wait();
    const usdxAfterUS = await usdx.balanceOf(user4.address);
    const usReceived = usdxAfterUS - usdxBeforeUS;

    const wcEvent = parseEvent(usReceipt, staking, "WithdrawalCompleted");
    assert(wcEvent, "应触发 WithdrawalCompleted 事件");
    const usInterestEarned = wcEvent.args.interestEarned;

    console.log(`     unstake 收到: ${formatEther(usReceived)} USDX`);
    console.log(`     unstake interestEarned: ${formatEther(usInterestEarned)} USDX`);

    // [核心断言] unstake 的 interestEarned 应为 0 或接近 0
    // 因为全部利息已通过 withdrawInterest 提取
    // 允许极小的误差 (由于时间推进可能产生的微小利息)
    const tolerance = parseEther("1"); // 允许 1 USDX 误差
    assert(
      usInterestEarned <= tolerance,
      `unstake interestEarned (${formatEther(usInterestEarned)}) 应接近 0`
    );

    // [核心断言] unstake 收到的应约等于本金 (扣除赎回费)
    // 本金返还后扣 5% 赎回费, 但 interestEarned=0 时费用基数也为 0
    // 所以主要是本金 - 赎回费
    assert(
      usReceived >= stakeAmount * 80n / 100n,
      `unstake 收到 (${formatEther(usReceived)}) 应约等于本金`
    );
    assert(
      usReceived <= stakeAmount * 110n / 100n,
      `unstake 收到 (${formatEther(usReceived)}) 不应明显超过本金`
    );
  });

  // =========================================================================
  // DI-5: 从未 withdrawInterest 的用户 unstake — alreadyWithdrawn = 0, 行为不变
  // 与 DI-1 类似, 但使用 90 天期并验证更详细的数值
  // =========================================================================
  await advanceTimeSeconds(120);
  await runner.run("DI-5", "从未 withdrawInterest 的 90 天期 unstake 行为不变", async () => {
    const stakeAmount = await safeStake(staking, user5, parseEther("500"), 2); // 90 天期
    const stakeIdx = Number(await staking.stakeCount(user5.address)) - 1;

    // 推进到到期
    await advanceTime(90);
    await advanceTimeSeconds(1);

    // 查询 full reward
    const fullReward = await staking.rewardOfSlot(user5.address, stakeIdx);
    const fullInterest = fullReward - stakeAmount;

    // 验证 withdrawnInterest 为 0
    const withdrawn = await staking.getWithdrawnInterest(user5.address, stakeIdx);
    assert(withdrawn === 0n, "未调用 withdrawInterest 时已提取利息应为 0");

    // 执行 unstake
    const usdxBefore = await usdx.balanceOf(user5.address);
    const tx = await staking.connect(user5).unstake(stakeIdx);
    const receipt = await tx.wait();
    const usdxAfter = await usdx.balanceOf(user5.address);
    const received = usdxAfter - usdxBefore;

    const wcEvent = parseEvent(receipt, staking, "WithdrawalCompleted");
    assert(wcEvent, "应触发 WithdrawalCompleted 事件");
    const interestEarned = wcEvent.args.interestEarned;

    console.log(`     90天期 full reward: ${formatEther(fullReward)} USDX`);
    console.log(`     full interest: ${formatEther(fullInterest)} USDX`);
    console.log(`     unstake interestEarned: ${formatEther(interestEarned)} USDX`);
    console.log(`     用户收到: ${formatEther(received)} USDX`);

    // interestEarned 应接近 fullInterest (swap 滑点导致偏差, 允许 15%)
    const tolerance = fullInterest * 15n / 100n;
    assertApproxEq(
      interestEarned,
      fullInterest,
      tolerance,
      "未提取利息的 unstake interestEarned 应接近 full interest"
    );
  });

  // =========================================================================
  // DI-6: 对照组 — 两用户同额质押, 一个 withdrawInterest + unstake, 一个仅 unstake
  // 两者的总利息到账应基本一致
  // =========================================================================
  await advanceTimeSeconds(120);
  await runner.run("DI-6", "对照组: withdrawInterest+unstake vs 仅 unstake, 总利息一致", async () => {
    // 两用户同时质押相同金额, 使用相同 stakeIndex
    const stakeAmount6 = await safeStake(staking, user6, parseEther("500"), 1); // 30 天期
    const stakeIdx6 = Number(await staking.stakeCount(user6.address)) - 1;

    await advanceTimeSeconds(120);
    const stakeAmount7 = await safeStake(staking, user7, parseEther("500"), 1); // 30 天期
    const stakeIdx7 = Number(await staking.stakeCount(user7.address)) - 1;

    // 推进 20 天, user6 提取利息
    await advanceTime(20);
    const usdxB6WI = await usdx.balanceOf(user6.address);
    await staking.connect(user6).withdrawInterest(stakeIdx6);
    const usdxA6WI = await usdx.balanceOf(user6.address);
    const user6WiReceived = usdxA6WI - usdxB6WI;
    console.log(`     user6 第20天 withdrawInterest: ${formatEther(user6WiReceived)} USDX`);

    // 推进到 30 天到期
    await advanceTime(10);
    await advanceTimeSeconds(1);

    // user6: unstake
    const usdxB6US = await usdx.balanceOf(user6.address);
    await staking.connect(user6).unstake(stakeIdx6);
    const usdxA6US = await usdx.balanceOf(user6.address);
    const user6UsReceived = usdxA6US - usdxB6US;

    // user7: 仅 unstake
    const usdxB7 = await usdx.balanceOf(user7.address);
    await staking.connect(user7).unstake(stakeIdx7);
    const usdxA7 = await usdx.balanceOf(user7.address);
    const user7Received = usdxA7 - usdxB7;

    // user6 总利息到账 = withdrawInterest 到账 + unstake 到账 - 本金
    const user6TotalInterest = user6WiReceived + user6UsReceived - stakeAmount6;
    // user7 总利息到账 = unstake 到账 - 本金
    const user7TotalInterest = user7Received - stakeAmount7;

    console.log(`     user6 (WI+US) 总利息到账: ${formatEther(user6TotalInterest)} USDX`);
    console.log(`     user7 (仅 US) 总利息到账: ${formatEther(user7TotalInterest)} USDX`);

    // [核心断言] 两者总利息应大致相等 (允许 20% 偏差, 因为 swap 时机不同导致价格差异)
    const tolerance = user7TotalInterest * 20n / 100n > 0n
      ? user7TotalInterest * 20n / 100n
      : parseEther("5");
    assertApproxEq(
      user6TotalInterest,
      user7TotalInterest,
      tolerance,
      "两用户总利息应大致相等"
    );

    // [核心断言] 如果漏洞未修复, user6 总利息约为 user7 的 2 倍
    // 修复后 user6TotalInterest / user7TotalInterest 应 < 1.5
    if (user7TotalInterest > 0n) {
      const ratio = (user6TotalInterest * 100n) / user7TotalInterest;
      console.log(`     利息比率 (user6/user7): ${Number(ratio)}%`);
      assert(
        ratio < 150n,
        `利息比率 ${Number(ratio)}% 不应超过 150%, 否则可能存在双重利息`
      );
    }
  });

  // =========================================================================
  // DI-7: H-02 费用基数验证 — unstake 时 interestEarned 不含已提取利息
  // 验证修复同时消除了 H-02 (费用基数膨胀) 问题
  // =========================================================================
  await advanceTimeSeconds(120);
  await runner.run("DI-7", "H-02 修复: unstake 费用基数不含已提取利息", async () => {
    const stakeAmount = await safeStake(staking, user8, parseEther("500"), 1); // 30 天期
    const stakeIdx = Number(await staking.stakeCount(user8.address)) - 1;

    // 推进 20 天, 提取利息
    await advanceTime(20);
    const wiTx = await staking.connect(user8).withdrawInterest(stakeIdx);
    const wiReceipt = await wiTx.wait();
    const wiEvent = parseEvent(wiReceipt, staking, "InterestWithdrawn");
    assert(wiEvent, "应触发 InterestWithdrawn 事件");
    const wiInterestAmount = wiEvent.args.interestAmount;
    console.log(`     withdrawInterest 利息额: ${formatEther(wiInterestAmount)} USDX`);

    // 推进到到期
    await advanceTime(10);
    await advanceTimeSeconds(1);

    // 查询全额利息
    const fullReward = await staking.rewardOfSlot(user8.address, stakeIdx);
    const fullInterest = fullReward - stakeAmount;

    // 执行 unstake
    const usTx = await staking.connect(user8).unstake(stakeIdx);
    const usReceipt = await usTx.wait();

    const wcEvent = parseEvent(usReceipt, staking, "WithdrawalCompleted");
    assert(wcEvent, "应触发 WithdrawalCompleted 事件");
    const usInterestEarned = wcEvent.args.interestEarned;
    const usReferralFee = wcEvent.args.referralFee;  // 教育基金 (事件字段名为 referralFee)
    const usTeamFee = wcEvent.args.teamFee;

    console.log(`     full interest: ${formatEther(fullInterest)} USDX`);
    console.log(`     unstake interestEarned: ${formatEther(usInterestEarned)} USDX`);
    console.log(`     unstake referralFee (教育基金): ${formatEther(usReferralFee)} USDX`);
    console.log(`     unstake teamFee: ${formatEther(usTeamFee)} USDX`);

    // [核心断言] unstake 的 interestEarned 应小于全额利息
    // (因为已提取部分的利息不再纳入)
    assert(
      usInterestEarned < fullInterest,
      `unstake interestEarned (${formatEther(usInterestEarned)}) 应 < 全额利息 (${formatEther(fullInterest)})`
    );

    // [核心断言] unstake 的 interestEarned 应约等于 fullInterest - wiInterestAmount
    // 允许 15% 偏差 (swap 滑点)
    const expectedUsInterest = fullInterest - wiInterestAmount;
    if (expectedUsInterest > 0n) {
      const tolerance = expectedUsInterest * 15n / 100n > parseEther("1")
        ? expectedUsInterest * 15n / 100n
        : parseEther("1");
      console.log(`     预期 unstake 利息: ${formatEther(expectedUsInterest)} USDX`);
      assertApproxEq(
        usInterestEarned,
        expectedUsInterest,
        tolerance,
        "unstake interestEarned 应约等于 fullInterest - 已提取利息"
      );
    }

    // [核心断言] 费用不应基于全额利息计算
    // 教育基金 (referralFee) = interestEarned 的 5%, 如果费用基于全额利息, 教育基金会偏高
    if (usInterestEarned > 0n) {
      const expectedEduFund = usInterestEarned * 5n / 100n;
      const eduTolerance = expectedEduFund * 20n / 100n > parseEther("0.5")
        ? expectedEduFund * 20n / 100n
        : parseEther("0.5");
      assertApproxEq(
        usReferralFee,
        expectedEduFund,
        eduTolerance,
        "教育基金应基于 unstake 的实际 interestEarned 计算"
      );
    }
  });

  const allPassed = runner.summary();

  // 恢复快照
  await revertSnapshot(snapshotId);

  if (!allPassed) process.exit(1);
}

main()
  .then(() => process.exit(0))
  .catch((error) => { console.error(error); process.exit(1); });
