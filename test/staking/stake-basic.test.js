/**
 * 模块 1：质押功能 (stake) 测试 - 第一部分
 * 测试项 1.1 ~ 1.9
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
} = require("../helpers/setup");

async function safeBindReferral(staking, user, referrer) {
  const isBound = await staking.isBindReferral(user.address);
  if (!isBound) {
    await staking.connect(user).lockReferral(referrer);
  }
}

function errorContains(error, keyword) {
  return (error.message || "").includes(keyword);
}

async function main() {
  console.log("\n=== 模块 1：质押功能 (stake) 测试 - 第一部分 (1.1~1.9) ===\n");

  const deployment = loadDeployment();
  const { ae, staking, pair, usdx } = await getContracts(deployment);
  const [deployer, ...accounts] = await hre.ethers.getSigners();
  const stakingAddress = deployment.contracts.Staking;
  const rootAddress = deployment.addresses.rootAddress;
  const parseEther = hre.ethers.parseEther;
  const formatEther = hre.ethers.formatEther;

  // 每个测试用独立用户，避免状态干扰
  // accounts[0]~[4] 可能被之前脚本用过，从 [14] 开始
  const userA = accounts[14]; // 1.1, 1.2, 1.3, 1.4
  const userB = accounts[15]; // 1.5
  const userC = accounts[16]; // 1.6, 1.7
  const userD = accounts[17]; // 1.8 (已绑定)
  const userE = accounts[18]; // 1.9 (不绑定)

  const runner = new TestRunner("模块 1：质押功能 (stake) - 第一部分");

  // 准备：设置余额和授权
  for (const u of [userA, userB, userC, userD, userE]) {
    await setUSDXBalance(u.address, parseEther("50000"));
    await approveUSDX(usdx, u, stakingAddress, parseEther("50000"));
  }

  // =========================================================================
  // 1.1 基本质押 100 USDT
  // =========================================================================
  await runner.run("1.1", "基本质押 100 USDT", async () => {
    await safeBindReferral(staking, userA, rootAddress);
    const countBefore = Number(await staking.stakeCount(userA.address));
    const usdxBefore = await usdx.balanceOf(userA.address);

    const tx = await staking.connect(userA).stake(parseEther("100"), 1);
    const receipt = await tx.wait();

    const usdxAfter = await usdx.balanceOf(userA.address);
    assert(usdxBefore - usdxAfter === parseEther("100"), "USDX 应减少 100");
    assertEq(Number(await staking.stakeCount(userA.address)), countBefore + 1, "记录数+1");

    const evt = receipt.logs.find((l) => {
      try { return staking.interface.parseLog(l)?.name === "Staked"; } catch { return false; }
    });
    assert(evt, "应触发 Staked 事件");
  });

  // =========================================================================
  // 1.2 最大单次质押（动态上限）
  // =========================================================================
  await runner.run("1.2", "最大单次质押（动态上限）", async () => {
    const maxStake = await staking.maxStakeAmount();
    console.log(`     动态最大质押额: ${formatEther(maxStake)} USDT`);
    const countBefore = Number(await staking.stakeCount(userA.address));
    await staking.connect(userA).stake(maxStake, 2);
    assertEq(Number(await staking.stakeCount(userA.address)), countBefore + 1, "记录数+1");
  });

  // =========================================================================
  // 1.3 低于最低额度应 revert
  // =========================================================================
  await runner.run("1.3", "低于最低额度应 revert", async () => {
    let reverted = false;
    try { await staking.connect(userA).stake(parseEther("99"), 1); }
    catch (e) { reverted = true; assert(errorContains(e, "BelowMinStakeAmount"), "应 BelowMinStakeAmount"); }
    assert(reverted, "应 revert");
  });

  // =========================================================================
  // 1.4 超过单次上限应 revert
  // =========================================================================
  await runner.run("1.4", "超过单次上限应 revert", async () => {
    const maxStake = await staking.maxStakeAmount();
    let reverted = false;
    try { await staking.connect(userA).stake(maxStake + parseEther("1"), 1); }
    catch (e) { reverted = true; assert(errorContains(e, "Exceeds") || errorContains(e, "reverted"), "应超限"); }
    assert(reverted, "应 revert");
  });

  // =========================================================================
  // 1.5 用户总质押上限 10000 USDT
  // =========================================================================
  await runner.run("1.5", "用户总质押上限 10000 USDT", async () => {
    await safeBindReferral(staking, userB, rootAddress);
    let totalStaked = await staking.principalBalance(userB.address);
    let idx = 1;
    while (true) {
      const maxStake = await staking.maxStakeAmount();
      const remaining = await staking.getRemainingStakeCapacity(userB.address);
      const stakeAmt = maxStake < remaining ? maxStake : remaining;
      if (stakeAmt < parseEther("100")) break;
      await staking.connect(userB).stake(stakeAmt, (idx % 4) + 1);
      totalStaked += stakeAmt;
      idx++;
    }
    const remaining = await staking.getRemainingStakeCapacity(userB.address);
    console.log(`     已质押: ${formatEther(totalStaked)}, 剩余: ${formatEther(remaining)}`);
    let reverted = false;
    try { await staking.connect(userB).stake(parseEther("100"), 1); }
    catch (e) { reverted = true; }
    assert(reverted, "超过总上限应 revert");
  });

  // =========================================================================
  // 1.6 5 种期限质押及利率验证
  // =========================================================================
  await runner.run("1.6", "5 种期限质押及利率验证", async () => {
    await safeBindReferral(staking, userC, rootAddress);
    const expectedRates = [
      1006000000000000000n, 1009000000000000000n, 1011000000000000000n,
      1015000000000000000n, 1020000000000000000n,
    ];
    for (let i = 0; i < 5; i++) {
      assertEq(await staking.rates(i), expectedRates[i], `期限${i}利率`);
    }
    const countBefore = Number(await staking.stakeCount(userC.address));
    for (let i = 0; i < 5; i++) {
      const maxS = await staking.maxStakeAmount();
      const amt = maxS < parseEther("100") ? maxS : parseEther("100");
      assert(amt >= parseEther("100"), `期限${i}: maxStakeAmount(${formatEther(maxS)})不足100`);
      await staking.connect(userC).stake(amt, i);
    }
    assertEq(Number(await staking.stakeCount(userC.address)), countBefore + 5, "应+5笔");
  });

  // =========================================================================
  // 1.7 7 天期限仅限一次
  // =========================================================================
  await runner.run("1.7", "7 天期限仅限一次", async () => {
    assert(await staking.has7DayStakeBeenUsed(userC.address), "应已使用7天质押");
    let reverted = false;
    try { await staking.connect(userC).stake(parseEther("100"), 0); }
    catch (e) { reverted = true; assert(errorContains(e, "7-day"), "应提示7天限制"); }
    assert(reverted, "应 revert");
  });

  // =========================================================================
  // 1.8 无效期限索引应 revert
  // =========================================================================
  await runner.run("1.8", "无效期限索引应 revert", async () => {
    await safeBindReferral(staking, userD, rootAddress);
    let reverted = false;
    try { await staking.connect(userD).stake(parseEther("100"), 5); }
    catch (e) {
      reverted = true;
      assert(errorContains(e, "Invalid stake index") || errorContains(e, "InvalidStakeIndex") || errorContains(e, "reverted"), "应无效索引");
    }
    assert(reverted, "应 revert");
  });

  // =========================================================================
  // 1.9 未绑定推荐人不能质押
  // =========================================================================
  await runner.run("1.9", "未绑定推荐人不能质押", async () => {
    assert(!(await staking.isBindReferral(userE.address)), "userE不应已绑定");
    let reverted = false;
    try { await staking.connect(userE).stake(parseEther("100"), 1); }
    catch (e) { reverted = true; }
    assert(reverted, "应 revert");
  });

  const allPassed = runner.summary();
  if (!allPassed) process.exit(1);
}

main()
  .then(() => process.exit(0))
  .catch((error) => { console.error(error); process.exit(1); });