/**
 * 每日全网质押限额功能测试
 * 测试项 DL-1 ~ DL-9
 *
 * 验证每日全网质押限额机制:
 * - 每日全网限额 50,000 USDX
 * - 刷新时间: 北京时间 14:00 (UTC 06:00)
 * - 惰性重置 (Lazy Reset): 下一次 stake() 调用时自动重置
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
  USDX_ADDRESS,
} = require("../helpers/setup");
const {
  advanceTimeSeconds,
  getBlockTimestamp,
  takeSnapshot,
  revertSnapshot,
} = require("../helpers/time");

async function safeBindReferral(staking, user, referrer) {
  const isBound = await staking.isBindReferral(user.address);
  if (!isBound) {
    await staking.connect(user).lockReferral(referrer);
  }
}

function errorContains(error, keyword) {
  const msg = error.message || String(error);
  return msg.toLowerCase().includes(keyword.toLowerCase());
}

async function main() {
  console.log("\n=== 每日全网质押限额功能测试 (DL-1~DL-9) ===\n");

  const snapshotId = await takeSnapshot();

  const deployment = loadDeployment();
  const { ae, staking, pair, usdx, router } = await getContracts(deployment);
  const [deployer, ...accounts] = await hre.ethers.getSigners();
  const stakingAddress = deployment.contracts.Staking;
  const rootAddress = deployment.addresses.rootAddress;

  const parseEther = hre.ethers.parseEther;
  const formatEther = hre.ethers.formatEther;

  // 使用靠后的账户避免与其他模块冲突
  const userA = accounts[30];
  const userB = accounts[31];
  const userC = accounts[32];
  const userD = accounts[33];
  const userE = accounts[34];

  const runner = new TestRunner("每日全网质押限额功能");

  // 准备: 设置余额和授权
  for (const u of [userA, userB, userC, userD, userE]) {
    await setUSDXBalance(u.address, parseEther("100000"));
    await approveUSDX(usdx, u, stakingAddress, parseEther("100000"));
    await safeBindReferral(staking, u, rootAddress);
  }

  // =========================================================================
  // DL-1: 限额常量验证
  // DAILY_NETWORK_STAKE_LIMIT = 50,000 USDX
  // =========================================================================
  await runner.run("DL-1", "限额常量验证: DAILY_NETWORK_STAKE_LIMIT = 50,000 USDX", async () => {
    // 初始状态: 还没人质押过, 剩余额度应为 50,000
    const remaining = await staking.getDailyStakeRemaining();
    assertEq(remaining, parseEther("50000"), "初始剩余额度应为 50,000 USDX");
    console.log(`     每日全网限额: ${formatEther(remaining)} USDX`);
  });

  // =========================================================================
  // DL-2: 正常质押消耗额度
  // 质押 500 USDX 后，剩余额度减少 500
  // =========================================================================
  await advanceTimeSeconds(120);
  await runner.run("DL-2", "正常质押消耗额度: 质押 500 USDX 后额度减少", async () => {
    const stakeAmount = parseEther("500");

    const remainingBefore = await staking.getDailyStakeRemaining();
    const usedBefore = await staking.getDailyStakeUsed();

    const tx = await staking.connect(userA).stake(stakeAmount, 1);
    const receipt = await tx.wait();
    assert(receipt.status === 1, "质押交易应成功");

    const remainingAfter = await staking.getDailyStakeRemaining();
    const usedAfter = await staking.getDailyStakeUsed();

    assertEq(
      remainingBefore - remainingAfter,
      stakeAmount,
      "剩余额度应减少 500 USDX"
    );
    assertEq(
      usedAfter - usedBefore,
      stakeAmount,
      "已使用额度应增加 500 USDX"
    );

    console.log(`     质押前剩余: ${formatEther(remainingBefore)} USDX`);
    console.log(`     质押后剩余: ${formatEther(remainingAfter)} USDX`);
    console.log(`     已使用额度: ${formatEther(usedAfter)} USDX`);
  });

  // =========================================================================
  // DL-3: 多用户共享限额
  // 用户 A 质押后，用户 B 的可用额度同步减少
  // =========================================================================
  await advanceTimeSeconds(120);
  await runner.run("DL-3", "多用户共享限额: 用户 A 质押后用户 B 可用额度同步减少", async () => {
    const remainingBefore = await staking.getDailyStakeRemaining();

    // 用户 B 质押 300 USDX
    const stakeAmountB = parseEther("300");
    await staking.connect(userB).stake(stakeAmountB, 1);

    const remainingAfterB = await staking.getDailyStakeRemaining();
    assertEq(
      remainingBefore - remainingAfterB,
      stakeAmountB,
      "用户 B 质押后，全网剩余额度应减少"
    );

    // 用户 C 质押 200 USDX
    await advanceTimeSeconds(120);
    const stakeAmountC = parseEther("200");
    await staking.connect(userC).stake(stakeAmountC, 1);

    const remainingAfterC = await staking.getDailyStakeRemaining();
    assertEq(
      remainingAfterB - remainingAfterC,
      stakeAmountC,
      "用户 C 质押后，全网剩余额度应继续减少"
    );

    const totalUsed = await staking.getDailyStakeUsed();
    console.log(`     全网已使用额度: ${formatEther(totalUsed)} USDX`);
    console.log(`     全网剩余额度: ${formatEther(remainingAfterC)} USDX`);
  });

  // =========================================================================
  // DL-4: 超出限额被拒绝
  // 累计质押接近 50,000 后，超出部分 revert
  // =========================================================================
  await runner.run("DL-4", "超出限额被拒绝: 累计超过 50,000 USDX 时 revert", async () => {
    // 当前已使用额度
    const usedSoFar = await staking.getDailyStakeUsed();
    const remaining = await staking.getDailyStakeRemaining();
    console.log(`     当前已使用: ${formatEther(usedSoFar)} USDX`);
    console.log(`     当前剩余: ${formatEther(remaining)} USDX`);

    // 多次质押消耗额度直到接近上限
    // 每个用户上限 10,000 USDX, 所以需要多个用户配合
    // 使用更多用户来消耗额度
    const bulkUsers = [];
    for (let i = 35; i < 85; i++) {
      bulkUsers.push(accounts[i]);
    }

    // 为批量用户设置余额、授权、绑定推荐人
    for (const u of bulkUsers) {
      await setUSDXBalance(u.address, parseEther("100000"));
      await approveUSDX(usdx, u, stakingAddress, parseEther("100000"));
      await safeBindReferral(staking, u, rootAddress);
    }

    // 每次质押 1000 USDX (单笔最大限制)，尽可能消耗额度
    let currentRemaining = remaining;
    let userIdx = 0;

    while (currentRemaining > parseEther("1000") && userIdx < bulkUsers.length) {
      await advanceTimeSeconds(120);
      try {
        await staking.connect(bulkUsers[userIdx]).stake(parseEther("1000"), 1);
        currentRemaining = await staking.getDailyStakeRemaining();
        userIdx++;
      } catch {
        break;
      }
    }

    const remainingNow = await staking.getDailyStakeRemaining();
    console.log(`     消耗后剩余额度: ${formatEther(remainingNow)} USDX`);

    // 尝试一笔超过剩余额度的质押，应该失败
    if (remainingNow < parseEther("1000")) {
      const overAmount = remainingNow + parseEther("1");
      if (overAmount >= parseEther("100") && userIdx < bulkUsers.length) {
        try {
          await advanceTimeSeconds(120);
          await staking.connect(bulkUsers[userIdx]).stake(overAmount, 1);
          throw new Error("应该失败但成功了");
        } catch (error) {
          assert(
            errorContains(error, "daily network stake limit") ||
            errorContains(error, "Exceeds"),
            `应包含限额错误信息, 实际: ${error.message}`
          );
          console.log(`     超额质押已被正确拒绝`);
        }
      } else {
        // 剩余额度太少或不足以达到最小质押额, 用一个新用户直接质押大额
        const bigUser = bulkUsers[userIdx < bulkUsers.length ? userIdx : bulkUsers.length - 1];
        try {
          await advanceTimeSeconds(120);
          // 质押一笔比剩余额度大的金额
          const testAmount = parseEther("1000");
          await staking.connect(bigUser).stake(testAmount, 1);
          throw new Error("应该失败但成功了");
        } catch (error) {
          assert(
            errorContains(error, "daily network stake limit") ||
            errorContains(error, "Exceeds") ||
            errorContains(error, "应该失败但成功了"),
            `应包含限额错误信息, 实际: ${error.message}`
          );
          if (errorContains(error, "应该失败但成功了")) {
            throw error;
          }
          console.log(`     超额质押已被正确拒绝`);
        }
      }
    }
  });

  // =========================================================================
  // DL-5: 周期刷新后额度恢复
  // 用 evm_increaseTime 推进到下个周期，额度恢复为 50,000
  // =========================================================================
  await runner.run("DL-5", "周期刷新后额度恢复: 跨周期后额度恢复为 50,000", async () => {
    // 当前额度已被大量消耗
    const usedBefore = await staking.getDailyStakeUsed();
    assert(usedBefore > 0n, "当前周期应有已使用额度");
    console.log(`     当前周期已使用: ${formatEther(usedBefore)} USDX`);

    // 推进到下一个刷新时间点
    const nextReset = await staking.getNextDailyResetTime();
    const currentTimestamp = await getBlockTimestamp();
    const timeToAdvance = Number(nextReset) - currentTimestamp + 1;
    await advanceTimeSeconds(timeToAdvance);

    // 验证额度已恢复 (view 函数应返回满额)
    const remainingAfterReset = await staking.getDailyStakeRemaining();
    assertEq(
      remainingAfterReset,
      parseEther("50000"),
      "跨周期后剩余额度应恢复为 50,000"
    );

    const usedAfterReset = await staking.getDailyStakeUsed();
    assertEq(usedAfterReset, 0n, "跨周期后已使用额度应为 0");

    console.log(`     新周期剩余额度: ${formatEther(remainingAfterReset)} USDX`);
    console.log(`     新周期已使用: ${formatEther(usedAfterReset)} USDX`);

    // 验证新周期内可以再次质押
    await advanceTimeSeconds(120);
    const newUser = accounts[86];
    await setUSDXBalance(newUser.address, parseEther("100000"));
    await approveUSDX(usdx, newUser, stakingAddress, parseEther("100000"));
    await safeBindReferral(staking, newUser, rootAddress);

    const tx = await staking.connect(newUser).stake(parseEther("500"), 1);
    const receipt = await tx.wait();
    assert(receipt.status === 1, "新周期质押应成功");

    const remainingAfterStake = await staking.getDailyStakeRemaining();
    assertEq(
      remainingAfterStake,
      parseEther("49500"),
      "新周期质押后剩余额度应为 49,500"
    );
    console.log(`     新周期质押后剩余: ${formatEther(remainingAfterStake)} USDX`);
  });

  // =========================================================================
  // DL-6: 剩余额度查询准确
  // getDailyStakeRemaining() 在各种状态下返回正确值
  // =========================================================================
  await runner.run("DL-6", "剩余额度查询准确: getDailyStakeRemaining() 各状态正确", async () => {
    // 推进到新周期确保干净状态
    const nextReset = await staking.getNextDailyResetTime();
    const currentTimestamp = await getBlockTimestamp();
    const timeToAdvance = Number(nextReset) - currentTimestamp + 1;
    await advanceTimeSeconds(timeToAdvance);

    // 状态1: 新周期开始，满额
    const remaining1 = await staking.getDailyStakeRemaining();
    assertEq(remaining1, parseEther("50000"), "新周期应为满额 50,000");
    console.log(`     新周期开始: 剩余 ${formatEther(remaining1)} USDX`);

    // 状态2: 质押 100 后
    await advanceTimeSeconds(120);
    const stakeUser = accounts[87];
    await setUSDXBalance(stakeUser.address, parseEther("100000"));
    await approveUSDX(usdx, stakeUser, stakingAddress, parseEther("100000"));
    await safeBindReferral(staking, stakeUser, rootAddress);

    await staking.connect(stakeUser).stake(parseEther("100"), 1);
    const remaining2 = await staking.getDailyStakeRemaining();
    assertEq(remaining2, parseEther("49900"), "质押 100 后应剩 49,900");
    console.log(`     质押 100 后: 剩余 ${formatEther(remaining2)} USDX`);

    // 状态3: 再质押 400 后
    await advanceTimeSeconds(120);
    await staking.connect(stakeUser).stake(parseEther("400"), 2);
    const remaining3 = await staking.getDailyStakeRemaining();
    assertEq(remaining3, parseEther("49500"), "再质押 400 后应剩 49,500");
    console.log(`     再质押 400 后: 剩余 ${formatEther(remaining3)} USDX`);
  });

  // =========================================================================
  // DL-7: 已使用额度查询
  // getDailyStakeUsed() 返回当前周期已消耗量
  // =========================================================================
  await runner.run("DL-7", "已使用额度查询: getDailyStakeUsed() 返回正确值", async () => {
    const used = await staking.getDailyStakeUsed();
    assert(used > 0n, "当前周期应有已使用额度");
    console.log(`     当前周期已使用额度: ${formatEther(used)} USDX`);

    // 推进到新周期
    const nextReset = await staking.getNextDailyResetTime();
    const currentTimestamp = await getBlockTimestamp();
    const timeToAdvance = Number(nextReset) - currentTimestamp + 1;
    await advanceTimeSeconds(timeToAdvance);

    // 新周期: 未质押前 used 应为 0
    const usedNewPeriod = await staking.getDailyStakeUsed();
    assertEq(usedNewPeriod, 0n, "新周期已使用额度应为 0");
    console.log(`     新周期已使用额度: ${formatEther(usedNewPeriod)} USDX`);
  });

  // =========================================================================
  // DL-8: 下次刷新时间查询
  // getNextDailyResetTime() 返回正确的下次刷新时间戳
  // =========================================================================
  await runner.run("DL-8", "下次刷新时间查询: getNextDailyResetTime() 返回正确时间", async () => {
    const nextReset = await staking.getNextDailyResetTime();
    const currentTimestamp = await getBlockTimestamp();

    // 下次刷新时间应在当前时间之后
    assert(nextReset > currentTimestamp, "下次刷新时间应在当前时间之后");

    // 下次刷新时间与当前时间的差应该 <= 24 小时
    const diff = Number(nextReset) - currentTimestamp;
    assert(diff <= 86400, "下次刷新时间与当前时间的差应 <= 24 小时");
    assert(diff > 0, "下次刷新时间与当前时间的差应 > 0");

    // 验证刷新时间是 UTC 06:00 (北京时间 14:00)
    const resetHourUTC = Number((nextReset % 86400n) / 3600n);
    assertEq(resetHourUTC, 6, "刷新时间应为 UTC 06:00");

    console.log(`     当前时间: ${currentTimestamp}`);
    console.log(`     下次刷新: ${nextReset}`);
    console.log(`     距离刷新: ${diff} 秒 (${(diff / 3600).toFixed(2)} 小时)`);
    console.log(`     刷新时间 UTC 小时: ${resetHourUTC}:00`);
  });

  // =========================================================================
  // DL-9: 与现有限制共存
  // 每日限额与单笔限制、用户累计限制互不干扰
  // =========================================================================
  await runner.run("DL-9", "与现有限制共存: 每日限额与其他限制互不干扰", async () => {
    // 推进到新周期确保干净状态
    const nextReset = await staking.getNextDailyResetTime();
    const currentTimestamp = await getBlockTimestamp();
    const timeToAdvance = Number(nextReset) - currentTimestamp + 1;
    await advanceTimeSeconds(timeToAdvance);

    const testUser = accounts[88];
    await setUSDXBalance(testUser.address, parseEther("100000"));
    await approveUSDX(usdx, testUser, stakingAddress, parseEther("100000"));
    await safeBindReferral(staking, testUser, rootAddress);

    // 测试1: 最小质押额仍生效 (< 100 USDX 应失败)
    try {
      await staking.connect(testUser).stake(parseEther("50"), 1);
      throw new Error("低于最小质押额应失败");
    } catch (error) {
      assert(
        errorContains(error, "BelowMinStakeAmount") ||
        errorContains(error, "min"),
        "应触发最小质押额错误"
      );
      console.log(`     最小质押额限制仍生效 (50 USDX 被拒绝)`);
    }

    // 测试2: 正常质押可以通过所有检查
    await advanceTimeSeconds(120);
    const tx = await staking.connect(testUser).stake(parseEther("100"), 1);
    const receipt = await tx.wait();
    assert(receipt.status === 1, "正常质押应通过所有检查");
    console.log(`     正常质押 100 USDX 通过所有检查`);

    // 测试3: 每日限额剩余正确减少
    const remaining = await staking.getDailyStakeRemaining();
    assertEq(remaining, parseEther("49900"), "每日限额应正确减少");
    console.log(`     每日限额正确减少至 ${formatEther(remaining)} USDX`);

    // 测试4: 用户累计上限仍独立生效
    // MAX_USER_TOTAL_STAKE = 10,000 USDX
    const userRemaining = await staking.getRemainingStakeCapacity(testUser.address);
    assert(userRemaining > 0n, "用户剩余容量应大于 0");
    console.log(`     用户剩余质押容量: ${formatEther(userRemaining)} USDX (与每日限额独立)`);
  });

  const allPassed = runner.summary();

  // 恢复快照
  await revertSnapshot(snapshotId);

  if (!allPassed) process.exit(1);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
