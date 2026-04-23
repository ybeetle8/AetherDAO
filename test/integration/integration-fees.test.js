/**
 * 模块 12：综合场景测试 - 第二部分
 * 测试项 12.5 ~ 12.7
 *
 * 12.5 教育基金累计
 * 12.6 赎回费累计
 * 12.7 7天质押重置流程
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

async function createFundedWallet() {
  const wallet = hre.ethers.Wallet.createRandom().connect(hre.ethers.provider);
  const [funder] = await hre.ethers.getSigners();
  await funder.sendTransaction({ to: wallet.address, value: parseEther("1") });
  return wallet;
}

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
  console.log("\n=== 模块 12：综合场景测试 - 第二部分 (12.5~12.7) ===\n");

  const snapshotId = await takeSnapshot();

  const deployment = loadDeployment();
  const { ae, staking, pair, usdx } = await getContracts(deployment);
  const [deployer, ...accounts] = await hre.ethers.getSigners();
  const stakingAddress = deployment.contracts.Staking;
  const rootAddress = deployment.addresses.rootAddress;
  const educationFundAddress = deployment.addresses.educationFundAddress;
  const feeRecipientAddress = deployment.addresses.feeRecipient;

  const runner = new TestRunner("模块 12：综合场景测试 - 第二部分");

  // =========================================================================
  // 12.5 教育基金累计
  // 多次赎回后验证教育基金地址累计收到的金额
  // =========================================================================
  await advanceTimeSeconds(120);
  await runner.run("12.5", "教育基金累计", async () => {
    const userA = await createFundedWallet();
    const userB = await createFundedWallet();
    await setUSDXBalance(userA.address, parseEther("50000"));
    await approveUSDX(usdx, userA, stakingAddress, parseEther("50000"));
    await staking.connect(userA).lockReferral(rootAddress);

    await setUSDXBalance(userB.address, parseEther("50000"));
    await approveUSDX(usdx, userB, stakingAddress, parseEther("50000"));
    await staking.connect(userB).lockReferral(rootAddress);

    const eduBalStart = await usdx.balanceOf(educationFundAddress);
    console.log(`     教育基金初始余额: ${formatEther(eduBalStart)} USDX`);

    // 用户A 质押并赎回
    await advanceTimeSeconds(120);
    await staking.connect(userA).stake(parseEther("500"), 1); // 30天期
    const idxA = Number(await staking.stakeCount(userA.address)) - 1;

    // 用户B 质押并赎回
    await advanceTimeSeconds(120);
    await staking.connect(userB).stake(parseEther("300"), 1); // 30天期
    const idxB = Number(await staking.stakeCount(userB.address)) - 1;

    // 推进 30 天到期
    await advanceTime(30);
    await advanceTimeSeconds(1);

    // 赎回 A
    const eduBalBeforeA = await usdx.balanceOf(educationFundAddress);
    await staking.connect(userA).unstake(idxA);
    const eduBalAfterA = await usdx.balanceOf(educationFundAddress);
    const eduFromA = eduBalAfterA - eduBalBeforeA;
    console.log(`     用户A赎回 → 教育基金收到: ${formatEther(eduFromA)} USDX`);
    assert(eduFromA > 0n, "用户A赎回后教育基金应增加");

    // 赎回 B
    const eduBalBeforeB = await usdx.balanceOf(educationFundAddress);
    await staking.connect(userB).unstake(idxB);
    const eduBalAfterB = await usdx.balanceOf(educationFundAddress);
    const eduFromB = eduBalAfterB - eduBalBeforeB;
    console.log(`     用户B赎回 → 教育基金收到: ${formatEther(eduFromB)} USDX`);
    assert(eduFromB > 0n, "用户B赎回后教育基金应增加");

    // 验证累计
    const eduBalEnd = await usdx.balanceOf(educationFundAddress);
    const totalEdu = eduBalEnd - eduBalStart;
    console.log(`     教育基金累计收到: ${formatEther(totalEdu)} USDX`);
    assert(totalEdu > 0n, "教育基金累计应大于 0");
    // 累计应等于两次之和
    assertApproxEq(totalEdu, eduFromA + eduFromB, parseEther("0.01"), "累计应等于两次之和");
  });

  // =========================================================================
  // 12.6 赎回费累计
  // 多次赎回后验证 feeRecipient 累计收到的金额
  // =========================================================================
  await advanceTimeSeconds(120);
  await runner.run("12.6", "赎回费累计", async () => {
    const userC = await createFundedWallet();
    const userD = await createFundedWallet();
    await setUSDXBalance(userC.address, parseEther("50000"));
    await approveUSDX(usdx, userC, stakingAddress, parseEther("50000"));
    await staking.connect(userC).lockReferral(rootAddress);

    await setUSDXBalance(userD.address, parseEther("50000"));
    await approveUSDX(usdx, userD, stakingAddress, parseEther("50000"));
    await staking.connect(userD).lockReferral(rootAddress);

    const feeBalStart = await usdx.balanceOf(feeRecipientAddress);
    console.log(`     赎回费接收地址初始余额: ${formatEther(feeBalStart)} USDX`);

    // 用户C 质押
    await advanceTimeSeconds(120);
    await staking.connect(userC).stake(parseEther("500"), 1);
    const idxC = Number(await staking.stakeCount(userC.address)) - 1;

    // 用户D 质押
    await advanceTimeSeconds(120);
    await staking.connect(userD).stake(parseEther("400"), 1);
    const idxD = Number(await staking.stakeCount(userD.address)) - 1;

    // 推进 30 天到期
    await advanceTime(30);
    await advanceTimeSeconds(1);

    // 赎回 C，解析 RedemptionFeeCollected 事件
    let feeFromC = 0n;
    const txC = await staking.connect(userC).unstake(idxC);
    const receiptC = await txC.wait();
    for (const log of receiptC.logs) {
      try {
        const parsed = staking.interface.parseLog(log);
        if (parsed && parsed.name === "RedemptionFeeCollected") {
          feeFromC = parsed.args.usdxAmount;
          break;
        }
      } catch { /* ignore */ }
    }
    console.log(`     用户C赎回费: ${formatEther(feeFromC)} USDX`);
    assert(feeFromC > 0n, "用户C赎回费应大于 0");

    // 赎回 D
    let feeFromD = 0n;
    const txD = await staking.connect(userD).unstake(idxD);
    const receiptD = await txD.wait();
    for (const log of receiptD.logs) {
      try {
        const parsed = staking.interface.parseLog(log);
        if (parsed && parsed.name === "RedemptionFeeCollected") {
          feeFromD = parsed.args.usdxAmount;
          break;
        }
      } catch { /* ignore */ }
    }
    console.log(`     用户D赎回费: ${formatEther(feeFromD)} USDX`);
    assert(feeFromD > 0n, "用户D赎回费应大于 0");

    // 验证累计
    const feeBalEnd = await usdx.balanceOf(feeRecipientAddress);
    const totalFee = feeBalEnd - feeBalStart;
    console.log(`     赎回费累计: ${formatEther(totalFee)} USDX`);
    assert(totalFee > 0n, "赎回费累计应大于 0");
  });

  // =========================================================================
  // 12.7 7天质押重置流程
  // 使用7天→重置→再次使用7天，验证完整流程
  // =========================================================================
  await advanceTimeSeconds(120);
  await runner.run("12.7", "7天质押重置流程", async () => {
    const user = await createFundedWallet();
    await setUSDXBalance(user.address, parseEther("50000"));
    await approveUSDX(usdx, user, stakingAddress, parseEther("50000"));
    await staking.connect(user).lockReferral(rootAddress);

    // 步骤1: 第一次 7 天质押
    await advanceTimeSeconds(120);
    await staking.connect(user).stake(parseEther("100"), 0); // 7天期
    const idx1 = Number(await staking.stakeCount(user.address)) - 1;
    assert(await staking.has7DayStakeBeenUsed(user.address), "应标记已使用7天质押");
    console.log(`     第一次7天质押成功, stakeIndex=${idx1}`);

    // 步骤2: 尝试第二次 7 天质押，应 revert
    let reverted = false;
    try {
      await staking.connect(user).stake(parseEther("100"), 0);
    } catch (e) {
      reverted = true;
      assert(errorContains(e, "7-day"), "应提示7天限制");
    }
    assert(reverted, "第二次7天质押应 revert");
    console.log(`     第二次7天质押被拒绝 (预期行为)`);

    // 步骤3: 等待到期并赎回
    await advanceTime(7);
    await advanceTimeSeconds(1);
    assert(await staking.canWithdrawStake(user.address, idx1), "7天后应可赎回");
    await staking.connect(user).unstake(idx1);
    console.log(`     第一次7天质押已赎回`);

    // 步骤4: 赎回后仍然不能再次使用7天（需要管理员重置）
    reverted = false;
    try {
      await advanceTimeSeconds(120);
      await staking.connect(user).stake(parseEther("100"), 0);
    } catch (e) {
      reverted = true;
    }
    assert(reverted, "赎回后未重置仍应 revert");
    console.log(`     赎回后未重置，7天质押仍被拒绝 (预期行为)`);

    // 步骤5: 管理员重置
    await staking.connect(deployer).reset7DayStakeUsage(user.address);
    assert(!await staking.has7DayStakeBeenUsed(user.address), "重置后应未使用");
    console.log(`     管理员已重置7天质押标记`);

    // 步骤6: 重置后再次使用7天质押
    await advanceTimeSeconds(120);
    await staking.connect(user).stake(parseEther("100"), 0);
    const idx2 = Number(await staking.stakeCount(user.address)) - 1;
    assert(await staking.has7DayStakeBeenUsed(user.address), "应再次标记已使用");
    console.log(`     重置后第二次7天质押成功, stakeIndex=${idx2}`);
    assert(idx2 > idx1, "新质押索引应大于旧索引");
  });

  const allPassed = runner.summary();
  await revertSnapshot(snapshotId);
  if (!allPassed) process.exit(1);
}

main()
  .then(() => process.exit(0))
  .catch((error) => { console.error(error); process.exit(1); });
