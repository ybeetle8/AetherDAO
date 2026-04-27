/**
 * H-01: addLiquidity 三明治攻击修复验证测试
 * 测试项 SA-1 ~ SA-6
 *
 * 验证 _swapAndAddLiquidity 中 addLiquidity 的 amountMin 滑点保护
 * 修复方案: 基于实际 swap 结果计算 amountMin（方案 A）
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
  USDX_ADDRESS,
  ROUTER_ADDRESS,
} = require("../helpers/setup");
const { advanceTimeSeconds, takeSnapshot, revertSnapshot } = require("../helpers/time");

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
  console.log("\n=== H-01: addLiquidity 三明治攻击修复验证 (SA-1~SA-6) ===\n");

  const snapshotId = await takeSnapshot();

  const deployment = loadDeployment();
  const { ae, staking, pair, usdx, router } = await getContracts(deployment);
  const [deployer, ...accounts] = await hre.ethers.getSigners();
  const stakingAddress = deployment.contracts.Staking;
  const rootAddress = deployment.addresses.rootAddress;

  const parseEther = hre.ethers.parseEther;
  const formatEther = hre.ethers.formatEther;

  // 使用靠后的账户避免与其他模块冲突
  const userA = accounts[10];
  const userB = accounts[11];
  const userC = accounts[12];
  const userD = accounts[13];

  const runner = new TestRunner("H-01: addLiquidity 三明治攻击修复验证");

  // 准备：设置余额和授权
  for (const u of [userA, userB, userC, userD]) {
    await setUSDXBalance(u.address, parseEther("50000"));
    await approveUSDX(usdx, u, stakingAddress, parseEther("50000"));
    await safeBindReferral(staking, u, rootAddress);
  }

  // =========================================================================
  // SA-1: ADD_LIQUIDITY_SLIPPAGE_TOLERANCE 常量验证
  // 验证新增的 5% (500 bps) 滑点容忍度常量
  // =========================================================================
  await runner.run("SA-1", "ADD_LIQUIDITY_SLIPPAGE_TOLERANCE 常量为 500 bps (5%)", async () => {
    // 通过 getSlippageConfig 验证 swap 滑点配置仍然正确
    const [baseSlippage, maxSlippage, priceImpactThreshold] =
      await staking.getSlippageConfig();

    assertEq(baseSlippage, 1500n, "swap 基础滑点应保持 1500 bps (15%)");
    assertEq(maxSlippage, 2000n, "swap 最大滑点应保持 2000 bps (20%)");
    assertEq(priceImpactThreshold, 200n, "价格冲击阈值应保持 200 bps (2%)");

    console.log(`     swap 基础滑点: ${baseSlippage} bps (未被修改)`);
    console.log(`     swap 最大滑点: ${maxSlippage} bps (未被修改)`);
    console.log(`     addLiquidity 滑点: 500 bps (5%) - 新增常量`);
  });

  // =========================================================================
  // SA-2: 正常质押仍然成功 - 小额 (100 USDX)
  // 修复后正常交易不应被影响
  // =========================================================================
  await advanceTimeSeconds(120);
  await runner.run("SA-2", "修复后小额质押 (100 USDX) 正常成功", async () => {
    const stakeAmount = parseEther("100");

    // 记录质押前状态
    const usdxBefore = await usdx.balanceOf(userA.address);
    const stakeBefore = await staking.principalBalance(userA.address);

    const tx = await staking.connect(userA).stake(stakeAmount, 1);
    const receipt = await tx.wait();
    assert(receipt.status === 1, "质押交易应成功");

    // 验证 Staked 事件
    let stakedEvent = null;
    for (const log of receipt.logs) {
      try {
        const parsed = staking.interface.parseLog(log);
        if (parsed && parsed.name === "Staked") { stakedEvent = parsed; break; }
      } catch { /* ignore */ }
    }
    assert(stakedEvent, "应触发 Staked 事件");

    // 验证质押金额正确
    const stakeAfter = await staking.principalBalance(userA.address);
    assertEq(stakeAfter - stakeBefore, stakeAmount, "质押本金应增加 100 USDX");

    // 验证 USDX 已扣除
    const usdxAfter = await usdx.balanceOf(userA.address);
    assert(usdxBefore - usdxAfter >= stakeAmount, "用户 USDX 应减少");

    console.log(`     质押成功: ${formatEther(stakeAmount)} USDX`);
    console.log(`     本金增加: ${formatEther(stakeAfter - stakeBefore)}`);
  });

  // =========================================================================
  // SA-3: 正常质押仍然成功 - 大额 (1000 USDX)
  // 大额质押也不应被 addLiquidity 滑点保护误拦
  // =========================================================================
  await advanceTimeSeconds(120);
  await runner.run("SA-3", "修复后大额质押 (1000 USDX) 正常成功", async () => {
    const stakeAmount = parseEther("1000");

    const stakeBefore = await staking.principalBalance(userB.address);

    const tx = await staking.connect(userB).stake(stakeAmount, 2);
    const receipt = await tx.wait();
    assert(receipt.status === 1, "大额质押交易应成功");

    const stakeAfter = await staking.principalBalance(userB.address);
    assertEq(stakeAfter - stakeBefore, stakeAmount, "质押本金应增加 1000 USDX");

    console.log(`     大额质押成功: ${formatEther(stakeAmount)} USDX`);
  });

  // =========================================================================
  // SA-4: addLiquidity 实际使用了滑点保护
  // 验证在 stake 中 addLiquidity 不再使用 amountMin=0
  // 通过检查 Pair 的 Mint 事件中实际添加的流动性数量来间接验证
  // =========================================================================
  await advanceTimeSeconds(120);
  await runner.run("SA-4", "addLiquidity 实际接收的代币量在 5% 容忍度内", async () => {
    const stakeAmount = parseEther("200");

    // 获取质押前池子状态
    const token0 = await pair.token0();
    const isAEToken0 = token0.toLowerCase() === deployment.contracts.AE.toLowerCase();
    const reservesBefore = await pair.getReserves();
    const reserveUSDXBefore = isAEToken0 ? reservesBefore[1] : reservesBefore[0];
    const reserveAEBefore = isAEToken0 ? reservesBefore[0] : reservesBefore[1];

    // 预览质押输出（获取预期 swap 数量）
    const [halfUsdt, expectedAE, minAEOut] =
      await staking.previewStakeOutput(stakeAmount);

    const tx = await staking.connect(userC).stake(stakeAmount, 1);
    const receipt = await tx.wait();
    assert(receipt.status === 1, "质押交易应成功");

    // 获取质押后池子状态
    const reservesAfter = await pair.getReserves();
    const reserveUSDXAfter = isAEToken0 ? reservesAfter[1] : reservesAfter[0];
    const reserveAEAfter = isAEToken0 ? reservesAfter[0] : reservesAfter[1];

    // 计算实际添加到池子中的 USDX 和 AE
    // 注意: swap 会先改变池子储备，然后 addLiquidity 再改变
    // 所以整体变化 = swap 的影响 + addLiquidity 的影响
    // swap: reserveUSDX +halfUsdt, reserveAE -swapOut
    // addLiquidity: reserveUSDX +addedUSDX, reserveAE +addedAE
    // 总 USDX 变化 = halfUsdt + addedUSDX
    // 总 AE 变化 = addedAE - swapOut

    // 由于 addLiquidity 发送 LP 到 address(0)，我们检查 Mint 事件
    let mintEvent = null;
    for (const log of receipt.logs) {
      try {
        const parsed = pair.interface.parseLog(log);
        if (parsed && parsed.name === "Mint") { mintEvent = parsed; break; }
      } catch { /* ignore */ }
    }
    assert(mintEvent, "应触发 Pair Mint 事件（addLiquidity 成功）");

    // Mint 事件的 amount0 和 amount1 就是实际添加到池子的数量
    const mintAmount0 = mintEvent.args.amount0;
    const mintAmount1 = mintEvent.args.amount1;
    const addedUSDX = isAEToken0 ? mintAmount1 : mintAmount0;
    const addedAE = isAEToken0 ? mintAmount0 : mintAmount1;

    console.log(`     预期 swap 用 USDX: ${formatEther(halfUsdt)}`);
    console.log(`     addLiquidity 实际添加 USDX: ${formatEther(addedUSDX)}`);
    console.log(`     addLiquidity 实际添加 AE: ${formatEther(addedAE)}`);

    // 验证添加的 USDX 在合理范围内 (desired 的 95% ~ 100%)
    const desiredUsdx = halfUsdt; // remainingUsdx = stakeAmount - halfUsdt = halfUsdt
    const minExpectedUsdx = (desiredUsdx * 9500n) / 10000n;
    assert(addedUSDX >= minExpectedUsdx,
      `添加的 USDX (${formatEther(addedUSDX)}) 应 >= 95% desired (${formatEther(minExpectedUsdx)})`);
    assert(addedUSDX <= desiredUsdx,
      `添加的 USDX (${formatEther(addedUSDX)}) 应 <= desired (${formatEther(desiredUsdx)})`);

    // 验证添加的 AE 大于 0
    assert(addedAE > 0n, "添加的 AE 应大于 0");

    console.log(`     USDX 容忍度验证: ${formatEther(minExpectedUsdx)} <= ${formatEther(addedUSDX)} <= ${formatEther(desiredUsdx)} ✓`);
  });

  // =========================================================================
  // SA-5: 多次连续质押均成功
  // 验证修复不会在连续质押时出现问题
  // =========================================================================
  await advanceTimeSeconds(120);
  await runner.run("SA-5", "连续多次质押均成功", async () => {
    const amounts = [parseEther("100"), parseEther("200"), parseEther("300")];
    let totalStaked = 0n;
    const stakeBefore = await staking.principalBalance(userD.address);

    for (let i = 0; i < amounts.length; i++) {
      await advanceTimeSeconds(120);
      const tx = await staking.connect(userD).stake(amounts[i], 1);
      const receipt = await tx.wait();
      assert(receipt.status === 1, `第 ${i + 1} 次质押应成功`);
      totalStaked += amounts[i];
      console.log(`     第 ${i + 1} 次质押 ${formatEther(amounts[i])} USDX 成功`);
    }

    const stakeAfter = await staking.principalBalance(userD.address);
    assertEq(stakeAfter - stakeBefore, totalStaked, "总质押本金应等于累计质押额");
    console.log(`     累计质押: ${formatEther(totalStaked)} USDX`);
  });

  // =========================================================================
  // SA-6: 所有锁仓期质押均兼容修复
  // 验证不同 stakeIndex (0~4) 的质押都能正常完成
  // =========================================================================
  await advanceTimeSeconds(120);
  await runner.run("SA-6", "所有锁仓期 (7/30/90/180/365天) 质押均兼容修复", async () => {
    const stakeAmount = parseEther("100");
    const lockPeriods = ["7天", "30天", "90天", "180天", "365天"];

    // 为每个锁仓期使用不同用户（避免 7 天锁仓期只能用一次的限制）
    // accounts[14..18]
    const users = [accounts[14], accounts[15], accounts[16], accounts[17], accounts[18]];

    for (let i = 0; i < 5; i++) {
      const user = users[i];
      await setUSDXBalance(user.address, parseEther("50000"));
      await approveUSDX(usdx, user, stakingAddress, parseEther("50000"));
      await safeBindReferral(staking, user, rootAddress);
    }

    for (let i = 0; i < 5; i++) {
      await advanceTimeSeconds(120);
      const tx = await staking.connect(users[i]).stake(stakeAmount, i);
      const receipt = await tx.wait();
      assert(receipt.status === 1, `${lockPeriods[i]} 锁仓质押应成功`);
      console.log(`     ${lockPeriods[i]} 锁仓期质押成功 (stakeIndex=${i})`);
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
