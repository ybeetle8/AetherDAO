/**
 * 质押赎回余额验证测试
 *
 * 复现问题：质押 1000U，7天后赎回（本金1000，利息24.38），
 * 但地址上的 U 比未质押前少了。
 *
 * 测试逻辑：
 * 1. 记录质押前钱包 USDX 余额
 * 2. 质押 1000 USDX（7天档位）
 * 3. 记录质押后钱包 USDX 余额（应减少 1000）
 * 4. 快进 7 天
 * 5. 赎回
 * 6. 记录赎回后钱包 USDX 余额
 * 7. 对比：赎回后余额 应 >= 质押前余额（因为有利息）
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
} = require("../helpers/setup");
const { advanceTime, advanceTimeSeconds, takeSnapshot, revertSnapshot } = require("../helpers/time");

async function main() {
  console.log("\n=== 质押赎回余额验证测试：质押1000U → 7天后赎回 → 检查U余额 ===\n");

  const snapshotId = await takeSnapshot();

  const deployment = loadDeployment();
  const { ae, staking, pair, usdx } = await getContracts(deployment);
  const [deployer, ...accounts] = await hre.ethers.getSigners();
  const stakingAddress = deployment.contracts.Staking;
  const rootAddress = deployment.addresses.rootAddress;
  const parseEther = hre.ethers.parseEther;
  const formatEther = hre.ethers.formatEther;

  // 使用独立的账号，避免与其他测试冲突
  // hardhat 默认只有 20 个账号 (index 0-19)，deployer 占了 [0]，accounts 从 [0] 开始对应 signers[1]
  // 选一个不与 stake-basic.test.js (14-18) 冲突的索引
  const user = accounts[12];

  const runner = new TestRunner("质押赎回余额验证");

  // 准备：给用户设置 USDX 余额并授权
  const initialBalance = parseEther("5000");
  await setUSDXBalance(user.address, initialBalance);
  await approveUSDX(usdx, user, stakingAddress, parseEther("50000"));

  // 绑定推荐人
  const isBound = await staking.isBindReferral(user.address);
  if (!isBound) {
    await staking.connect(user).lockReferral(rootAddress);
  }

  // 重置 7 天质押标记（防止之前运行的残留状态）
  if (await staking.has7DayStakeBeenUsed(user.address)) {
    await staking.connect(deployer).reset7DayStakeUsage(user.address);
  }

  // 等待近期流入窗口重置
  await advanceTimeSeconds(120);

  // =========================================================================
  // 测试：质押 1000U，7天后赎回，验证余额
  // =========================================================================
  await runner.run("R.1", "质押1000U → 7天后赎回 → 钱包U余额应不少于质押前", async () => {
    // ---- 第一步：记录质押前余额 ----
    const balanceBefore = await usdx.balanceOf(user.address);
    console.log(`\n     [质押前] 钱包 USDX 余额: ${formatEther(balanceBefore)}`);

    // ---- 第二步：质押 1000 USDX，7天档位 (stakeIndex=0) ----
    const stakeAmount = parseEther("1000");
    const tx = await staking.connect(user).stake(stakeAmount, 0);
    await tx.wait();

    const balanceAfterStake = await usdx.balanceOf(user.address);
    console.log(`     [质押后] 钱包 USDX 余额: ${formatEther(balanceAfterStake)}`);
    console.log(`     [质押后] USDX 减少: ${formatEther(balanceBefore - balanceAfterStake)}`);

    // 验证质押后余额减少了 1000
    assert(
      balanceBefore - balanceAfterStake === stakeAmount,
      `质押后 USDX 应减少 1000，实际减少 ${formatEther(balanceBefore - balanceAfterStake)}`
    );

    // 查看质押记录
    const stakeCount = Number(await staking.stakeCount(user.address));
    console.log(`     [质押后] 质押笔数: ${stakeCount}`);
    const principal = await staking.principalBalance(user.address);
    console.log(`     [质押后] 质押本金: ${formatEther(principal)}`);

    // ---- 第三步：快进 7 天 ----
    console.log(`\n     --- 快进 7 天 ---`);
    await advanceTime(7);

    // 查看赎回前的预计收益
    const earnedInterest = await staking.earnedInterest(user.address);
    const currentValue = await staking.currentStakeValue(user.address);
    console.log(`     [到期后] 预计总价值: ${formatEther(currentValue)}`);
    console.log(`     [到期后] 预计利息: ${formatEther(earnedInterest)}`);

    // ---- 第四步：赎回 ----
    const stakeIndex = stakeCount - 1; // 最新的一笔质押
    const unstakeTx = await staking.connect(user).unstake(stakeIndex);
    await unstakeTx.wait();

    // ---- 第五步：记录赎回后余额 ----
    const balanceAfterUnstake = await usdx.balanceOf(user.address);
    console.log(`\n     [赎回后] 钱包 USDX 余额: ${formatEther(balanceAfterUnstake)}`);

    // ---- 第六步：计算差值并验证 ----
    const netChange = balanceAfterUnstake - balanceBefore;
    const netChangeFromStake = balanceAfterUnstake - balanceAfterStake;

    console.log(`\n     ===== 余额对比 =====`);
    console.log(`     质押前余额:   ${formatEther(balanceBefore)}`);
    console.log(`     质押后余额:   ${formatEther(balanceAfterStake)}`);
    console.log(`     赎回后余额:   ${formatEther(balanceAfterUnstake)}`);
    console.log(`     净变化（vs质押前）: ${formatEther(netChange)} USDX`);
    console.log(`     净变化（vs质押后）: ${formatEther(netChangeFromStake)} USDX`);

    if (netChange >= 0n) {
      console.log(`     结果: 赎回后余额 >= 质押前余额 (盈利 ${formatEther(netChange)})`);
    } else {
      console.log(`     结果: 赎回后余额 < 质押前余额 (亏损 ${formatEther(-netChange)})`);
    }

    // ---- 第七步：获取提款记录，查看详细费用分配 ----
    const withdrawalHistory = await staking.getWithdrawalHistory(user.address);
    if (withdrawalHistory.length > 0) {
      const record = withdrawalHistory[withdrawalHistory.length - 1];
      console.log(`\n     ===== 提款记录详情 =====`);
      console.log(`     本金:           ${formatEther(record.principalAmount)}`);
      console.log(`     计算奖励(AE值): ${formatEther(record.calculatedReward)}`);
      console.log(`     换回USDX:       ${formatEther(record.usdxReceived)}`);
      console.log(`     利息:           ${formatEther(record.interestEarned)}`);
      console.log(`     教育基金费:     ${formatEther(record.referralFee)}`);
      console.log(`     团队奖励费:     ${formatEther(record.teamFee)}`);
      console.log(`     用户实收:       ${formatEther(record.userPayout)}`);
      console.log(`     AE消耗:         ${formatEther(record.aeTokensUsed)}`);

      // 计算隐含赎回手续费
      const impliedRedemptionFee = record.usdxReceived - record.referralFee - record.teamFee - record.userPayout;
      console.log(`     赎回手续费(推算): ${formatEther(impliedRedemptionFee)}`);

      // 检查 usdxReceived 是否 >= 本金
      console.log(`\n     ===== 关键检查 =====`);
      if (record.usdxReceived < record.principalAmount) {
        console.log(`     [问题] usdxReceived(${formatEther(record.usdxReceived)}) < 本金(${formatEther(record.principalAmount)})`);
        console.log(`     swap 换回的 USDX 不足以覆盖本金，这是导致用户亏损的原因！`);
      } else {
        console.log(`     [正常] usdxReceived(${formatEther(record.usdxReceived)}) >= 本金(${formatEther(record.principalAmount)})`);
      }
    }

    // 获取净利息统计
    const claimedNetInterest = await staking.getClaimedNetInterest(user.address);
    console.log(`\n     累计净利息: ${formatEther(claimedNetInterest)}`);

    // 核心断言：赎回后余额不应少于质押前余额
    assert(
      balanceAfterUnstake >= balanceBefore,
      `赎回后余额(${formatEther(balanceAfterUnstake)}) < 质押前余额(${formatEther(balanceBefore)})，用户亏损了 ${formatEther(-netChange)} USDX`
    );
  });

  const allPassed = runner.summary();

  // 恢复快照
  await revertSnapshot(snapshotId);

  if (!allPassed) process.exit(1);
}

main()
  .then(() => process.exit(0))
  .catch((error) => { console.error(error); process.exit(1); });
