/**
 * P0: compoundStartTime 修复验证测试
 * 测试项 CST-1 ~ CST-7
 *
 * 验证两项修复：
 * 1. 提息后复利从 compoundStartTime 重新起算，不再全周期重复计算（P0 复利多算）
 * 2. compoundStartTime 对齐到复利周期边界，避免整除截断少算一天（P0 少算一天）
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
const {
  advanceTime,
  advanceTimeSeconds,
  getBlockTimestamp,
  takeSnapshot,
  revertSnapshot,
} = require("../helpers/time");

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

async function safeStake(staking, user, desiredAmount, stakeIndex) {
  const remaining = await staking.getRemainingStakeCapacity(user.address);
  const maxSingle = await staking.maxStakeAmount();
  let amount = desiredAmount;
  if (remaining < amount) amount = remaining;
  if (maxSingle < amount) amount = maxSingle;
  assert(
    amount >= parseEther("100"),
    `剩余容量不足最低质押额: remaining=${formatEther(remaining)}, maxSingle=${formatEther(maxSingle)}`
  );
  await staking.connect(user).stake(amount, stakeIndex);
  return amount;
}

function parseEvent(receipt, contract, eventName) {
  for (const log of receipt.logs) {
    try {
      const parsed = contract.interface.parseLog(log);
      if (parsed && parsed.name === eventName) return parsed;
    } catch {
      /* ignore */
    }
  }
  return null;
}

