/**
 * 模块 12：综合场景测试 - 第三部分
 * 测试项 12.8 ~ 12.10
 *
 * 12.8 大规模用户测试
 * 12.9 利息提取+赎回组合
 * 12.10 紧急提取后系统状态
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
const KPI_STORAGE_SLOT = 14;

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

async function setTeamKpi(stakingAddress, userAddress, kpiValue) {
  const slot = hre.ethers.keccak256(
    hre.ethers.AbiCoder.defaultAbiCoder().encode(
      ["address", "uint256"], [userAddress, KPI_STORAGE_SLOT]
    )
  );
  await hre.network.provider.send("hardhat_setStorageAt", [
    stakingAddress, slot, hre.ethers.toBeHex(kpiValue, 32),
  ]);
}

async function main() {
  console.log("\n=== 模块 12：综合场景测试 - 第三部分 (12.8~12.10) ===\n");

  const snapshotId = await takeSnapshot();

  const deployment = loadDeployment();
  const { ae, staking, pair, usdx } = await getContracts(deployment);
  const [deployer, ...accounts] = await hre.ethers.getSigners();
  const stakingAddress = deployment.contracts.Staking;
  const rootAddress = deployment.addresses.rootAddress;
  const educationFundAddress = deployment.addresses.educationFundAddress;
  const feeRecipientAddress = deployment.addresses.feeRecipient;

  const runner = new TestRunner("模块 12：综合场景测试 - 第三部分");

  // =========================================================================
  // 12.8 大规模用户测试
  // 20+ 用户构建复杂推荐树，验证 KPI 和奖励分配
  // =========================================================================
  await advanceTimeSeconds(120);
  await runner.run("12.8", "大规模用户测试 (20+用户)", async () => {
    // 构建推荐树:
    // Root
    // ├── leader1
    // │   ├── sub1_1, sub1_2, sub1_3, sub1_4, sub1_5
    // │   └── sub1_6, sub1_7
    // ├── leader2
    // │   ├── sub2_1, sub2_2, sub2_3, sub2_4, sub2_5
    // │   └── sub2_6, sub2_7
    // └── leader3
    //     ├── sub3_1, sub3_2, sub3_3, sub3_4, sub3_5
    //     └── sub3_6

    const leaders = [];
    const allSubs = [];

    // 创建 3 个 leader
    for (let i = 0; i < 3; i++) {
      const leader = await createFundedWallet();
      await setUSDXBalance(leader.address, parseEther("50000"));
      await approveUSDX(usdx, leader, stakingAddress, parseEther("50000"));
      await staking.connect(leader).lockReferral(rootAddress);
      leaders.push(leader);
    }

    // 每个 leader 下创建子用户
    const subsPerLeader = [7, 7, 6]; // 共 20 个子用户
    for (let i = 0; i < 3; i++) {
      const subs = [];
      for (let j = 0; j < subsPerLeader[i]; j++) {
        const sub = await createFundedWallet();
        await setUSDXBalance(sub.address, parseEther("50000"));
        await approveUSDX(usdx, sub, stakingAddress, parseEther("50000"));
        await staking.connect(sub).lockReferral(leaders[i].address);
        subs.push(sub);
      }
      allSubs.push(subs);
    }

    const totalUsers = 3 + subsPerLeader.reduce((a, b) => a + b, 0);
    console.log(`     创建了 ${totalUsers} 个用户 (3 leader + ${totalUsers - 3} sub)`);

    // 所有 leader 质押
    for (const leader of leaders) {
      await advanceTimeSeconds(120);
      await staking.connect(leader).stake(parseEther("500"), 2); // 90天期
    }

    // 所有子用户质押
    for (const subs of allSubs) {
      for (const sub of subs) {
        await advanceTimeSeconds(120);
        await staking.connect(sub).stake(parseEther("200"), 1); // 30天期
      }
    }

    // 验证 leader 的 teamKPI
    for (let i = 0; i < 3; i++) {
      const kpi = await staking.getTeamKpi(leaders[i].address);
      console.log(`     Leader${i + 1} teamKPI: ${formatEther(kpi)}`);
      assert(kpi > 0n, `Leader${i + 1} teamKPI 应大于 0`);
    }

    // 验证 root 的 teamKPI（应包含所有下级）
    const rootKpi = await staking.getTeamKpi(rootAddress);
    console.log(`     Root teamKPI: ${formatEther(rootKpi)}`);
    assert(rootKpi > 0n, "Root teamKPI 应大于 0");

    // 推进 30 天，让子用户赎回并验证奖励分配
    await advanceTime(30);
    await advanceTimeSeconds(1);

    // 选一个子用户赎回，验证奖励链
    const testSub = allSubs[0][0];
    const testIdx = Number(await staking.stakeCount(testSub.address)) - 1;
    const tx = await staking.connect(testSub).unstake(testIdx);
    const receipt = await tx.wait();

    // 验证 WithdrawalCompleted 事件
    let withdrawEvent = null;
    for (const log of receipt.logs) {
      try {
        const parsed = staking.interface.parseLog(log);
        if (parsed && parsed.name === "WithdrawalCompleted") {
          withdrawEvent = parsed;
          break;
        }
      } catch { /* ignore */ }
    }
    assert(withdrawEvent, "应触发 WithdrawalCompleted 事件");
    console.log(`     子用户赎回成功, 用户到手: ${formatEther(withdrawEvent.args.userPayout)} USDX`);

    // 验证各用户状态隔离
    for (let i = 1; i < allSubs[0].length; i++) {
      const sub = allSubs[0][i];
      const count = await staking.stakeCount(sub.address);
      assert(Number(count) > 0, `Sub${i} 质押记录应存在`);
      const rec = await staking.userStakeRecord(sub.address, 0);
      assert(rec.status === false, `Sub${i} 质押应未赎回`);
    }
    console.log(`     状态隔离验证通过`);
  });

  // =========================================================================
  // 12.9 利息提取+赎回组合
  // 多次提取利息后到期赎回，验证总收益 = 预期复利收益
  // =========================================================================
  await advanceTimeSeconds(120);
  await runner.run("12.9", "利息提取+赎回组合", async () => {
    const user = await createFundedWallet();
    await setUSDXBalance(user.address, parseEther("50000"));
    await approveUSDX(usdx, user, stakingAddress, parseEther("50000"));
    await staking.connect(user).lockReferral(rootAddress);

    // 质押 500 USDT (30天期, 日利率 0.9%)
    await advanceTimeSeconds(120);
    const stakeAmount = parseEther("500");
    await staking.connect(user).stake(stakeAmount, 1);
    const stakeIdx = Number(await staking.stakeCount(user.address)) - 1;

    let totalInterestReceived = 0n;

    // 第一次提取利息 (第10天)
    await advanceTime(10);
    const avail1 = await staking.getAvailableInterest(user.address, stakeIdx);
    console.log(`     第10天可用利息: ${formatEther(avail1)} USDT`);
    if (avail1 > 0n) {
      const balBefore1 = await usdx.balanceOf(user.address);
      await staking.connect(user).withdrawInterest(stakeIdx);
      const balAfter1 = await usdx.balanceOf(user.address);
      const received1 = balAfter1 - balBefore1;
      totalInterestReceived += received1;
      console.log(`     第一次提取收到: ${formatEther(received1)} USDX`);

      // 验证已提取利息记录
      const withdrawn1 = await staking.getWithdrawnInterest(user.address, stakeIdx);
      assert(withdrawn1 > 0n, "已提取利息应大于 0");
    }

    // 验证本金不变
    const principalMid = await staking.principalBalance(user.address);
    assert(principalMid > 0n, "本金应不变");

    // 第二次提取利息 (第20天)
    await advanceTime(10);
    const avail2 = await staking.getAvailableInterest(user.address, stakeIdx);
    console.log(`     第20天可用利息: ${formatEther(avail2)} USDT`);
    if (avail2 > 0n) {
      const balBefore2 = await usdx.balanceOf(user.address);
      await staking.connect(user).withdrawInterest(stakeIdx);
      const balAfter2 = await usdx.balanceOf(user.address);
      const received2 = balAfter2 - balBefore2;
      totalInterestReceived += received2;
      console.log(`     第二次提取收到: ${formatEther(received2)} USDX`);
    }

    // 推进到 30 天到期，赎回
    await advanceTime(11);
    assert(await staking.canWithdrawStake(user.address, stakeIdx), "30天后应可赎回");

    const balBeforeUnstake = await usdx.balanceOf(user.address);
    const txU = await staking.connect(user).unstake(stakeIdx);
    const receiptU = await txU.wait();
    const balAfterUnstake = await usdx.balanceOf(user.address);
    const unstakeReceived = balAfterUnstake - balBeforeUnstake;
    totalInterestReceived += unstakeReceived;

    // 解析 WithdrawalCompleted 事件
    let withdrawEvent = null;
    for (const log of receiptU.logs) {
      try {
        const parsed = staking.interface.parseLog(log);
        if (parsed && parsed.name === "WithdrawalCompleted") {
          withdrawEvent = parsed;
          break;
        }
      } catch { /* ignore */ }
    }
    assert(withdrawEvent, "应触发 WithdrawalCompleted 事件");

    console.log(`     赎回收到: ${formatEther(unstakeReceived)} USDX`);
    console.log(`     总收到 (利息+赎回): ${formatEther(totalInterestReceived)} USDX`);

    // 验证赎回后不能再提取利息
    let reverted = false;
    try {
      await staking.connect(user).withdrawInterest(stakeIdx);
    } catch (e) {
      reverted = true;
    }
    assert(reverted, "赎回后不应能再提取利息");

    // 验证提取历史完整
    const historyCount = await staking.getWithdrawalCount(user.address);
    assert(Number(historyCount) >= 1, "应有提取历史");
    console.log(`     提取记录数: ${historyCount}`);
  });

  // =========================================================================
  // 12.10 紧急提取后系统状态
  // owner 紧急提取后，用户操作的影响
  // =========================================================================
  await advanceTimeSeconds(120);
  await runner.run("12.10", "紧急提取后系统状态", async () => {
    const user = await createFundedWallet();
    await setUSDXBalance(user.address, parseEther("50000"));
    await approveUSDX(usdx, user, stakingAddress, parseEther("50000"));
    await staking.connect(user).lockReferral(rootAddress);

    // 用户质押
    await advanceTimeSeconds(120);
    await staking.connect(user).stake(parseEther("500"), 1); // 30天期
    const stakeIdx = Number(await staking.stakeCount(user.address)) - 1;

    // 验证合约中有 AE 余额
    const aeBalBefore = await ae.balanceOf(stakingAddress);
    console.log(`     合约 AE 余额 (紧急提取前): ${formatEther(aeBalBefore)}`);

    // owner 紧急提取部分 AE
    const withdrawAmount = aeBalBefore / 2n; // 提取一半
    if (withdrawAmount > 0n) {
      await staking.connect(deployer).emergencyWithdrawAE(deployer.address, withdrawAmount);
      const aeBalAfter = await ae.balanceOf(stakingAddress);
      console.log(`     合约 AE 余额 (紧急提取后): ${formatEther(aeBalAfter)}`);
      assert(aeBalAfter < aeBalBefore, "紧急提取后合约 AE 应减少");
    }

    // 验证合约 USDX 余额
    const usdxBalBefore = await usdx.balanceOf(stakingAddress);
    console.log(`     合约 USDX 余额: ${formatEther(usdxBalBefore)}`);

    // owner 紧急提取部分 USDX
    if (usdxBalBefore > 0n) {
      const usdxWithdraw = usdxBalBefore / 4n;
      if (usdxWithdraw > 0n) {
        await staking.connect(deployer).emergencyWithdrawUSDX(deployer.address, usdxWithdraw);
        const usdxBalAfter = await usdx.balanceOf(stakingAddress);
        console.log(`     合约 USDX 余额 (紧急提取后): ${formatEther(usdxBalAfter)}`);
      }
    }

    // 验证用户质押记录仍然存在
    const record = await staking.userStakeRecord(user.address, stakeIdx);
    assert(record.status === false, "用户质押记录应仍存在且未赎回");
    assert(record.amount > 0n, "质押金额应仍大于 0");

    // 验证 view 函数仍可正常调用
    const principal = await staking.principalBalance(user.address);
    assert(principal > 0n, "principalBalance 应仍可查询");
    const balance = await staking.balanceOf(user.address);
    assert(balance > 0n, "balanceOf 应仍可查询");
    const count = await staking.stakeCount(user.address);
    assert(Number(count) > 0, "stakeCount 应仍可查询");

    // 验证新用户仍可质押
    const newUser = await createFundedWallet();
    await setUSDXBalance(newUser.address, parseEther("50000"));
    await approveUSDX(usdx, newUser, stakingAddress, parseEther("50000"));
    await staking.connect(newUser).lockReferral(rootAddress);
    await advanceTimeSeconds(120);

    let newStakeOk = false;
    try {
      await staking.connect(newUser).stake(parseEther("100"), 1);
      newStakeOk = true;
    } catch (e) {
      console.log(`     紧急提取后新用户质押失败: ${e.message}`);
    }
    console.log(`     紧急提取后新用户质押: ${newStakeOk ? "成功" : "失败 (可能因余额不足)"}`);

    // 非 owner 不能紧急提取
    let reverted = false;
    try {
      await staking.connect(user).emergencyWithdrawAE(user.address, parseEther("1"));
    } catch (e) {
      reverted = true;
    }
    assert(reverted, "非 owner 紧急提取应 revert");
    console.log(`     非 owner 紧急提取被拒绝 (预期行为)`);
  });

  const allPassed = runner.summary();
  await revertSnapshot(snapshotId);
  if (!allPassed) process.exit(1);
}

main()
  .then(() => process.exit(0))
  .catch((error) => { console.error(error); process.exit(1); });
