/**
 * 模块 1：质押功能 (stake) 测试 - 第二部分
 * 测试项 1.10 ~ 1.15
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

async function main() {
  console.log("\n=== 模块 1：质押功能 (stake) 测试 - 第二部分 (1.10~1.15) ===\n");

  const deployment = loadDeployment();
  const { ae, staking, pair, usdx } = await getContracts(deployment);
  const [deployer, ...accounts] = await hre.ethers.getSigners();
  const stakingAddress = deployment.contracts.Staking;
  const rootAddress = deployment.addresses.rootAddress;

  // 使用靠后的账户避免冲突
  const userF = accounts[10];
  const userG = accounts[11];
  const userH = accounts[12];

  const parseEther = hre.ethers.parseEther;
  const formatEther = hre.ethers.formatEther;

  const runner = new TestRunner("模块 1：质押功能 (stake) - 第二部分");

  // 准备：设置余额和授权
  for (const user of [userF, userG, userH]) {
    await setUSDXBalance(user.address, parseEther("50000"));
    await approveUSDX(usdx, user, stakingAddress, parseEther("50000"));
  }

  // =========================================================================
  // 1.10 流动性添加验证
  // =========================================================================
  await runner.run("1.10", "流动性添加验证", async () => {
    await safeBindReferral(staking, userF, rootAddress);

    const reservesBefore = await pair.getReserves();
    const token0 = await pair.token0();
    const isAEToken0 = token0.toLowerCase() === deployment.contracts.AE.toLowerCase();
    const usdxReserveBefore = isAEToken0 ? reservesBefore[1] : reservesBefore[0];

    const stakeAmount = parseEther("500");
    await staking.connect(userF).stake(stakeAmount, 1);

    const reservesAfter = await pair.getReserves();
    const usdxReserveAfter = isAEToken0 ? reservesAfter[1] : reservesAfter[0];

    assert(usdxReserveAfter > usdxReserveBefore, "USDX 储备应增加");
    console.log(`     USDX 储备: ${formatEther(usdxReserveBefore)} -> ${formatEther(usdxReserveAfter)}`);
  });

  // =========================================================================
  // 1.11 LP Token 烧毁验证
  // =========================================================================
  await runner.run("1.11", "LP Token 烧毁验证", async () => {
    const lpBurnBalance = await pair.balanceOf(hre.ethers.ZeroAddress);
    console.log(`     burn 地址 LP 余额: ${formatEther(lpBurnBalance)}`);
    assert(lpBurnBalance > 0n, "burn 地址应持有 LP Token");
  });

  // =========================================================================
  // 1.12 多次质押累计验证
  // =========================================================================
  await runner.run("1.12", "多次质押累计验证", async () => {
    await safeBindReferral(staking, userG, rootAddress);

    const principalBefore = await staking.principalBalance(userG.address);
    const countBefore = Number(await staking.stakeCount(userG.address));

    await staking.connect(userG).stake(parseEther("200"), 1);
    await staking.connect(userG).stake(parseEther("300"), 2);
    await staking.connect(userG).stake(parseEther("500"), 3);

    const principalAfter = await staking.principalBalance(userG.address);
    const countAfter = Number(await staking.stakeCount(userG.address));

    assertEq(principalAfter - principalBefore, parseEther("1000"), "新增本金应为 1000");
    assertEq(countAfter, countBefore + 3, "质押记录数应增加 3");
  });

  // =========================================================================
  // 1.13 动态最大质押额验证
  // =========================================================================
  await runner.run("1.13", "动态最大质押额验证", async () => {
    const maxStake = await staking.maxStakeAmount();
    console.log(`     当前动态最大质押额: ${formatEther(maxStake)} USDT`);
    assert(maxStake <= parseEther("1000"), "不应超过 1000 USDT");
    assert(maxStake >= parseEther("100"), "应至少为 100 USDT");
  });

  // =========================================================================
  // 1.14 USDX 授权不足应 revert
  // =========================================================================
  await runner.run("1.14", "USDX 授权不足应 revert", async () => {
    await safeBindReferral(staking, userH, rootAddress);
    await usdx.connect(userH).approve(stakingAddress, 0);

    let reverted = false;
    try {
      await staking.connect(userH).stake(parseEther("100"), 1);
    } catch (error) {
      reverted = true;
    }
    assert(reverted, "授权不足应 revert");
    await approveUSDX(usdx, userH, stakingAddress, parseEther("50000"));
  });

  // =========================================================================
  // 1.15 Staked 事件参数验证
  // =========================================================================
  await runner.run("1.15", "Staked 事件参数验证", async () => {
    const stakeAmount = parseEther("200");
    const tx = await staking.connect(userH).stake(stakeAmount, 2);
    const receipt = await tx.wait();

    let stakedEvent = null;
    for (const log of receipt.logs) {
      try {
        const parsed = staking.interface.parseLog(log);
        if (parsed && parsed.name === "Staked") { stakedEvent = parsed; break; }
      } catch { /* ignore */ }
    }

    assert(stakedEvent, "应触发 Staked 事件");
    assertEq(stakedEvent.args.user, userH.address, "事件 user 应匹配");
    assertEq(stakedEvent.args.amount, stakeAmount, "事件 amount 应匹配");
    assert(stakedEvent.args.timestamp > 0n, "timestamp 应大于 0");
    assert(stakedEvent.args.index >= 0n, "index 应有效");
    assert(stakedEvent.args.stakeTime > 0n, "stakeTime 应大于 0");
    console.log(`     事件: user=${stakedEvent.args.user}, amount=${formatEther(stakedEvent.args.amount)}, index=${stakedEvent.args.index}`);
  });

  const allPassed = runner.summary();
  if (!allPassed) process.exit(1);
}

main()
  .then(() => process.exit(0))
  .catch((error) => { console.error(error); process.exit(1); });