async function main() {
  console.log(
    "\n=== P0: compoundStartTime 修复验证 (CST-1~CST-7) ===\n"
  );

  const snapshotId = await takeSnapshot();

  const deployment = loadDeployment();
  const { ae, staking, pair, usdx } = await getContracts(deployment);
  const [deployer, ...accounts] = await hre.ethers.getSigners();
  const stakingAddress = deployment.contracts.Staking;
  const rootAddress = deployment.addresses.rootAddress;

  // 使用 accounts[0]~[7]
  const user1 = accounts[0]; // CST-1
  const user2 = accounts[1]; // CST-2
  const user3 = accounts[2]; // CST-3A (提息+解押)
  const user4 = accounts[3]; // CST-3B (纯解押对照)
  const user5 = accounts[4]; // CST-4
  const user6 = accounts[5]; // CST-5
  const user7 = accounts[6]; // CST-6
  const user8 = accounts[7]; // CST-7

  const runner = new TestRunner("P0: compoundStartTime 修复验证");

  // 准备所有用户
  for (const u of [user1, user2, user3, user4, user5, user6, user7, user8]) {
    await prepareUser(usdx, staking, u, stakingAddress, rootAddress);
  }

  // =========================================================================
  // CST-1: 质押7天, 第1天后提息, 第7天解押 — 第二段应得6天复利（非5天）
  // 这是用户报告的核心场景：整除截断导致少算一天
  // =========================================================================
  await advanceTimeSeconds(120);
  await runner.run(
    "CST-1",
    "7天期: 第1天提息后, 解押应得6天复利(非5天)",
    async () => {
      const stakeAmount = await safeStake(
        staking,
        user1,
        parseEther("1000"),
        0
      ); // 7天期, 0.6% daily
      const stakeIdx = Number(await staking.stakeCount(user1.address)) - 1;

      // 推进 1 天 + 几秒 (模拟真实场景, 不可能恰好在整天边界)
      await advanceTime(1);
      await advanceTimeSeconds(30);

      // 提取利息
      const wiTx = await staking.connect(user1).withdrawInterest(stakeIdx);
      const wiReceipt = await wiTx.wait();
      const wiEvent = parseEvent(wiReceipt, staking, "InterestWithdrawn");
      assert(wiEvent, "应触发 InterestWithdrawn 事件");
      const wiInterest = wiEvent.args.interestAmount;
      console.log(
        `     第1天提取利息 (AE计价): ${formatEther(wiInterest)}`
      );

      // 验证 compoundStartTime 被更新 (查看 record)
      const record = await staking.userStakeRecord(user1.address, stakeIdx);
      assert(
        record.compoundStartTime > 0n,
        "compoundStartTime 应已被设置"
      );
      console.log(
        `     stakeTime: ${record.stakeTime}, compoundStartTime: ${record.compoundStartTime}`
      );

      // compoundStartTime 应该对齐到1天边界: 等于 stakeTime + 1天
      const expectedCompoundStart =
        BigInt(record.stakeTime) + BigInt(86400);
      assert(
        BigInt(record.compoundStartTime) === expectedCompoundStart,
        `compoundStartTime (${record.compoundStartTime}) 应对齐到 stakeTime+1天 (${expectedCompoundStart})`
      );

      // 推进到第7天到期 (已经过了 1天+30秒, 再推 6天确保到期)
      await advanceTime(6);
      await advanceTimeSeconds(600); // 加点余量确保超过到期时间

      // 查询当前 reward (基于 compoundStartTime 的复利值)
      const currentReward = await staking.rewardOfSlot(
        user1.address,
        stakeIdx
      );
      const currentInterest = currentReward - stakeAmount;
      console.log(
        `     解押前 reward: ${formatEther(currentReward)}, 利息: ${formatEther(currentInterest)}`
      );

      // [核心断言] 第二段利息应基于6天计算
      // 0.6% daily, 6天复利: 1000 * (1.006^6 - 1) ≈ 36.54 USDX
      // 5天复利: 1000 * (1.006^5 - 1) ≈ 30.36 USDX
      // 1天利息: 1000 * 0.006 = 6 USDX
      // 如果计算正确(6天), 利息应 > 35 USDX
      // 如果截断(5天), 利息会 ≈ 30 USDX
      const sixDayInterest = parseEther("35"); // 6天下限
      const fiveDayInterest = parseEther("31"); // 5天上限
      assert(
        currentInterest > sixDayInterest,
        `第二段利息 (${formatEther(currentInterest)}) 应 > 35 USDX (6天下限), 如 ≈ 30 则说明只算了5天`
      );
      console.log(`     ✓ 第二段利息 > 35 USDX, 确认是6天复利`);

      // 执行 unstake 验证可以正常解押
      const usdxBefore = await usdx.balanceOf(user1.address);
      await staking.connect(user1).unstake(stakeIdx);
      const usdxAfter = await usdx.balanceOf(user1.address);
      const received = usdxAfter - usdxBefore;
      console.log(`     unstake 收到: ${formatEther(received)} USDX`);
      assert(received > 0n, "unstake 应收到 USDX");
    }
  );

  // =========================================================================
  // CST-2: 质押30天, 第15天+几秒提息, 解押时应得15天复利
  // 验证非7天档位也能正确对齐
  // =========================================================================
  await advanceTimeSeconds(120);
  await runner.run(
    "CST-2",
    "30天期: 第15天提息后, 解押应得15天复利",
    async () => {
      const stakeAmount = await safeStake(
        staking,
        user2,
        parseEther("500"),
        1
      ); // 30天期, 0.9% daily
      const stakeIdx = Number(await staking.stakeCount(user2.address)) - 1;

      // 推进 15 天 + 几秒
      await advanceTime(15);
      await advanceTimeSeconds(100);

      // 提取利息
      const wiBefore = await usdx.balanceOf(user2.address);
      await staking.connect(user2).withdrawInterest(stakeIdx);
      const wiAfter = await usdx.balanceOf(user2.address);
      const wiReceived = wiAfter - wiBefore;
      console.log(
        `     第15天提取利息 (到账): ${formatEther(wiReceived)} USDX`
      );

      // 验证对齐: compoundStartTime = stakeTime + 15天
      const record = await staking.userStakeRecord(user2.address, stakeIdx);
      const expectedCompoundStart =
        BigInt(record.stakeTime) + BigInt(15 * 86400);
      assert(
        BigInt(record.compoundStartTime) === expectedCompoundStart,
        `compoundStartTime 应对齐到 stakeTime+15天`
      );

      // 推进到30天到期
      await advanceTime(15);
      await advanceTimeSeconds(600);

      // 查询第二段利息
      const currentReward = await staking.rewardOfSlot(
        user2.address,
        stakeIdx
      );
      const secondInterest = currentReward - stakeAmount;

      // 15天 × 0.9% daily: 500 * (1.009^15 - 1) ≈ 72.16 USDX
      // 14天: 500 * (1.009^14 - 1) ≈ 66.79 USDX
      const fifteenDayLowerBound = parseEther("70");
      assert(
        secondInterest > fifteenDayLowerBound,
        `第二段利息 (${formatEther(secondInterest)}) 应 > 70 USDX (15天下限), 如 < 67 则只算了14天`
      );
      console.log(
        `     第二段利息: ${formatEther(secondInterest)} USDX ✓ (15天)`
      );

      // 执行 unstake
      await staking.connect(user2).unstake(stakeIdx);
    }
  );

  // =========================================================================
  // CST-3: 对照组 — 提息用户 vs 纯持有用户, 总收益不应超过纯持有
  // 验证 P0 复利多算问题已修复
  // =========================================================================
  await advanceTimeSeconds(120);
  await runner.run(
    "CST-3",
    "对照组: 提息+解押 总收益 <= 纯持有解押",
    async () => {
      // user3: 提息+解押, user4: 纯持有解押, 同时质押
      const stakeAmount3 = await safeStake(
        staking,
        user3,
        parseEther("500"),
        1
      ); // 30天期
      await advanceTimeSeconds(5);
      const stakeAmount4 = await safeStake(
        staking,
        user4,
        parseEther("500"),
        1
      ); // 30天期
      const stakeIdx3 =
        Number(await staking.stakeCount(user3.address)) - 1;
      const stakeIdx4 =
        Number(await staking.stakeCount(user4.address)) - 1;

      // 第10天: user3 提息
      await advanceTime(10);
      const u3WiBefore = await usdx.balanceOf(user3.address);
      await staking.connect(user3).withdrawInterest(stakeIdx3);
      const u3WiAfter = await usdx.balanceOf(user3.address);
      const u3WiReceived = u3WiAfter - u3WiBefore;

      // 第20天: user3 再次提息
      await advanceTime(10);
      const u3Wi2Before = await usdx.balanceOf(user3.address);
      await staking.connect(user3).withdrawInterest(stakeIdx3);
      const u3Wi2After = await usdx.balanceOf(user3.address);
      const u3Wi2Received = u3Wi2After - u3Wi2Before;

      // 推进到到期
      await advanceTime(10);
      await advanceTimeSeconds(600);

      // user3: unstake
      const u3UsBefore = await usdx.balanceOf(user3.address);
      await staking.connect(user3).unstake(stakeIdx3);
      const u3UsAfter = await usdx.balanceOf(user3.address);
      const u3UsReceived = u3UsAfter - u3UsBefore;

      // user4: unstake (纯持有)
      const u4UsBefore = await usdx.balanceOf(user4.address);
      await staking.connect(user4).unstake(stakeIdx4);
      const u4UsAfter = await usdx.balanceOf(user4.address);
      const u4UsReceived = u4UsAfter - u4UsBefore;

      const u3TotalInterest =
        u3WiReceived + u3Wi2Received + u3UsReceived - stakeAmount3;
      const u4TotalInterest = u4UsReceived - stakeAmount4;

      console.log(
        `     user3 (提息×2+解押) 总利息到账: ${formatEther(u3TotalInterest)} USDX`
      );
      console.log(
        `     user4 (纯持有解押) 总利息到账: ${formatEther(u4TotalInterest)} USDX`
      );

      // [核心断言] 提息用户总收益不应超过纯持有用户
      // 因为分多次提取, 每次都扣费, 实际到账应略少
      assert(
        u3TotalInterest <= u4TotalInterest + parseEther("5"),
        `提息用户总利息 (${formatEther(u3TotalInterest)}) 不应超过纯持有用户 (${formatEther(u4TotalInterest)}), 否则存在复利多算`
      );

      // 如果 P0 未修复, user3 总利息会远超 user4 (可能数倍)
      if (u4TotalInterest > 0n) {
        const ratio =
          (u3TotalInterest * 100n) / u4TotalInterest;
        console.log(
          `     利息比率 (user3/user4): ${Number(ratio)}%`
        );
        assert(
          ratio < 120n,
          `利息比率 ${Number(ratio)}% 不应超过 120%, 否则可能存在复利多算`
        );
      }
    }
  );

  // =========================================================================
  // CST-4: 到期后提取全部利息再 unstake, unstake 利息趋近 0
  // =========================================================================
  await advanceTimeSeconds(120);
  await runner.run(
    "CST-4",
    "到期后全额提息再 unstake, 解押利息趋近 0",
    async () => {
      const stakeAmount = await safeStake(
        staking,
        user5,
        parseEther("500"),
        0
      ); // 7天期
      const stakeIdx = Number(await staking.stakeCount(user5.address)) - 1;

      // 推进到到期
      await advanceTime(7);
      await advanceTimeSeconds(600);

      // 全额提息
      const wiBefore = await usdx.balanceOf(user5.address);
      await staking.connect(user5).withdrawInterest(stakeIdx);
      const wiAfter = await usdx.balanceOf(user5.address);
      const wiReceived = wiAfter - wiBefore;
      console.log(
        `     全额提息 (到账): ${formatEther(wiReceived)} USDX`
      );

      // 可用利息应为 0
      const availAfter = await staking.getAvailableInterest(
        user5.address,
        stakeIdx
      );
      assert(
        availAfter === 0n,
        `提息后可用利息应为 0, 实际: ${formatEther(availAfter)}`
      );

      // unstake
      const usBefore = await usdx.balanceOf(user5.address);
      const usTx = await staking.connect(user5).unstake(stakeIdx);
      const usReceipt = await usTx.wait();
      const usAfter = await usdx.balanceOf(user5.address);
      const usReceived = usAfter - usBefore;

      const wcEvent = parseEvent(usReceipt, staking, "WithdrawalCompleted");
      assert(wcEvent, "应触发 WithdrawalCompleted 事件");
      const usInterestEarned = wcEvent.args.interestEarned;

      console.log(
        `     unstake 收到: ${formatEther(usReceived)} USDX`
      );
      console.log(
        `     unstake interestEarned: ${formatEther(usInterestEarned)} USDX`
      );

      // [核心断言] unstake 利息应趋近 0 (允许极小误差)
      assert(
        usInterestEarned <= parseEther("1"),
        `unstake 利息 (${formatEther(usInterestEarned)}) 应趋近 0`
      );

      // unstake 收到的应约等于本金
      assert(
        usReceived >= (stakeAmount * 80n) / 100n,
        "unstake 应返还接近本金的金额"
      );
    }
  );

  // =========================================================================
  // CST-5: 从未提息的用户, 行为与修复前完全一致
  // =========================================================================
  await advanceTimeSeconds(120);
  await runner.run(
    "CST-5",
    "从未提息的用户, unstake 行为不变",
    async () => {
      const stakeAmount = await safeStake(
        staking,
        user6,
        parseEther("500"),
        1
      ); // 30天期
      const stakeIdx = Number(await staking.stakeCount(user6.address)) - 1;

      // 验证 compoundStartTime 已初始化
      const record = await staking.userStakeRecord(user6.address, stakeIdx);
      assert(
        record.compoundStartTime > 0n,
        "新质押的 compoundStartTime 应已初始化"
      );
      assert(
        BigInt(record.compoundStartTime) === BigInt(record.stakeTime),
        "compoundStartTime 初始值应等于 stakeTime"
      );

      // 推进到到期
      await advanceTime(30);
      await advanceTimeSeconds(600);

      // 查询全额 reward
      const fullReward = await staking.rewardOfSlot(
        user6.address,
        stakeIdx
      );
      const fullInterest = fullReward - stakeAmount;

      // 30天 × 0.9% daily: 500 * (1.009^30 - 1) ≈ 154.62 USDX
      assert(
        fullInterest > parseEther("150"),
        `30天利息 (${formatEther(fullInterest)}) 应 > 150 USDX`
      );

      // unstake
      const usdxBefore = await usdx.balanceOf(user6.address);
      const tx = await staking.connect(user6).unstake(stakeIdx);
      const receipt = await tx.wait();
      const usdxAfter = await usdx.balanceOf(user6.address);
      const received = usdxAfter - usdxBefore;

      const wcEvent = parseEvent(receipt, staking, "WithdrawalCompleted");
      assert(wcEvent, "应触发 WithdrawalCompleted 事件");
      const interestEarned = wcEvent.args.interestEarned;

      console.log(
        `     full interest: ${formatEther(fullInterest)} USDX`
      );
      console.log(
        `     unstake interestEarned: ${formatEther(interestEarned)} USDX`
      );
      console.log(`     用户收到: ${formatEther(received)} USDX`);

      // interestEarned 应接近 fullInterest (swap 滑点允许偏差)
      const tolerance = (fullInterest * 15n) / 100n;
      assertApproxEq(
        interestEarned,
        fullInterest,
        tolerance,
        "从未提息的用户, interestEarned 应接近 full interest"
      );
    }
  );

  // =========================================================================
  // CST-6: 多次提息 (3次) + 解押, 每段都是正确天数
  // =========================================================================
  await advanceTimeSeconds(120);
  await runner.run(
    "CST-6",
    "90天期: 每30天提息一次, 每段都算30天复利",
    async () => {
      const stakeAmount = await safeStake(
        staking,
        user7,
        parseEther("500"),
        2
      ); // 90天期, 1.1% daily
      const stakeIdx = Number(await staking.stakeCount(user7.address)) - 1;

      const record0 = await staking.userStakeRecord(
        user7.address,
        stakeIdx
      );
      const originalStakeTime = BigInt(record0.stakeTime);

      // 第1次提息: 30天 + 几秒
      await advanceTime(30);
      await advanceTimeSeconds(50);
      await staking.connect(user7).withdrawInterest(stakeIdx);
      const record1 = await staking.userStakeRecord(
        user7.address,
        stakeIdx
      );
      const cs1 = BigInt(record1.compoundStartTime);
      assert(
        cs1 === originalStakeTime + BigInt(30 * 86400),
        `第1次提息后 compoundStartTime 应对齐到 +30天`
      );
      console.log(`     第1次提息后 compoundStartTime 对齐 ✓`);

      // 第2次提息: 再30天 + 几秒
      await advanceTime(30);
      await advanceTimeSeconds(80);
      await staking.connect(user7).withdrawInterest(stakeIdx);
      const record2 = await staking.userStakeRecord(
        user7.address,
        stakeIdx
      );
      const cs2 = BigInt(record2.compoundStartTime);
      assert(
        cs2 === originalStakeTime + BigInt(60 * 86400),
        `第2次提息后 compoundStartTime 应对齐到 +60天`
      );
      console.log(`     第2次提息后 compoundStartTime 对齐 ✓`);

      // 推进到到期
      await advanceTime(30);
      await advanceTimeSeconds(600);

      // 第三段利息应基于30天
      const currentReward = await staking.rewardOfSlot(
        user7.address,
        stakeIdx
      );
      const thirdInterest = currentReward - stakeAmount;
      // 30天 × 1.1% daily: 500 * (1.011^30 - 1) ≈ 194.01 USDX
      assert(
        thirdInterest > parseEther("190"),
        `第三段利息 (${formatEther(thirdInterest)}) 应基于30天 (> 190 USDX)`
      );
      console.log(
        `     第三段利息: ${formatEther(thirdInterest)} USDX ✓ (30天)`
      );

      // unstake
      await staking.connect(user7).unstake(stakeIdx);
    }
  );

  // =========================================================================
  // CST-7: compoundStartTime 向后兼容 (模拟老记录 compoundStartTime=0)
  // 老记录应回退使用 stakeTime
  // =========================================================================
  await advanceTimeSeconds(120);
  await runner.run(
    "CST-7",
    "向后兼容: 新质押 compoundStartTime 正确初始化",
    async () => {
      const stakeAmount = await safeStake(
        staking,
        user8,
        parseEther("500"),
        0
      ); // 7天期
      const stakeIdx = Number(await staking.stakeCount(user8.address)) - 1;

      const record = await staking.userStakeRecord(user8.address, stakeIdx);

      // 新质押的 compoundStartTime 不应为 0
      assert(
        record.compoundStartTime > 0n,
        "新质押 compoundStartTime 不应为 0"
      );

      // compoundStartTime 应等于 stakeTime
      assert(
        BigInt(record.compoundStartTime) === BigInt(record.stakeTime),
        `compoundStartTime (${record.compoundStartTime}) 应等于 stakeTime (${record.stakeTime})`
      );
      console.log(
        `     compoundStartTime = stakeTime = ${record.compoundStartTime} ✓`
      );

      // 推进到到期, 验证正常 unstake
      await advanceTime(7);
      await advanceTimeSeconds(600);

      const reward = await staking.rewardOfSlot(user8.address, stakeIdx);
      const interest = reward - stakeAmount;
      // 7天 × 0.6% daily: 500 * (1.006^7 - 1) ≈ 21.38 USDX
      assert(
        interest > parseEther("20"),
        `7天利息 (${formatEther(interest)}) 应 > 20 USDX`
      );
      console.log(
        `     7天利息: ${formatEther(interest)} USDX ✓`
      );

      await staking.connect(user8).unstake(stakeIdx);
    }
  );

  const allPassed = runner.summary();

  await revertSnapshot(snapshotId);

  if (!allPassed) process.exit(1);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
