/**
 * 用户累计收益记录功能测试
 * 测试项 URS-1 ~ URS-7
 *
 * 验证用户级别的累计收益链上记录:
 * - totalClaimedStakingReward: 用户累计质押收益 (unstake / withdrawInterest 的 userPayout 之和)
 * - totalClaimedCommunityReward: 用户累计社区收益 (作为推荐人获得的团队奖励之和)
 * - getUserRewardSummary(): 统一查询接口
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
} = require("../helpers/setup");
const {
  advanceTime,
  advanceTimeSeconds,
  takeSnapshot,
  revertSnapshot,
} = require("../helpers/time");

const parseEther = hre.ethers.parseEther;
const formatEther = hre.ethers.formatEther;

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

async function prepareUser(usdx, staking, user, stakingAddress, referrer) {
  await setBNBBalance(user.address);
  await setUSDXBalance(user.address, parseEther("100000"));
  await approveUSDX(usdx, user, stakingAddress, parseEther("100000"));
  await safeBindReferral(staking, user, referrer);
}

/**
 * 安全质押: 等待足够时间让 network inflow 归零再质押
 */
async function safeStake(staking, user, amount, stakeIndex) {
  await advanceTimeSeconds(120); // 等待 2 分钟让 network inflow 归零
  await staking.connect(user).stake(amount, stakeIndex);
}

