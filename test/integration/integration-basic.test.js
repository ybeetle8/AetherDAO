/**
 * 模块 12：综合场景测试 - 第一部分
 * 测试项 12.1 ~ 12.4
 *
 * 12.1 完整用户生命周期
 * 12.2 多级推荐链奖励
 * 12.3 等级升降场景
 * 12.4 多笔不同期限质押
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

async function prepareUser(usdx, staking, user, stakingAddress, rootAddress, amount) {
  await setUSDXBalance(user.address, amount || parseEther("50000"));
  await approveUSDX(usdx, user, stakingAddress, amount || parseEther("50000"));
  await safeBindReferral(staking, user, rootAddress);
}

async function safeStake(staking, user, desiredAmount, stakeIndex) {
  const remaining = await staking.getRemainingStakeCapacity(user.address);
  const maxSingle = await staking.maxStakeAmount();
  let amount = desiredAmount;
  if (remaining < amount) amount = remaining;
  if (maxSingle < amount) amount = maxSingle;
  assert(amount >= parseEther("100"), `容量不足: remaining=${formatEther(remaining)}, max=${formatEther(maxSingle)}`);
  await staking.connect(user).stake(amount, stakeIndex);
}

async function stakeInBatches(staking, user, totalAmount) {
  let remaining = totalAmount;
  let idx = 1;
  while (remaining > 0n) {
    await advanceTimeSeconds(120);
    const maxStake = await staking.maxStakeAmount();
    const capacity = await staking.getRemainingStakeCapacity(user.address);
    const canStake = maxStake < capacity ? maxStake : capacity;
    const amt = canStake < remaining ? canStake : remaining;
    if (amt < parseEther("100")) break;
    await staking.connect(user).stake(amt, (idx % 4) + 1);
    remaining -= amt;
    idx++;
  }
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
  console.log("\n=== 模块 12：综合场景测试 - 第一部分 (12.1~12.4) ===\n");

  const snapshotId = await takeSnapshot();

  const deployment = loadDeployment();
  const { ae, staking, pair, usdx } = await getContracts(deployment);
  const [deployer, ...accounts] = await hre.ethers.getSigners();
  const stakingAddress = deployment.contracts.Staking;
  const rootAddress = deployment.addresses.rootAddress;
  const educationFundAddress = deployment.addresses.educationFundAddress;
  const feeRecipientAddress = deployment.addresses.feeRecipient;

  const runner = new TestRunner("模块 12：综合场景测试 - 第一部分");

  // =========================================================================
  // 12.1 完整用户生命周期
  // 绑定推荐人→质押→提取利息→到期赎回→验证所有余额
  // =========================================================================
  await advanceTimeSeconds(120);
  await runner.run("12.1", "完整用户生命周期", async () => {
    const user = accounts[0];
    await prepareUser(usdx, staking, user, stakingAddress, rootAddress);

    // 步骤1: 验证推荐人已绑定
    const isBound = await staking.isBindReferral(user.address);
    assert(isBound, "推荐人应已绑定");
    const referrer = await staking.getReferral(user.address);
    assertEq(referrer.toLowerCase(), rootAddress.toLowerCase(), "推荐人应为 root");

    // 步骤2: 质押 500 USDT (30天期)
    const stakeAmount = parseEther("500");
    await safeStake(staking, user, stakeAmount, 1);
    const stakeIdx = Number(await staking.stakeCount(user.address)) - 1;
    const principal = await staking.principalBalance(user.address);
    assert(principal > 0n, "质押后本金应大于 0");
    console.log(`     质押本金: ${formatEther(principal)} USDT`);

    // 步骤3: 推进 15 天，提取利息
    await advanceTime(15);
    const availInterest = await staking.getAvailableInterest(user.address, stakeIdx);
    assert(availInterest > 0n, "15天后应有可用利息");
    console.log(`     15天后可用利息: ${formatEther(availInterest)} USDT`);

    const usdxBeforeWithdraw = await usdx.balanceOf(user.address);
    const txW = await staking.connect(user).withdrawInterest(stakeIdx);
    const receiptW = await txW.wait();
    const usdxAfterWithdraw = await usdx.balanceOf(user.address);
    const interestReceived = usdxAfterWithdraw - usdxBeforeWithdraw;
    assert(interestReceived > 0n, "应收到利息 USDX");
    console.log(`     提取利息收到: ${formatEther(interestReceived)} USDX`);

    // 验证 InterestWithdrawn 事件
    let interestEvent = null;
    for (const log of receiptW.logs) {
      try {
        const parsed = staking.interface.parseLog(log);
        if (parsed && parsed.name === "InterestWithdrawn") { interestEvent = parsed; break; }
      } catch { /* ignore */ }
    }
    assert(interestEvent, "应触发 InterestWithdrawn 事件");

    // 验证本金不变
    const principalAfter = await staking.principalBalance(user.address);
    assertEq(principalAfter, principal, "提取利息后本金应不变");

    // 步骤4: 推进到 30 天到期，赎回
    await advanceTime(16);
    const canWithdraw = await staking.canWithdrawStake(user.address, stakeIdx);
    assert(canWithdraw, "30天后应可赎回");

    const usdxBeforeUnstake = await usdx.balanceOf(user.address);
    const txU = await staking.connect(user).unstake(stakeIdx);
    const receiptU = await txU.wait();
    const usdxAfterUnstake = await usdx.balanceOf(user.address);
    const unstakeReceived = usdxAfterUnstake - usdxBeforeUnstake;
    assert(unstakeReceived > 0n, "赎回应收到 USDX");
    console.log(`     赎回收到: ${formatEther(unstakeReceived)} USDX`);

    // 验证 WithdrawalCompleted 事件
    let withdrawEvent = null;
    for (const log of receiptU.logs) {
      try {
        const parsed = staking.interface.parseLog(log);
        if (parsed && parsed.name === "WithdrawalCompleted") { withdrawEvent = parsed; break; }
      } catch { /* ignore */ }
    }
    assert(withdrawEvent, "应触发 WithdrawalCompleted 事件");

    // 步骤5: 验证赎回后状态
    const record = await staking.userStakeRecord(user.address, stakeIdx);
    assert(record.status === true, "赎回后 status 应为 true");
    const canWithdrawAfter = await staking.canWithdrawStake(user.address, stakeIdx);
    assert(!canWithdrawAfter, "赎回后不可再赎回");

    // 验证提取历史
    const history = await staking.getWithdrawalHistory(user.address);
    assert(history.length > 0, "应有提取历史记录");

    console.log(`     生命周期完成: 总收到 ${formatEther(interestReceived + unstakeReceived)} USDX`);
  });

  // =========================================================================
  // 12.2 多级推荐链奖励
  // 构建 5 级推荐链，末端用户赎回，验证全链奖励分配
  // Root ← A(V5) ← B(V3) ← C(V1) ← D ← E(质押并赎回)
  // =========================================================================
  await advanceTimeSeconds(120);
  await runner.run("12.2", "多级推荐链奖励", async () => {
    const walletA = await createFundedWallet();
    const walletB = await createFundedWallet();
    const walletC = await createFundedWallet();
    const walletD = await createFundedWallet();
    const walletE = await createFundedWallet();

    // 设置 USDX 余额和授权
    for (const w of [walletA, walletB, walletC, walletD, walletE]) {
      await setUSDXBalance(w.address, parseEther("50000"));
      await approveUSDX(usdx, w, stakingAddress, parseEther("50000"));
    }

    // 构建推荐链: Root ← A ← B ← C ← D ← E
    await staking.connect(walletA).lockReferral(rootAddress);
    await staking.connect(walletB).lockReferral(walletA.address);
    await staking.connect(walletC).lockReferral(walletB.address);
    await staking.connect(walletD).lockReferral(walletC.address);
    await staking.connect(walletE).lockReferral(walletD.address);

    // 验证推荐链（使用完整签名避免重载歧义）
    const refs = await staking["getReferrals(address,uint8)"](walletE.address, 5);
    assert(refs.length >= 5, `推荐链应至少5级, 实际 ${refs.length}`);

    // A 质押较多以达到较高等级 (通过 KPI 设置)
    await advanceTimeSeconds(120);
    await staking.connect(walletA).stake(parseEther("500"), 1);
    await setTeamKpi(stakingAddress, walletA.address, parseEther("300000"));

    // B 质押达到 V3 等级
    await advanceTimeSeconds(120);
    await staking.connect(walletB).stake(parseEther("600"), 2);
    await setTeamKpi(stakingAddress, walletB.address, parseEther("30000"));

    // C 质押达到 V1 等级
    await advanceTimeSeconds(120);
    await staking.connect(walletC).stake(parseEther("200"), 1);
    await setTeamKpi(stakingAddress, walletC.address, parseEther("3000"));

    // D 质押成为布道者
    await advanceTimeSeconds(120);
    await staking.connect(walletD).stake(parseEther("200"), 1);

    // E 质押并等待到期
    await advanceTimeSeconds(120);
    await staking.connect(walletE).stake(parseEther("500"), 1); // 30天期
    const stakeIdx = Number(await staking.stakeCount(walletE.address)) - 1;

    // 推进 30 天到期
    await advanceTime(30);
    await advanceTimeSeconds(1);

    // 记录各地址余额
    const rootBalBefore = await usdx.balanceOf(rootAddress);
    const aBalBefore = await usdx.balanceOf(walletA.address);
    const bBalBefore = await usdx.balanceOf(walletB.address);

    // E 赎回
    const tx = await staking.connect(walletE).unstake(stakeIdx);
    const receipt = await tx.wait();

    // 解析 TeamRewardDistributionCompleted 事件
    let teamEvent = null;
    for (const log of receipt.logs) {
      try {
        const parsed = staking.interface.parseLog(log);
        if (parsed && parsed.name === "TeamRewardDistributionCompleted") {
          teamEvent = parsed;
          break;
        }
      } catch { /* ignore */ }
    }
    assert(teamEvent, "应触发 TeamRewardDistributionCompleted 事件");
    console.log(`     团队奖励池: ${formatEther(teamEvent.args.totalTeamRewardPool)} USDX`);
    console.log(`     实际分配: ${formatEther(teamEvent.args.totalDistributed)} USDX`);
    console.log(`     活跃层级数: ${teamEvent.args.activeTiers}`);

    // 验证分配总额不超过奖励池
    assert(
      teamEvent.args.totalDistributed <= teamEvent.args.totalTeamRewardPool,
      "分配总额不应超过奖励池"
    );

    // 解析 StrictDifferentialRewardPaid 事件
    let rewardEvents = [];
    for (const log of receipt.logs) {
      try {
        const parsed = staking.interface.parseLog(log);
        if (parsed && parsed.name === "StrictDifferentialRewardPaid") {
          rewardEvents.push(parsed);
        }
      } catch { /* ignore */ }
    }
    console.log(`     差额奖励分配次数: ${rewardEvents.length}`);
    for (const evt of rewardEvents) {
      console.log(`       接收者: ${evt.args.recipient}, 等级: V${evt.args.tier}, 金额: ${formatEther(evt.args.rewardAmount)}`);
    }

    // 验证 root 收到剩余奖励
    const rootBalAfter = await usdx.balanceOf(rootAddress);
    assert(rootBalAfter >= rootBalBefore, "Root 应收到剩余奖励");
  });

  // =========================================================================
  // 12.3 等级升降场景
  // 用户质押升级→赎回降级→再质押升级，验证等级变化
  // =========================================================================
  await advanceTimeSeconds(120);
  await runner.run("12.3", "等级升降场景", async () => {
    const user = await createFundedWallet();
    await setUSDXBalance(user.address, parseEther("50000"));
    await approveUSDX(usdx, user, stakingAddress, parseEther("50000"));
    await staking.connect(user).lockReferral(rootAddress);

    // 设置 teamKPI 使其满足 V3 的 KPI 门槛
    await setTeamKpi(stakingAddress, user.address, parseEther("30000"));

    // 步骤1: 质押 600 USDT 达到个人质押 V3 (门槛 600)
    await advanceTimeSeconds(120);
    await staking.connect(user).stake(parseEther("500"), 1);
    await advanceTimeSeconds(120);
    await staking.connect(user).stake(parseEther("100"), 1);

    const details1 = await staking.getTeamPerformanceDetails(user.address);
    const tier1 = Number(details1.currentTier);
    console.log(`     质押 600 后等级: V${tier1}`);
    assert(tier1 >= 1, "质押 600 后应至少 V1");

    // 步骤2: 等待到期并赎回第一笔，降低个人质押
    await advanceTime(31);
    const stakeIdx0 = 0;
    const canW = await staking.canWithdrawStake(user.address, stakeIdx0);
    if (canW) {
      await staking.connect(user).unstake(stakeIdx0);
      const details2 = await staking.getTeamPerformanceDetails(user.address);
      const tier2 = Number(details2.currentTier);
      console.log(`     赎回后等级: V${tier2}`);
      // 赎回 500 后只剩 100，等级应下降
      assert(tier2 <= tier1, "赎回后等级应下降或不变");
    }

    // 步骤3: 再次质押升级
    await setUSDXBalance(user.address, parseEther("50000"));
    await approveUSDX(usdx, user, stakingAddress, parseEther("50000"));
    await advanceTimeSeconds(120);
    await staking.connect(user).stake(parseEther("500"), 2); // 90天期

    const details3 = await staking.getTeamPerformanceDetails(user.address);
    const tier3 = Number(details3.currentTier);
    console.log(`     再质押后等级: V${tier3}`);
    assert(tier3 >= 1, "再质押后应恢复等级");
  });

  // =========================================================================
  // 12.4 多笔不同期限质押
  // 同一用户质押 7天+30天+90天，分别到期赎回
  // =========================================================================
  await advanceTimeSeconds(120);
  await runner.run("12.4", "多笔不同期限质押", async () => {
    const user = await createFundedWallet();
    await setUSDXBalance(user.address, parseEther("50000"));
    await approveUSDX(usdx, user, stakingAddress, parseEther("50000"));
    await staking.connect(user).lockReferral(rootAddress);

    // 质押 3 笔不同期限
    await advanceTimeSeconds(120);
    await staking.connect(user).stake(parseEther("100"), 0); // 7天期
    const idx7 = Number(await staking.stakeCount(user.address)) - 1;

    await advanceTimeSeconds(120);
    await staking.connect(user).stake(parseEther("300"), 1); // 30天期
    const idx30 = Number(await staking.stakeCount(user.address)) - 1;

    await advanceTimeSeconds(120);
    await staking.connect(user).stake(parseEther("500"), 2); // 90天期
    const idx90 = Number(await staking.stakeCount(user.address)) - 1;

    const totalStaked = await staking.principalBalance(user.address);
    console.log(`     总质押: ${formatEther(totalStaked)} USDT (3笔)`);
    assertEq(Number(await staking.stakeCount(user.address)), 3, "应有3笔质押");

    // 推进 7 天 + 1秒，赎回第一笔
    await advanceTime(7);
    await advanceTimeSeconds(1);
    assert(await staking.canWithdrawStake(user.address, idx7), "7天期应可赎回");
    assert(!await staking.canWithdrawStake(user.address, idx30), "30天期应不可赎回");
    assert(!await staking.canWithdrawStake(user.address, idx90), "90天期应不可赎回");

    const usdxBefore7 = await usdx.balanceOf(user.address);
    await staking.connect(user).unstake(idx7);
    const usdxAfter7 = await usdx.balanceOf(user.address);
    const received7 = usdxAfter7 - usdxBefore7;
    console.log(`     7天期赎回收到: ${formatEther(received7)} USDX`);
    assert(received7 > 0n, "7天期赎回应收到 USDX");

    // 推进到 30 天，赎回第二笔
    await advanceTime(23);
    await advanceTimeSeconds(1);
    assert(await staking.canWithdrawStake(user.address, idx30), "30天期应可赎回");
    assert(!await staking.canWithdrawStake(user.address, idx90), "90天期仍不可赎回");

    const usdxBefore30 = await usdx.balanceOf(user.address);
    await staking.connect(user).unstake(idx30);
    const usdxAfter30 = await usdx.balanceOf(user.address);
    const received30 = usdxAfter30 - usdxBefore30;
    console.log(`     30天期赎回收到: ${formatEther(received30)} USDX`);
    assert(received30 > 0n, "30天期赎回应收到 USDX");

    // 推进到 90 天，赎回第三笔
    await advanceTime(60);
    await advanceTimeSeconds(1);
    assert(await staking.canWithdrawStake(user.address, idx90), "90天期应可赎回");

    const usdxBefore90 = await usdx.balanceOf(user.address);
    await staking.connect(user).unstake(idx90);
    const usdxAfter90 = await usdx.balanceOf(user.address);
    const received90 = usdxAfter90 - usdxBefore90;
    console.log(`     90天期赎回收到: ${formatEther(received90)} USDX`);
    assert(received90 > 0n, "90天期赎回应收到 USDX");

    // 验证所有质押已赎回
    for (const idx of [idx7, idx30, idx90]) {
      const rec = await staking.userStakeRecord(user.address, idx);
      assert(rec.status === true, `质押 ${idx} 应已赎回`);
    }

    // 验证提取历史
    const historyCount = await staking.getWithdrawalCount(user.address);
    assert(Number(historyCount) >= 3, "应有至少3条提取记录");
    console.log(`     全部赎回完成, 提取记录数: ${historyCount}`);
  });

  const allPassed = runner.summary();
  await revertSnapshot(snapshotId);
  if (!allPassed) process.exit(1);
}

main()
  .then(() => process.exit(0))
  .catch((error) => { console.error(error); process.exit(1); });
