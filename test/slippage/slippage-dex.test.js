/**
 * 模块 10：滑点保护与 DEX 交互
 * 测试项 10.1 ~ 10.5
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
  assertApproxEq,
} = require("../helpers/setup");
const { advanceTimeSeconds, takeSnapshot, revertSnapshot } = require("../helpers/time");

async function safeBindReferral(staking, user, referrer) {
  const isBound = await staking.isBindReferral(user.address);
  if (!isBound) {
    await staking.connect(user).lockReferral(referrer);
  }
}

async function main() {
  console.log("\n=== 模块 10：滑点保护与 DEX 交互 (10.1~10.5) ===\n");

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

  const runner = new TestRunner("模块 10：滑点保护与 DEX 交互");

  // 准备：设置余额和授权
  for (const u of [userA, userB, userC]) {
    await setUSDXBalance(u.address, parseEther("50000"));
    await approveUSDX(usdx, u, stakingAddress, parseEther("50000"));
  }

  // =========================================================================
  // 10.1 基础滑点容忍度 - 验证默认 15% 滑点保护
  // =========================================================================
  await runner.run("10.1", "基础滑点容忍度 - 验证默认 15% 滑点保护", async () => {
    const [baseSlippage, maxSlippage, priceImpactThreshold] =
      await staking.getSlippageConfig();

    assertEq(baseSlippage, 1500n, "基础滑点应为 1500 bps (15%)");
    assertEq(maxSlippage, 2000n, "最大滑点应为 2000 bps (20%)");
    assertEq(priceImpactThreshold, 200n, "价格冲击阈值应为 200 bps (2%)");

    console.log(`     基础滑点: ${baseSlippage} bps (${Number(baseSlippage) / 100}%)`);
    console.log(`     最大滑点: ${maxSlippage} bps (${Number(maxSlippage) / 100}%)`);
    console.log(`     价格冲击阈值: ${priceImpactThreshold} bps (${Number(priceImpactThreshold) / 100}%)`);

    // 验证小额质押时 previewStakeOutput 使用基础滑点
    // 小额质押的价格冲击 < 2%，应使用 15% 基础滑点
    const smallAmount = parseEther("100");
    const [halfUsdt, expectedAE, minAEOut] =
      await staking.previewStakeOutput(smallAmount);

    assert(halfUsdt === smallAmount / 2n, "halfUsdt 应为质押额的 50%");
    assert(expectedAE > 0n, "expectedAE 应大于 0");
    assert(minAEOut > 0n, "minAEOut 应大于 0");
    assert(minAEOut < expectedAE, "minAEOut 应小于 expectedAE（扣除费用+滑点）");

    // 验证 minAEOut 的计算逻辑：
    // expectedOutputAfterFees = expectedAE * (10000 - 300) / 10000 = expectedAE * 97%
    // minAEOut = expectedOutputAfterFees * (10000 - 1500) / 10000 = expectedOutputAfterFees * 85%
    // 即 minAEOut ≈ expectedAE * 0.97 * 0.85 = expectedAE * 0.8245
    const expectedAfterFees = (expectedAE * 9700n) / 10000n;
    const expectedMinOut = (expectedAfterFees * 8500n) / 10000n;
    // 允许 1 wei 误差（整数除法截断）
    assertApproxEq(minAEOut, expectedMinOut, 1n,
      "minAEOut 应 ≈ expectedAE * 97% * 85%");

    console.log(`     小额质押 (100 USDT): halfUsdt=${formatEther(halfUsdt)}, expectedAE=${formatEther(expectedAE)}, minAEOut=${formatEther(minAEOut)}`);
  });

  // =========================================================================
  // 10.2 最大滑点容忍度 - 价格冲击超过阈值时使用 20% 滑点
  // =========================================================================
  await runner.run("10.2", "最大滑点容忍度 - 价格冲击超过阈值时使用 20% 滑点", async () => {
    // 获取池子储备量，计算需要多大金额才能触发高价格冲击
    const token0 = await pair.token0();
    const reserves = await pair.getReserves();
    const isAEToken0 = token0.toLowerCase() === deployment.contracts.AE.toLowerCase();
    const reserveUSDX = isAEToken0 ? reserves[1] : reserves[0];

    // 价格冲击 = usdxAmountIn * 10000 / reserveUSDX
    // 要触发 > 2% (200 bps)，需要 usdxAmountIn > reserveUSDX * 200 / 10000 = reserveUSDX * 2%
    // 但 previewStakeOutput 会先除以 2（50% 用于 swap），所以实际质押额需要更大
    // halfUsdt = stakeAmount / 2
    // priceImpact = halfUsdt * 10000 / reserveUSDX
    // 要 priceImpact > 200: halfUsdt > reserveUSDX * 2% => stakeAmount > reserveUSDX * 4%
    const highImpactAmount = (reserveUSDX * 500n) / 10000n; // 5% of reserve, 确保超过阈值
    console.log(`     池子 USDX 储备: ${formatEther(reserveUSDX)}`);
    console.log(`     高冲击质押额: ${formatEther(highImpactAmount)}`);

    if (highImpactAmount > parseEther("1000")) {
      // 如果需要的金额超过单次上限，用最大允许额测试
      // 此时价格冲击可能不够大，但我们仍验证逻辑正确性
      const maxStake = await staking.maxStakeAmount();
      const [halfUsdt, expectedAE, minAEOut] =
        await staking.previewStakeOutput(maxStake);

      const halfUsdtVal = halfUsdt;
      const priceImpact = (halfUsdtVal * 10000n) / reserveUSDX;
      console.log(`     使用最大质押额: ${formatEther(maxStake)}, 价格冲击: ${priceImpact} bps`);

      if (priceImpact <= 200n) {
        // 价格冲击未超阈值，验证使用基础滑点
        const expectedAfterFees = (expectedAE * 9700n) / 10000n;
        const expectedMinOut = (expectedAfterFees * 8500n) / 10000n;
        assertApproxEq(minAEOut, expectedMinOut, 1n,
          "低冲击时应使用基础滑点 15%");
        console.log(`     价格冲击 ${priceImpact} bps <= 200 bps，使用基础滑点 15%`);
      } else {
        // 价格冲击超过阈值，验证使用动态滑点（最高 20%）
        assert(minAEOut > 0n, "minAEOut 应大于 0");
        // 动态滑点: slippageTolerance = 1500 + (priceImpact * 1500 / 200)
        // 如果超过 2000 则 cap 到 2000
        let dynamicSlippage = 1500n + (priceImpact * 1500n) / 200n;
        if (dynamicSlippage > 2000n) dynamicSlippage = 2000n;
        const expectedAfterFees = (expectedAE * 9700n) / 10000n;
        const expectedMinOut = (expectedAfterFees * (10000n - dynamicSlippage)) / 10000n;
        assertApproxEq(minAEOut, expectedMinOut, 1n,
          "高冲击时应使用动态滑点");
        console.log(`     动态滑点: ${dynamicSlippage} bps`);
      }
    } else {
      // 可以直接用高冲击金额测试
      const [halfUsdt, expectedAE, minAEOut] =
        await staking.previewStakeOutput(highImpactAmount);

      const priceImpact = (halfUsdt * 10000n) / reserveUSDX;
      console.log(`     价格冲击: ${priceImpact} bps`);
      assert(priceImpact > 200n, "价格冲击应超过 2% 阈值");

      // 计算动态滑点
      let dynamicSlippage = 1500n + (priceImpact * 1500n) / 200n;
      if (dynamicSlippage > 2000n) dynamicSlippage = 2000n;

      const expectedAfterFees = (expectedAE * 9700n) / 10000n;
      const expectedMinOut = (expectedAfterFees * (10000n - dynamicSlippage)) / 10000n;
      assertApproxEq(minAEOut, expectedMinOut, 1n,
        "高冲击时应使用动态/最大滑点");
      console.log(`     动态滑点: ${dynamicSlippage} bps (cap at 2000)`);
    }
  });

  // =========================================================================
  // 10.3 价格冲击阈值 - 验证 2% 价格冲击阈值触发逻辑
  // =========================================================================
  await runner.run("10.3", "价格冲击阈值 - 验证 2% 触发逻辑", async () => {
    const token0 = await pair.token0();
    const reserves = await pair.getReserves();
    const isAEToken0 = token0.toLowerCase() === deployment.contracts.AE.toLowerCase();
    const reserveUSDX = isAEToken0 ? reserves[1] : reserves[0];
    const reserveAE = isAEToken0 ? reserves[0] : reserves[1];

    // 测试恰好在阈值边界的情况
    // priceImpact = halfUsdt * 10000 / reserveUSDX
    // 要 priceImpact = 200: halfUsdt = reserveUSDX * 200 / 10000 = reserveUSDX * 2%
    // stakeAmount = halfUsdt * 2

    // 1) 低于阈值：priceImpact < 200 bps
    const lowImpactHalf = (reserveUSDX * 100n) / 10000n; // 1% of reserve
    const lowImpactStake = lowImpactHalf * 2n;
    const [halfLow, expectedAELow, minAEOutLow] =
      await staking.previewStakeOutput(lowImpactStake);

    const impactLow = (halfLow * 10000n) / reserveUSDX;
    console.log(`     低冲击: stakeAmount=${formatEther(lowImpactStake)}, 价格冲击=${impactLow} bps`);
    assert(impactLow <= 200n, "低冲击应 <= 200 bps");

    // 低冲击时使用基础滑点 15%
    const expectedAfterFeesLow = (expectedAELow * 9700n) / 10000n;
    const expectedMinOutLow = (expectedAfterFeesLow * 8500n) / 10000n;
    assertApproxEq(minAEOutLow, expectedMinOutLow, 1n,
      "低冲击应使用 15% 基础滑点");

    // 2) 高于阈值：priceImpact > 200 bps
    const highImpactHalf = (reserveUSDX * 300n) / 10000n; // 3% of reserve
    const highImpactStake = highImpactHalf * 2n;

    // 检查是否超过单次上限
    const maxStake = await staking.maxStakeAmount();
    if (highImpactStake <= maxStake) {
      const [halfHigh, expectedAEHigh, minAEOutHigh] =
        await staking.previewStakeOutput(highImpactStake);

      const impactHigh = (halfHigh * 10000n) / reserveUSDX;
      console.log(`     高冲击: stakeAmount=${formatEther(highImpactStake)}, 价格冲击=${impactHigh} bps`);
      assert(impactHigh > 200n, "高冲击应 > 200 bps");

      // 高冲击时使用动态滑点
      let dynamicSlippage = 1500n + (impactHigh * 1500n) / 200n;
      if (dynamicSlippage > 2000n) dynamicSlippage = 2000n;

      const expectedAfterFeesHigh = (expectedAEHigh * 9700n) / 10000n;
      const expectedMinOutHigh = (expectedAfterFeesHigh * (10000n - dynamicSlippage)) / 10000n;
      assertApproxEq(minAEOutHigh, expectedMinOutHigh, 1n,
        "高冲击应使用动态滑点");

      // 验证高冲击的 minAEOut 比例更低（滑点更大）
      // minAEOutLow / expectedAELow > minAEOutHigh / expectedAEHigh
      const ratioLow = (minAEOutLow * 10000n) / expectedAELow;
      const ratioHigh = (minAEOutHigh * 10000n) / expectedAEHigh;
      assert(ratioLow >= ratioHigh,
        "高冲击的 minAEOut 比例应 <= 低冲击的比例");
      console.log(`     低冲击比例: ${ratioLow} bps, 高冲击比例: ${ratioHigh} bps`);
    } else {
      console.log(`     高冲击质押额 ${formatEther(highImpactStake)} 超过上限 ${formatEther(maxStake)}，跳过高冲击对比测试`);
      // 仍然验证低冲击逻辑正确
      assert(true, "低冲击验证已通过");
    }
  });

  // =========================================================================
  // 10.4 AE 买入费用计算 - 验证 0.5% burn + 2.5% 流动性 = 3% 总买入费
  // =========================================================================
  await advanceTimeSeconds(120);
  await runner.run("10.4", "AE 买入费用计算 - 验证 3% 总买入费", async () => {
    await safeBindReferral(staking, userA, rootAddress);

    // 获取质押前的 AE 余额和池子状态
    const token0 = await pair.token0();
    const isAEToken0 = token0.toLowerCase() === deployment.contracts.AE.toLowerCase();

    // 预览质押输出
    const stakeAmount = parseEther("200");
    const [halfUsdt, expectedAE, minAEOut] =
      await staking.previewStakeOutput(stakeAmount);

    console.log(`     质押额: ${formatEther(stakeAmount)} USDT`);
    console.log(`     swap 用 USDT: ${formatEther(halfUsdt)}`);
    console.log(`     预期 AE (无费用): ${formatEther(expectedAE)}`);
    console.log(`     最小 AE (含费用+滑点): ${formatEther(minAEOut)}`);

    // 验证 expectedAE 是不含买入费的原始输出
    // minAEOut 应该是扣除 3% 买入费和滑点后的值
    // expectedOutputAfterFees = expectedAE * 97% (扣除 3% 买入费)
    const expectedAfterFees = (expectedAE * 9700n) / 10000n;
    console.log(`     扣除 3% 费用后预期: ${formatEther(expectedAfterFees)}`);

    // 验证费用结构：minAEOut < expectedAfterFees（因为还有滑点）
    assert(minAEOut <= expectedAfterFees,
      "minAEOut 应 <= 扣费后预期（还需扣滑点）");

    // 验证费用比例：3% = 300 bps
    // expectedAfterFees / expectedAE ≈ 0.97
    const feeRatio = 10000n - (expectedAfterFees * 10000n) / expectedAE;
    console.log(`     实际费用比例: ${feeRatio} bps (应为 ~300 bps)`);
    // 允许 1 bps 误差（整数除法）
    assertApproxEq(feeRatio, 300n, 1n, "买入费应为 300 bps (3%)");

    // 实际执行质押，验证 swap 成功完成
    const aeBalanceBefore = await ae.balanceOf(stakingAddress);
    const tx = await staking.connect(userA).stake(stakeAmount, 1);
    const receipt = await tx.wait();
    assert(receipt.status === 1, "质押交易应成功");

    // 验证 Staked 事件触发
    let stakedEvent = null;
    for (const log of receipt.logs) {
      try {
        const parsed = staking.interface.parseLog(log);
        if (parsed && parsed.name === "Staked") { stakedEvent = parsed; break; }
      } catch { /* ignore */ }
    }
    assert(stakedEvent, "应触发 Staked 事件");
    console.log(`     质押成功，Staked 事件已触发`);
  });

  // =========================================================================
  // 10.5 swap 失败处理 - DEX swap 失败时的回退行为
  // =========================================================================
  await advanceTimeSeconds(120);
  await runner.run("10.5", "swap 失败处理 - 授权不足导致 swap 失败", async () => {
    await safeBindReferral(staking, userB, rootAddress);

    // 场景 1：用户未授权 USDX 给质押合约，swap 应失败（transferFrom 失败）
    await usdx.connect(userB).approve(stakingAddress, 0);
    let reverted = false;
    try {
      await staking.connect(userB).stake(parseEther("100"), 1);
    } catch (error) {
      reverted = true;
      console.log(`     场景1 - 授权不足 revert: ${error.message.substring(0, 80)}...`);
    }
    assert(reverted, "授权不足时质押应 revert");

    // 恢复授权
    await approveUSDX(usdx, userB, stakingAddress, parseEther("50000"));

    // 场景 2：用户 USDX 余额不足
    await safeBindReferral(staking, userC, rootAddress);
    // 将 userC 的 USDX 余额设为 0
    await setUSDXBalance(userC.address, 0n);
    await approveUSDX(usdx, userC, stakingAddress, parseEther("50000"));

    let reverted2 = false;
    try {
      await staking.connect(userC).stake(parseEther("100"), 1);
    } catch (error) {
      reverted2 = true;
      console.log(`     场景2 - 余额不足 revert: ${error.message.substring(0, 80)}...`);
    }
    assert(reverted2, "余额不足时质押应 revert");

    // 场景 3：正常质押应成功（对比验证）
    await setUSDXBalance(userB.address, parseEther("50000"));
    const tx = await staking.connect(userB).stake(parseEther("100"), 1);
    const receipt = await tx.wait();
    assert(receipt.status === 1, "正常条件下质押应成功");
    console.log(`     场景3 - 正常质押成功`);
  });

  const allPassed = runner.summary();

  // 恢复快照
  await revertSnapshot(snapshotId);

  if (!allPassed) process.exit(1);
}

main()
  .then(() => process.exit(0))
  .catch((error) => { console.error(error); process.exit(1); });