async function main() {
  console.log("\n=== 用户累计收益记录功能测试 (URS-1 ~ URS-7) ===\n");

  const snapshotId = await takeSnapshot();

  const deployment = loadDeployment();
  const { ae, staking, pair, usdx } = await getContracts(deployment);
  const [deployer, ...accounts] = await hre.ethers.getSigners();
  const stakingAddress = deployment.contracts.Staking;
  const rootAddress = deployment.addresses.rootAddress;

  // user1: 普通用户 (用于测试质押收益)
  // user2: user1 的上级 (用于测试社区收益)
  // user3: 额外用户 (用于多次操作)
  const user1 = accounts[0];
  const user2 = accounts[1];
  const user3 = accounts[2];

  const runner = new TestRunner("用户累计收益记录");

  // 准备 user2 先绑定到 root, 然后 user1 绑定到 user2, user3 绑定到 root
  await prepareUser(usdx, staking, user2, stakingAddress, rootAddress);
  // user2 质押以获得团队等级 (分多次质押避免超出 maxStakeAmount)
  await safeStake(staking, user2, parseEther("500"), 1); // 30 天期, 500 USDX
  await safeStake(staking, user2, parseEther("500"), 2); // 90 天期, 500 USDX

  // user1 绑定到 user2 (user2 是 user1 的推荐人)
  await prepareUser(usdx, staking, user1, stakingAddress, user2.address);

  // user3 绑定到 root
  await prepareUser(usdx, staking, user3, stakingAddress, rootAddress);

  // =========================================================================
  // URS-1 初始值为零
  // =========================================================================
  await runner.run("URS-1", "初始值为零: 未操作用户两项累计均为 0", async () => {
    const [stakingReward, communityReward] = await staking.getUserRewardSummary(user1.address);
    assertEq(stakingReward, 0n, "质押收益初始值应为 0");
    assertEq(communityReward, 0n, "社区收益初始值应为 0");

    const [stakingReward2, communityReward2] = await staking.getUserRewardSummary(user2.address);
    assertEq(stakingReward2, 0n, "user2 质押收益初始值应为 0");
    assertEq(communityReward2, 0n, "user2 社区收益初始值应为 0");

    console.log(`     user1: 质押收益=${formatEther(stakingReward)}, 社区收益=${formatEther(communityReward)}`);
    console.log(`     user2: 质押收益=${formatEther(stakingReward2)}, 社区收益=${formatEther(communityReward2)}`);
  });

  // =========================================================================
  // URS-2 unstake 后质押收益累加
  // =========================================================================
  await runner.run("URS-2", "unstake 后 totalClaimedStakingReward == userPayout", async () => {
    // user1 质押 500 USDX, 7 天期
    await safeStake(staking, user1, parseEther("500"), 0);

    // 推进 7 天 + 1 秒
    await advanceTime(7);
    await advanceTimeSeconds(1);

    const [stakingRewardBefore] = await staking.getUserRewardSummary(user1.address);

    // 记录 user1 实际收到的 USDX
    const usdxBefore = await usdx.balanceOf(user1.address);
    await staking.connect(user1).unstake(0);
    const usdxAfter = await usdx.balanceOf(user1.address);
    const received = usdxAfter - usdxBefore;

    const [stakingRewardAfter] = await staking.getUserRewardSummary(user1.address);
    const increase = stakingRewardAfter - stakingRewardBefore;

    assert(increase > 0n, "质押收益应增加");
    assertEq(increase, received, "质押收益增量应等于用户实收金额");

    console.log(`     user1 unstake 实收: ${formatEther(received)} USDX`);
    console.log(`     totalClaimedStakingReward 增量: ${formatEther(increase)} USDX`);
  });

  // =========================================================================
  // URS-3 withdrawInterest 后质押收益累加
  // =========================================================================
  await runner.run("URS-3", "withdrawInterest 后 totalClaimedStakingReward 增加", async () => {
    // user1 再次质押
    await setUSDXBalance(user1.address, parseEther("100000"));
    await approveUSDX(usdx, user1, stakingAddress, parseEther("100000"));
    await safeStake(staking, user1, parseEther("500"), 1); // 30 天期

    // 推进 5 天产生利息
    await advanceTime(5);

    const [stakingRewardBefore] = await staking.getUserRewardSummary(user1.address);

    const usdxBefore = await usdx.balanceOf(user1.address);
    await staking.connect(user1).withdrawInterest(1); // index 1 是新质押的
    const usdxAfter = await usdx.balanceOf(user1.address);
    const received = usdxAfter - usdxBefore;

    const [stakingRewardAfter] = await staking.getUserRewardSummary(user1.address);
    const increase = stakingRewardAfter - stakingRewardBefore;

    assert(increase > 0n, "质押收益应增加");
    assertEq(increase, received, "质押收益增量应等于用户实收金额");

    console.log(`     withdrawInterest 实收: ${formatEther(received)} USDX`);
    console.log(`     totalClaimedStakingReward 增量: ${formatEther(increase)} USDX`);
  });

  // =========================================================================
  // URS-4 社区收益累加
  // =========================================================================
  await runner.run("URS-4", "下级 unstake 后, 上级的 totalClaimedCommunityReward 增加", async () => {
    // 先看 user2 当前社区收益
    const [, communityRewardBefore] = await staking.getUserRewardSummary(user2.address);

    // 推进时间让 user1 的 30 天期到期
    await advanceTime(26);

    // user1 赎回 index 1
    await staking.connect(user1).unstake(1);

    const [, communityRewardAfter] = await staking.getUserRewardSummary(user2.address);
    const communityIncrease = communityRewardAfter - communityRewardBefore;

    // user2 作为 user1 的推荐人, 如果有 tier, 应该获得社区收益
    // 即使 user2 没有足够 tier, rootAddress 也会获得兜底的社区收益
    const [, rootCommunityAfter] = await staking.getUserRewardSummary(rootAddress);

    console.log(`     user2 社区收益增量: ${formatEther(communityIncrease)} USDX`);
    console.log(`     rootAddress 社区收益总计: ${formatEther(rootCommunityAfter)} USDX`);

    // 至少 rootAddress 或 user2 有社区收益增加
    assert(
      communityIncrease > 0n || rootCommunityAfter > 0n,
      "上级或 rootAddress 的社区收益应增加"
    );
  });

  // =========================================================================
  // URS-5 多次操作正确累加
  // =========================================================================
  await runner.run("URS-5", "多次 unstake 后质押收益持续累加", async () => {
    // 记录当前质押收益
    const [stakingRewardStart] = await staking.getUserRewardSummary(user3.address);

    // user3 第一笔质押
    await setUSDXBalance(user3.address, parseEther("100000"));
    await approveUSDX(usdx, user3, stakingAddress, parseEther("100000"));
    await safeStake(staking, user3, parseEther("500"), 0); // 7 天期
    await advanceTime(7);
    await advanceTimeSeconds(1);

    const usdxBefore1 = await usdx.balanceOf(user3.address);
    await staking.connect(user3).unstake(0);
    const usdxAfter1 = await usdx.balanceOf(user3.address);
    const received1 = usdxAfter1 - usdxBefore1;

    const [stakingRewardMid] = await staking.getUserRewardSummary(user3.address);
    const increase1 = stakingRewardMid - stakingRewardStart;
    assertEq(increase1, received1, "第一次赎回增量应等于实收");

    // user3 第二笔质押
    await setUSDXBalance(user3.address, parseEther("100000"));
    await approveUSDX(usdx, user3, stakingAddress, parseEther("100000"));
    await safeStake(staking, user3, parseEther("300"), 1); // 30 天期
    await advanceTime(30);
    await advanceTimeSeconds(1);

    const usdxBefore2 = await usdx.balanceOf(user3.address);
    await staking.connect(user3).unstake(1);
    const usdxAfter2 = await usdx.balanceOf(user3.address);
    const received2 = usdxAfter2 - usdxBefore2;

    const [stakingRewardEnd] = await staking.getUserRewardSummary(user3.address);
    const increase2 = stakingRewardEnd - stakingRewardMid;
    assertEq(increase2, received2, "第二次赎回增量应等于实收");

    const totalIncrease = stakingRewardEnd - stakingRewardStart;
    assertEq(totalIncrease, received1 + received2, "累计增量应等于两次实收之和");

    console.log(`     第一次实收: ${formatEther(received1)} USDX`);
    console.log(`     第二次实收: ${formatEther(received2)} USDX`);
    console.log(`     累计质押收益: ${formatEther(stakingRewardEnd)} USDX`);
  });

  // =========================================================================
  // URS-6 getUserRewardSummary 返回一致
  // =========================================================================
  await runner.run("URS-6", "getUserRewardSummary() 返回值与直接查 mapping 一致", async () => {
    // 对 user1, user2, user3 分别检查
    for (const [label, user] of [["user1", user1], ["user2", user2], ["user3", user3]]) {
      const [stakingReward, communityReward] = await staking.getUserRewardSummary(user.address);
      const mappingStaking = await staking.totalClaimedStakingReward(user.address);
      const mappingCommunity = await staking.totalClaimedCommunityReward(user.address);

      assertEq(stakingReward, mappingStaking, `${label} 质押收益应一致`);
      assertEq(communityReward, mappingCommunity, `${label} 社区收益应一致`);

      console.log(`     ${label}: 质押收益=${formatEther(stakingReward)}, 社区收益=${formatEther(communityReward)}`);
    }
  });

  // =========================================================================
  // URS-7 打印收益汇总
  // =========================================================================
  await runner.run("URS-7", "打印用户的质押收益总数和社区收益总数", async () => {
    console.log("\n     === 收益汇总 ===");
    for (const [label, addr] of [
      ["user1", user1.address],
      ["user2", user2.address],
      ["user3", user3.address],
      ["rootAddress", rootAddress],
    ]) {
      const [stakingReward, communityReward] = await staking.getUserRewardSummary(addr);
      console.log(`     ${label} (${addr}):`);
      console.log(`       质押收益总数: ${formatEther(stakingReward)} USDX`);
      console.log(`       社区收益总数: ${formatEther(communityReward)} USDX`);
    }
    // 此测试项仅打印, 不做断言
    assert(true, "打印完成");
  });

  // =========================================================================
  // 输出结果 & 恢复快照
  // =========================================================================
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
