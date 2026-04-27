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

/**
 * 为地址设置 BNB 余额 (用于支付 gas)
 */
async function setBNBBalance(address) {
  await hre.network.provider.send("hardhat_setBalance", [
    address,
    "0x56BC75E2D63100000", // 100 BNB
  ]);
}

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

/**
 * 辅助函数: 让一个用户多次质押, 消耗每日额度
 * 每次质押之间等待 120 秒以满足网络流入检查
 * 动态获取 maxStakeAmount 以适配池子大小
 * @returns 实际消耗的总额度
 */
async function drainQuotaWithUser(staking, user, maxStakes, stakeIndex) {
  const parseEther = hre.ethers.parseEther;
  const MIN_STAKE = parseEther("100");
  let staked = 0n;
  for (let i = 0; i < maxStakes; i++) {
    await advanceTimeSeconds(120);
    try {
      // 动态获取当前允许的最大单笔质押额
      const maxAmount = await staking.getMaxStakeAmount();
      if (maxAmount < MIN_STAKE) break; // 不够最小质押额
      // 同时不能超过每日剩余额度
      const remaining = await staking.getDailyStakeRemaining();
      if (remaining < MIN_STAKE) break;
      // 取 maxAmount 和 remaining 的较小值
      let amount = maxAmount < remaining ? maxAmount : remaining;
      // 也不能超过用户剩余容量
      const userCap = await staking.getRemainingStakeCapacity(user.address);
      if (userCap < MIN_STAKE) break;
      if (amount > userCap) amount = userCap;
      if (amount < MIN_STAKE) break;

      await staking.connect(user).stake(amount, stakeIndex);
      staked += amount;
    } catch {
      break; // 达到用户上限或每日限额
    }
  }
  return staked;
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

  // Hardhat 默认 20 个账户, deployer=accounts[-1], accounts[0..18]
  // 分配: DL-1~3 用 accounts[0..2], DL-4 用 accounts[3..8], DL-5~9 用 accounts[9..13]
  const userA = accounts[0];
  const userB = accounts[1];
  const userC = accounts[2];

  const runner = new TestRunner("每日全网质押限额功能");

  // 准备: 为 DL-1~3 的用户设置余额和授权
  for (const u of [userA, userB, userC]) {
    await setBNBBalance(u.address);
    await setUSDXBalance(u.address, parseEther("100000"));
    await approveUSDX(usdx, u, stakingAddress, parseEther("100000"));
    await safeBindReferral(staking, u, rootAddress);
  }

  // =========================================================================
  // DL-1: 限额常量验证
  // DAILY_NETWORK_STAKE_LIMIT = 50,000 USDX
  // =========================================================================
  await runner.run("DL-1", "限额常量验证: DAILY_NETWORK_STAKE_LIMIT = 50,000 USDX", async () => {
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
  // 策略: 用 accounts[3..8] 共 6 个用户, 每用户最多质押 10,000 USDX
  // 6 * 10,000 = 60,000 > 50,000, 足够触发限额
  // =========================================================================
  await runner.run("DL-4", "超出限额被拒绝: 累计超过 50,000 USDX 时 revert", async () => {
    const usedSoFar = await staking.getDailyStakeUsed();
    console.log(`     当前已使用: ${formatEther(usedSoFar)} USDX`);

    // 准备 6 个用户用于消耗额度
    const drainUsers = [accounts[3], accounts[4], accounts[5], accounts[6], accounts[7], accounts[8]];
    for (const u of drainUsers) {
      await setBNBBalance(u.address);
      await setUSDXBalance(u.address, parseEther("100000"));
      await approveUSDX(usdx, u, stakingAddress, parseEther("100000"));
      await safeBindReferral(staking, u, rootAddress);
    }

    // 每个用户循环质押 1000 USDX (最多 10 次 = 10,000 USDX/人), 直到额度耗尽
    let totalDrained = 0n;
    for (const u of drainUsers) {
      const remaining = await staking.getDailyStakeRemaining();
      if (remaining <= parseEther("100")) break; // 剩余不够最小质押额
      const drained = await drainQuotaWithUser(staking, u, 10, 2);
      totalDrained += drained;
      console.log(`     用户 ${u.address.slice(0, 8)}... 质押: ${formatEther(drained)} USDX`);
    }

    const remainingNow = await staking.getDailyStakeRemaining();
    console.log(`     消耗后剩余额度: ${formatEther(remainingNow)} USDX`);
    console.log(`     本轮共消耗: ${formatEther(totalDrained)} USDX`);

    // 尝试超出限额的质押, 应失败
    // 找一个还没达到用户上限的账户
    const overUser = accounts[9];
    await setBNBBalance(overUser.address);
    await setUSDXBalance(overUser.address, parseEther("100000"));
    await approveUSDX(usdx, overUser, stakingAddress, parseEther("100000"));
    await safeBindReferral(staking, overUser, rootAddress);

    // 如果剩余额度 < 1000, 尝试质押 1000 应触发每日限额错误
    if (remainingNow < parseEther("1000")) {
      try {
        await advanceTimeSeconds(120);
        await staking.connect(overUser).stake(parseEther("1000"), 2);
        throw new Error("应该失败但成功了");
      } catch (error) {
        if (errorContains(error, "应该失败但成功了")) throw error;
        assert(
          errorContains(error, "daily network stake limit"),
          `应包含 'daily network stake limit' 错误, 实际: ${error.message.slice(0, 200)}`
        );
        console.log(`     超额质押已被正确拒绝 ✓`);
      }
    } else {
      // 剩余额度仍 >= 1000, 直接尝试一笔超过剩余额度的交易
      // remainingNow + 1 可能不到 MIN_STAKE_AMOUNT, 所以用更大数值
      const overAmount = remainingNow + parseEther("100");
      try {
        await advanceTimeSeconds(120);
        await staking.connect(overUser).stake(overAmount, 2);
        throw new Error("应该失败但成功了");
      } catch (error) {
        if (errorContains(error, "应该失败但成功了")) throw error;
        // 可能被 daily limit 或 maxStakeAmount 拦截, 两者都说明限制生效
        assert(
          errorContains(error, "daily network stake limit") ||
          errorContains(error, "ExceedsMaxStakeAmount"),
          `应包含限额相关错误, 实际: ${error.message.slice(0, 200)}`
        );
        console.log(`     超额质押已被正确拒绝 ✓`);
      }
    }
  });

  // =========================================================================
  // DL-5: 周期刷新后额度恢复
  // 用 evm_increaseTime 推进到下个周期，额度恢复为 50,000
  // =========================================================================
  await runner.run("DL-5", "周期刷新后额度恢复: 跨周期后额度恢复为 50,000", async () => {
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
    const newUser = accounts[10];
    await setBNBBalance(newUser.address);
    await setUSDXBalance(newUser.address, parseEther("100000"));
    await approveUSDX(usdx, newUser, stakingAddress, parseEther("100000"));
    await safeBindReferral(staking, newUser, rootAddress);

    const tx = await staking.connect(newUser).stake(parseEther("500"), 2);
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
    const stakeUser = accounts[11];
    await setBNBBalance(stakeUser.address);
    await setUSDXBalance(stakeUser.address, parseEther("100000"));
    await approveUSDX(usdx, stakeUser, stakingAddress, parseEther("100000"));
    await safeBindReferral(staking, stakeUser, rootAddress);

    await staking.connect(stakeUser).stake(parseEther("100"), 2);
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

    const testUser = accounts[12];
    await setBNBBalance(testUser.address);
    await setUSDXBalance(testUser.address, parseEther("100000"));
    await approveUSDX(usdx, testUser, stakingAddress, parseEther("100000"));
    await safeBindReferral(staking, testUser, rootAddress);

    // 测试1: 最小质押额仍生效 (< 100 USDX 应失败)
    try {
      await staking.connect(testUser).stake(parseEther("50"), 2);
      throw new Error("低于最小质押额应失败");
    } catch (error) {
      if (errorContains(error, "低于最小质押额应失败")) throw error;
      assert(
        errorContains(error, "BelowMinStakeAmount") ||
        errorContains(error, "min"),
        "应触发最小质押额错误"
      );
      console.log(`     最小质押额限制仍生效 (50 USDX 被拒绝)`);
    }

    // 测试2: 正常质押可以通过所有检查
    await advanceTimeSeconds(120);
    const tx = await staking.connect(testUser).stake(parseEther("100"), 2);
    const receipt = await tx.wait();
    assert(receipt.status === 1, "正常质押应通过所有检查");
    console.log(`     正常质押 100 USDX 通过所有检查`);

    // 测试3: 每日限额剩余正确减少
    const remaining = await staking.getDailyStakeRemaining();
    assertEq(remaining, parseEther("49900"), "每日限额应正确减少");
    console.log(`     每日限额正确减少至 ${formatEther(remaining)} USDX`);

    // 测试4: 用户累计上限仍独立生效
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
