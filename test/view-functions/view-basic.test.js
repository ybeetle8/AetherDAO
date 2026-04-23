/**
 * 模块 9：View 函数与查询 - 基础测试 (9.1 ~ 9.10)
 *
 * 测试所有 view/pure 查询函数的返回值正确性
 *
 * 运行: npx hardhat run test/view-functions/view-basic.test.js --network localhost
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
const { advanceTimeSeconds, takeSnapshot, revertSnapshot } = require("../helpers/time");

const parseEther = hre.ethers.parseEther;
const formatEther = hre.ethers.formatEther;

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

async function main() {
  console.log("\n=== 模块 9：View 函数与查询 - 基础测试 (9.1~9.10) ===\n");

  const deployment = loadDeployment();
  const { ae, staking, pair, usdx } = await getContracts(deployment);
  const [deployer, ...accounts] = await hre.ethers.getSigners();
  const stakingAddress = deployment.contracts.Staking;
  const rootAddress = deployment.addresses.rootAddress;

  const runner = new TestRunner("模块 9：View 函数与查询 (基础)");

  // =========================================================================
  // 9.1 getUserInfo: 验证返回 totalStaked, teamKPI, referrer, hasLocked, isPreacher
  // =========================================================================
  const snap1 = await takeSnapshot();
  await runner.run("9.1", "getUserInfo 返回值验证", async () => {
    const user = accounts[3];
    await prepareUser(usdx, staking, user, stakingAddress, rootAddress);

    // 质押前查询
    const infoBefore = await staking.getUserInfo(user.address);
    console.log(`     质押前 totalStaked: ${formatEther(infoBefore.totalStaked)}`);
    assertEq(infoBefore.hasLockedReferral, true, "已绑定推荐人");
    assertEq(infoBefore.referrer, rootAddress, "推荐人应为 root");

    // 质押 300 USDT (30天期)
    await staking.connect(user).stake(parseEther("300"), 1);

    const infoAfter = await staking.getUserInfo(user.address);
    console.log(`     质押后 totalStaked: ${formatEther(infoAfter.totalStaked)}`);
    assert(infoAfter.totalStaked > 0n, "totalStaked 应 > 0");
    assert(infoAfter.teamKPI >= 0n, "teamKPI 应 >= 0");
    assertEq(infoAfter.referrer, rootAddress, "推荐人应为 root");
    assertEq(infoAfter.hasLockedReferral, true, "hasLockedReferral 应为 true");
    assertEq(infoAfter.isPreacherStatus, true, "300 USDT 应为布道者");
  });
  await revertSnapshot(snap1);

  // =========================================================================
  // 9.2 balanceOf: 验证返回当前质押价值（本金+利息）
  // =========================================================================
  const snap2 = await takeSnapshot();
  await runner.run("9.2", "balanceOf 返回当前质押价值", async () => {
    const user = accounts[4];
    await prepareUser(usdx, staking, user, stakingAddress, rootAddress);

    const balBefore = await staking.balanceOf(user.address);
    assertEq(balBefore, 0n, "质押前 balanceOf 应为 0");

    await staking.connect(user).stake(parseEther("500"), 1);

    const balAfter = await staking.balanceOf(user.address);
    console.log(`     质押后 balanceOf: ${formatEther(balAfter)}`);
    assert(balAfter > 0n, "质押后 balanceOf 应 > 0");

    // 推进时间 1 天，利息应增长
    await advanceTimeSeconds(24 * 60 * 60);
    const balLater = await staking.balanceOf(user.address);
    console.log(`     1天后 balanceOf: ${formatEther(balLater)}`);
    assert(balLater > balAfter, "1天后 balanceOf 应增长（含利息）");
  });
  await revertSnapshot(snap2);

  // =========================================================================
  // 9.3 principalBalance: 验证返回原始质押本金
  // =========================================================================
  const snap3 = await takeSnapshot();
  await runner.run("9.3", "principalBalance 返回原始质押本金", async () => {
    const user = accounts[5];
    await prepareUser(usdx, staking, user, stakingAddress, rootAddress);

    const pbBefore = await staking.principalBalance(user.address);
    assertEq(pbBefore, 0n, "质押前 principalBalance 应为 0");

    const stakeAmount = parseEther("500");
    await staking.connect(user).stake(stakeAmount, 1);

    const pbAfter = await staking.principalBalance(user.address);
    console.log(`     principalBalance: ${formatEther(pbAfter)}`);
    assertEq(pbAfter, stakeAmount, "principalBalance 应等于质押金额");

    // 推进时间，principalBalance 不应变化
    await advanceTimeSeconds(24 * 60 * 60);
    const pbLater = await staking.principalBalance(user.address);
    assertEq(pbLater, stakeAmount, "时间推进后 principalBalance 不应变化");
  });
  await revertSnapshot(snap3);

  // =========================================================================
  // 9.4 currentStakeValue: 验证所有活跃质押的总价值
  // =========================================================================
  const snap4 = await takeSnapshot();
  await runner.run("9.4", "currentStakeValue 返回所有活跃质押总价值", async () => {
    const user = accounts[6];
    await prepareUser(usdx, staking, user, stakingAddress, rootAddress);

    const csvBefore = await staking.currentStakeValue(user.address);
    assertEq(csvBefore, 0n, "质押前 currentStakeValue 应为 0");

    await staking.connect(user).stake(parseEther("300"), 1);
    const csv1 = await staking.currentStakeValue(user.address);
    console.log(`     第一笔质押后 currentStakeValue: ${formatEther(csv1)}`);
    assert(csv1 > 0n, "第一笔质押后 currentStakeValue 应 > 0");

    await advanceTimeSeconds(120);

    // 第二笔质押
    await staking.connect(user).stake(parseEther("200"), 2);
    const csv2 = await staking.currentStakeValue(user.address);
    console.log(`     两笔质押后 currentStakeValue: ${formatEther(csv2)}`);
    assert(csv2 > csv1, "两笔质押后 currentStakeValue 应更大");
  });
  await revertSnapshot(snap4);

  // =========================================================================
  // 9.5 earnedInterest: 验证总利息 = balanceOf - principalBalance
  // =========================================================================
  const snap5 = await takeSnapshot();
  await runner.run("9.5", "earnedInterest = balanceOf - principalBalance", async () => {
    const user = accounts[7];
    await prepareUser(usdx, staking, user, stakingAddress, rootAddress);

    await staking.connect(user).stake(parseEther("500"), 2); // 90天期

    // 推进 10 天产生利息
    await advanceTimeSeconds(10 * 24 * 60 * 60);

    const bal = await staking.balanceOf(user.address);
    const principal = await staking.principalBalance(user.address);
    const interest = await staking.earnedInterest(user.address);

    console.log(`     balanceOf: ${formatEther(bal)}`);
    console.log(`     principalBalance: ${formatEther(principal)}`);
    console.log(`     earnedInterest: ${formatEther(interest)}`);

    const expectedInterest = bal - principal;
    assertEq(interest, expectedInterest, "earnedInterest 应 = balanceOf - principalBalance");
    assert(interest > 0n, "10天后应有利息产生");
  });
  await revertSnapshot(snap5);

  // =========================================================================
  // 9.6 rewardOfSlot: 验证指定质押槽位的收益
  // =========================================================================
  const snap6 = await takeSnapshot();
  await runner.run("9.6", "rewardOfSlot 返回指定槽位收益", async () => {
    const user = accounts[8];
    await prepareUser(usdx, staking, user, stakingAddress, rootAddress);

    const countBefore = Number(await staking.stakeCount(user.address));

    await staking.connect(user).stake(parseEther("300"), 1); // 30天期

    // 推进 5 天
    await advanceTimeSeconds(5 * 24 * 60 * 60);

    const reward = await staking.rewardOfSlot(user.address, countBefore);
    console.log(`     slot ${countBefore} reward: ${formatEther(reward)}`);
    assert(reward > 0n, "5天后该槽位应有收益");

    // 收益应大于本金（reward 包含本金+利息）
    assert(reward > parseEther("300"), "reward 应 > 本金 300");
  });
  await revertSnapshot(snap6);

  // =========================================================================
  // 9.7 canWithdrawStake: 到期前返回 false，到期后返回 true
  // =========================================================================
  const snap7 = await takeSnapshot();
  await runner.run("9.7", "canWithdrawStake 到期前 false / 到期后 true", async () => {
    const user = accounts[9];
    await prepareUser(usdx, staking, user, stakingAddress, rootAddress);

    const countBefore = Number(await staking.stakeCount(user.address));

    await staking.connect(user).stake(parseEther("300"), 1); // 30天期

    // 到期前
    const canBefore = await staking.canWithdrawStake(user.address, countBefore);
    assertEq(canBefore, false, "到期前 canWithdrawStake 应为 false");

    // 推进 30 天 + 1 秒
    await advanceTimeSeconds(30 * 24 * 60 * 60 + 1);

    const canAfter = await staking.canWithdrawStake(user.address, countBefore);
    assertEq(canAfter, true, "到期后 canWithdrawStake 应为 true");
    console.log(`     到期前: ${canBefore}, 到期后: ${canAfter}`);
  });
  await revertSnapshot(snap7);

  // =========================================================================
  // 9.8 stakeCount: 验证用户质押笔数
  // =========================================================================
  const snap8 = await takeSnapshot();
  await runner.run("9.8", "stakeCount 返回用户质押笔数", async () => {
    const user = accounts[3];
    await prepareUser(usdx, staking, user, stakingAddress, rootAddress);

    const countBefore = Number(await staking.stakeCount(user.address));
    console.log(`     质押前 stakeCount: ${countBefore}`);

    // 第一笔
    await staking.connect(user).stake(parseEther("200"), 1);
    const count1 = Number(await staking.stakeCount(user.address));
    assertEq(count1, countBefore + 1, "第一笔质押后 stakeCount 应 +1");

    await advanceTimeSeconds(120);

    // 第二笔
    await staking.connect(user).stake(parseEther("200"), 2);
    const count2 = Number(await staking.stakeCount(user.address));
    assertEq(count2, countBefore + 2, "第二笔质押后 stakeCount 应 +2");
    console.log(`     两笔质押后 stakeCount: ${count2}`);
  });
  await revertSnapshot(snap8);

  // =========================================================================
  // 9.9 getRemainingStakeCapacity: 验证 = 10000 - 已质押总额
  // =========================================================================
  const snap9 = await takeSnapshot();
  await runner.run("9.9", "getRemainingStakeCapacity = 10000 - 已质押", async () => {
    const user = accounts[4];
    await prepareUser(usdx, staking, user, stakingAddress, rootAddress);

    const capBefore = await staking.getRemainingStakeCapacity(user.address);
    console.log(`     质押前剩余容量: ${formatEther(capBefore)}`);
    assertEq(capBefore, parseEther("10000"), "质押前剩余容量应为 10000");

    await staking.connect(user).stake(parseEther("500"), 1);

    const capAfter = await staking.getRemainingStakeCapacity(user.address);
    console.log(`     质押 500 后剩余容量: ${formatEther(capAfter)}`);
    assertEq(capAfter, parseEther("9500"), "质押 500 后剩余容量应为 9500");
  });
  await revertSnapshot(snap9);

  // =========================================================================
  // 9.10 getMinStakeAmount: 返回 100 USDT
  // =========================================================================
  await runner.run("9.10", "getMinStakeAmount 返回 100 USDT", async () => {
    const minAmount = await staking.getMinStakeAmount();
    console.log(`     getMinStakeAmount: ${formatEther(minAmount)}`);
    assertEq(minAmount, parseEther("100"), "最低质押额应为 100 USDT");
  });

  const allPassed = runner.summary();
  if (!allPassed) process.exit(1);
}

main()
  .then(() => process.exit(0))
  .catch((error) => { console.error(error); process.exit(1); });
