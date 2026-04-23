/**
 * 模块 7：布道者身份 (Preacher) 测试
 * 测试项 7.1 ~ 7.5
 *
 * 布道者条件：currentStakeValue(user) >= 200 USDT (PREACHER_THRESHOLD)
 *
 * 使用 stakeValue=0 且已绑定推荐人的账户：accounts[3], [4], [6], [7], [9]
 * 每个测试用独立 snapshot/revert 保证状态隔离
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
const { advanceTimeSeconds, takeSnapshot, revertSnapshot } = require("../helpers/time");

async function safeBindReferral(staking, user, referrer) {
  const isBound = await staking.isBindReferral(user.address);
  if (!isBound) {
    await staking.connect(user).lockReferral(referrer);
  }
}

async function prepareUser(usdx, staking, user, stakingAddress, rootAddress) {
  const parseEther = hre.ethers.parseEther;
  await setUSDXBalance(user.address, parseEther("50000"));
  await approveUSDX(usdx, user, stakingAddress, parseEther("50000"));
  await safeBindReferral(staking, user, rootAddress);
}

async function main() {
  console.log("\n=== 模块 7：布道者身份 (Preacher) 测试 ===\n");

  const deployment = loadDeployment();
  const { ae, staking, pair, usdx } = await getContracts(deployment);
  const [deployer, ...accounts] = await hre.ethers.getSigners();
  const stakingAddress = deployment.contracts.Staking;
  const rootAddress = deployment.addresses.rootAddress;
  const parseEther = hre.ethers.parseEther;
  const formatEther = hre.ethers.formatEther;

  const runner = new TestRunner("模块 7：布道者身份 (Preacher)");

  // =========================================================================
  // 7.1 自动获得布道者：质押总额 >= 200 USDT 时 isPreacher 返回 true
  // =========================================================================
  const snap1 = await takeSnapshot();
  await runner.run("7.1", "自动获得布道者：质押 >= 200 USDT", async () => {
    const user = accounts[3]; // stakeValue=0, bound=true
    await prepareUser(usdx, staking, user, stakingAddress, rootAddress);

    const preVal = await staking.currentStakeValue(user.address);
    console.log(`     质押前 currentStakeValue: ${formatEther(preVal)} USDT`);
    assert(preVal < parseEther("200"), "质押前 stakeValue 应 < 200");
    assertEq(await staking.isPreacher(user.address), false, "质押前不应是布道者");

    await staking.connect(user).stake(parseEther("300"), 1);

    const isP = await staking.isPreacher(user.address);
    const stakeVal = await staking.currentStakeValue(user.address);
    console.log(`     质押后 currentStakeValue: ${formatEther(stakeVal)} USDT`);
    assertEq(isP, true, "质押 300 USDT 后应是布道者");
  });
  await revertSnapshot(snap1);

  // =========================================================================
  // 7.2 未达门槛：质押 100 USDT，isPreacher 返回 false
  // =========================================================================
  const snap2 = await takeSnapshot();
  await runner.run("7.2", "未达门槛：质押 100 USDT 不是布道者", async () => {
    const user = accounts[4]; // stakeValue=0, bound=true
    await prepareUser(usdx, staking, user, stakingAddress, rootAddress);

    assertEq(await staking.isPreacher(user.address), false, "质押前不应是布道者");

    await staking.connect(user).stake(parseEther("100"), 1);

    const isP = await staking.isPreacher(user.address);
    const stakeVal = await staking.currentStakeValue(user.address);
    console.log(`     质押后 currentStakeValue: ${formatEther(stakeVal)} USDT`);
    assertEq(isP, false, "质押 100 USDT 不应是布道者");
  });
  await revertSnapshot(snap2);

  // =========================================================================
  // 7.3 恰好达到门槛：质押恰好 200 USDT，isPreacher 返回 true
  // =========================================================================
  const snap3 = await takeSnapshot();
  await runner.run("7.3", "恰好达到门槛：质押 200 USDT 是布道者", async () => {
    const user = accounts[6]; // stakeValue=0, bound=true
    await prepareUser(usdx, staking, user, stakingAddress, rootAddress);

    assertEq(await staking.isPreacher(user.address), false, "质押前不应是布道者");

    await staking.connect(user).stake(parseEther("200"), 1);

    const isP = await staking.isPreacher(user.address);
    const stakeVal = await staking.currentStakeValue(user.address);
    console.log(`     质押后 currentStakeValue: ${formatEther(stakeVal)} USDT`);
    assertEq(isP, true, "质押恰好 200 USDT 应是布道者");
  });
  await revertSnapshot(snap3);

  // =========================================================================
  // 7.4 赎回后失去身份：赎回后质押总额 < 200 USDT，isPreacher 返回 false
  // =========================================================================
  const snap4 = await takeSnapshot();
  await runner.run("7.4", "赎回后失去布道者身份", async () => {
    const user = accounts[7]; // stakeValue=0, bound=true
    await prepareUser(usdx, staking, user, stakingAddress, rootAddress);

    const countBefore = Number(await staking.stakeCount(user.address));

    // 质押 200 USDT（30天期）
    await staking.connect(user).stake(parseEther("200"), 1);
    assertEq(await staking.isPreacher(user.address), true, "质押 200 后应是布道者");

    // 推进时间到 30 天后
    await advanceTimeSeconds(30 * 24 * 60 * 60 + 1);

    // 赎回（索引 = countBefore，即刚质押的那笔）
    await staking.connect(user).unstake(countBefore);

    const isP = await staking.isPreacher(user.address);
    const stakeVal = await staking.currentStakeValue(user.address);
    console.log(`     赎回后 currentStakeValue: ${formatEther(stakeVal)} USDT`);
    assertEq(isP, false, "赎回后不应是布道者");
  });
  await revertSnapshot(snap4);

  // =========================================================================
  // 7.5 多笔质押累计：两笔 100 USDT 质押，合计 200 USDT，应为布道者
  // =========================================================================
  const snap5 = await takeSnapshot();
  await runner.run("7.5", "多笔质押累计达到布道者门槛", async () => {
    const user = accounts[9]; // stakeValue=0, bound=true
    await prepareUser(usdx, staking, user, stakingAddress, rootAddress);

    assertEq(await staking.isPreacher(user.address), false, "质押前不应是布道者");

    // 第一笔 100 USDT
    await staking.connect(user).stake(parseEther("100"), 1);
    assertEq(await staking.isPreacher(user.address), false, "100 USDT 不应是布道者");

    await advanceTimeSeconds(120);

    // 第二笔 100 USDT
    await staking.connect(user).stake(parseEther("100"), 2);

    const isP = await staking.isPreacher(user.address);
    const stakeVal = await staking.currentStakeValue(user.address);
    console.log(`     两笔质押后 currentStakeValue: ${formatEther(stakeVal)} USDT`);
    assertEq(isP, true, "两笔 100 USDT 合计 200 应是布道者");
  });
  await revertSnapshot(snap5);

  const allPassed = runner.summary();
  if (!allPassed) process.exit(1);
}

main()
  .then(() => process.exit(0))
  .catch((error) => { console.error(error); process.exit(1); });
