/**
 * C-01 / M-02 修复验证：tierAllocated 数组越界 + tierRecipients/tierAmounts/activeTiers 扩容
 *
 * 测试目标：
 *   TB-1  V8 用户在推荐链上时 unstake 不 revert
 *   TB-2  V9 用户在推荐链上时 unstake 不 revert
 *   TB-3  V8/V9 用户正确获得差额团队奖励
 *   TB-4  activeTiers 位图正确标记 V8/V9
 *   TB-5  合约 AE / USDX 余额查询
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

async function prepareUser(usdx, user, stakingAddress, amount) {
  await setUSDXBalance(user.address, amount);
  await approveUSDX(usdx, user, stakingAddress, amount);
}

async function stakeAmount(staking, user, totalAmount, stakeIndex) {
  let remaining = totalAmount;
  const idx = stakeIndex !== undefined ? stakeIndex : 1;
  while (remaining > 0n) {
    await advanceTimeSeconds(120);
    const maxStake = await staking.maxStakeAmount();
    const capacity = await staking.getRemainingStakeCapacity(user.address);
    const canStake = maxStake < capacity ? maxStake : capacity;
    const amt = canStake < remaining ? canStake : remaining;
    if (amt < parseEther("100")) break;
    await staking.connect(user).stake(amt, idx);
    remaining -= amt;
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

/**
 * 构建指定等级的用户。
 * V1-V7: 直接质押足够金额即可达到 personalStake 门槛。
 * V8/V9: MAX_USER_TOTAL_STAKE=10000, 但 V8 需要 currentStakeValue>=15000, V9>=20000。
 *   策略: 质押 10000 到最高 APY 档位 (stakeIndex=4, 2%日复利), 然后 advanceTime 等复利增长。
 *   10000 * 1.02^21 ≈ 15157 (V8), 10000 * 1.02^36 ≈ 20399 (V9)
 */
async function buildUserTier(staking, usdx, user, tier, stakingAddress) {
  const personalThresholds = [
    0n, parseEther("100"), parseEther("300"), parseEther("600"),
    parseEther("1000"), parseEther("3000"), parseEther("6000"), parseEther("10000"),
    parseEther("15000"), parseEther("20000"),
  ];
  const kpiThresholds = [
    0n, parseEther("3000"), parseEther("10000"), parseEther("30000"),
    parseEther("100000"), parseEther("300000"), parseEther("1000000"), parseEther("3000000"),
    parseEther("10000000"), parseEther("30000000"),
  ];

  const personalNeeded = personalThresholds[tier];
  const currentStake = await staking.currentStakeValue(user.address);

  if (currentStake < personalNeeded) {
    if (tier >= 8) {
      // V8/V9: 先质押满 10000 (最高 APY), 再用时间让复利增长
      const maxPrincipal = parseEther("10000");
      const currentPrincipal = await staking.principalBalance(user.address);
      if (currentPrincipal < maxPrincipal) {
        const diff = maxPrincipal - currentPrincipal;
        await prepareUser(usdx, user, stakingAddress, diff + parseEther("2000"));
        // stakeIndex=4 → 365D, 2% daily compound
        await stakeAmount(staking, user, diff, 4);
      }
      // 用 advanceTime 等复利增长到目标值
      // V8: ~22 天, V9: ~37 天 (多留余量)
      const daysNeeded = tier === 8 ? 22 : 37;
      await advanceTime(daysNeeded);
      const newStake = await staking.currentStakeValue(user.address);
      console.log(`     buildUserTier: V${tier} currentStakeValue=${formatEther(newStake)} (需要>=${formatEther(personalNeeded)})`);
    } else {
      const diff = personalNeeded - currentStake;
      await prepareUser(usdx, user, stakingAddress, diff + parseEther("2000"));
      await stakeAmount(staking, user, diff);
    }
  }

  await setTeamKpi(stakingAddress, user.address, kpiThresholds[tier]);
}

function printBalances(label, aeBalance, usdxBalance) {
  console.log(`     ${label}`);
  console.log(`       AE  余额: ${formatEther(aeBalance)}`);
  console.log(`       USDX 余额: ${formatEther(usdxBalance)}`);
}

async function main() {
  console.log("\n=== C-01/M-02 修复验证：Tier 数组越界修复 ===\n");

  const deployment = loadDeployment();
  const { ae, staking, usdx } = await getContracts(deployment);
  const [deployer] = await hre.ethers.getSigners();
  const stakingAddress = deployment.contracts.Staking;
  const rootAddress = deployment.addresses.rootAddress;
  const runner = new TestRunner("C-01/M-02 Tier 数组越界修复");

  // 先打印合约当前余额
  const aeBalInit = await ae.balanceOf(stakingAddress);
  const usdxBalInit = await usdx.balanceOf(stakingAddress);
  printBalances("合约初始余额:", aeBalInit, usdxBalInit);
  console.log("");

  // TB-1: V8 用户在推荐链上时 unstake 不 revert
  await runner.run("TB-1", "V8 用户在推荐链上时 unstake 不 revert", async () => {
    const snap = await takeSnapshot();
    try {
      const userV8 = await createFundedWallet();
      const staker = await createFundedWallet();

      await safeBindReferral(staking, userV8, rootAddress);
      await safeBindReferral(staking, staker, userV8.address);

      await buildUserTier(staking, usdx, userV8, 8, stakingAddress);

      const tierInfo = await staking.getTeamPerformanceDetails(userV8.address);
      console.log(`     userV8 tier: V${tierInfo.currentTier}`);
      assert(Number(tierInfo.currentTier) >= 8, `应为 V8+, 实际 V${tierInfo.currentTier}`);

      await prepareUser(usdx, staker, stakingAddress, parseEther("5000"));
      await advanceTimeSeconds(120);
      await staking.connect(staker).stake(parseEther("500"), 0);

      await advanceTime(8);
      // 修复前此处会因 tierAllocated[8] 越界 revert
      await staking.connect(staker).unstake(0);
      console.log("     unstake 成功, 未 revert");
    } finally {
      await revertSnapshot(snap);
    }
  });

  // TB-2: V9 用户在推荐链上时 unstake 不 revert
  await runner.run("TB-2", "V9 用户在推荐链上时 unstake 不 revert", async () => {
    const snap = await takeSnapshot();
    try {
      const userV9 = await createFundedWallet();
      const staker = await createFundedWallet();

      await safeBindReferral(staking, userV9, rootAddress);
      await safeBindReferral(staking, staker, userV9.address);

      await buildUserTier(staking, usdx, userV9, 9, stakingAddress);

      const tierInfo = await staking.getTeamPerformanceDetails(userV9.address);
      console.log(`     userV9 tier: V${tierInfo.currentTier}`);
      assert(Number(tierInfo.currentTier) >= 9, `应为 V9+, 实际 V${tierInfo.currentTier}`);

      await prepareUser(usdx, staker, stakingAddress, parseEther("5000"));
      await advanceTimeSeconds(120);
      await staking.connect(staker).stake(parseEther("500"), 0);

      await advanceTime(8);
      // 修复前此处会因 tierAllocated[9] 和 tierRecipients[8] 越界 revert
      await staking.connect(staker).unstake(0);
      console.log("     unstake 成功, 未 revert");
    } finally {
      await revertSnapshot(snap);
    }
  });

  // TB-3: V8/V9 用户正确获得差额团队奖励
  await runner.run("TB-3", "V8/V9 差额团队奖励正确分配", async () => {
    const snap = await takeSnapshot();
    try {
      const userV9 = await createFundedWallet();
      const userV8 = await createFundedWallet();
      const userV5 = await createFundedWallet();
      const staker = await createFundedWallet();

      // 推荐链: staker → userV5 → userV8 → userV9 → root
      await safeBindReferral(staking, userV9, rootAddress);
      await safeBindReferral(staking, userV8, userV9.address);
      await safeBindReferral(staking, userV5, userV8.address);
      await safeBindReferral(staking, staker, userV5.address);

      await buildUserTier(staking, usdx, userV5, 5, stakingAddress);
      await buildUserTier(staking, usdx, userV8, 8, stakingAddress);
      await buildUserTier(staking, usdx, userV9, 9, stakingAddress);

      const t5 = await staking.getTeamPerformanceDetails(userV5.address);
      const t8 = await staking.getTeamPerformanceDetails(userV8.address);
      const t9 = await staking.getTeamPerformanceDetails(userV9.address);
      console.log(`     V5=${t5.currentTier}, V8=${t8.currentTier}, V9=${t9.currentTier}`);

      await prepareUser(usdx, staker, stakingAddress, parseEther("5000"));
      await advanceTimeSeconds(120);
      await staking.connect(staker).stake(parseEther("500"), 0);

      const balV5 = await usdx.balanceOf(userV5.address);
      const balV8 = await usdx.balanceOf(userV8.address);
      const balV9 = await usdx.balanceOf(userV9.address);
      const balRoot = await usdx.balanceOf(rootAddress);

      await advanceTime(8);
      await staking.connect(staker).unstake(0);

      const rV5 = (await usdx.balanceOf(userV5.address)) - balV5;
      const rV8 = (await usdx.balanceOf(userV8.address)) - balV8;
      const rV9 = (await usdx.balanceOf(userV9.address)) - balV9;
      const rRoot = (await usdx.balanceOf(rootAddress)) - balRoot;

      // V5: 19%, V8: 31%-19%=12%, V9: 35%-31%=4%, Root: 剩余
      console.log(`     V5(19%): ${formatEther(rV5)}, V8(12%差额): ${formatEther(rV8)}, V9(4%差额): ${formatEther(rV9)}, Root: ${formatEther(rRoot)}`);

      assert(rV5 > 0n, "V5 应获得奖励");
      assert(rV8 > 0n, "V8 应获得差额奖励");
      assert(rV9 > 0n, "V9 应获得差额奖励");
      // V5 获得 19%, V8 获得 12% 差额, 所以 V5 > V8
      assert(rV5 > rV8, `V5(19%) 应 > V8(12%差额), 实际 V5=${formatEther(rV5)}, V8=${formatEther(rV8)}`);
      // V8 获得 12%, V9 获得 4% 差额, 所以 V8 > V9
      assert(rV8 > rV9, `V8(12%差额) 应 > V9(4%差额), 实际 V8=${formatEther(rV8)}, V9=${formatEther(rV9)}`);
    } finally {
      await revertSnapshot(snap);
    }
  });

  // TB-4: activeTiers 位图正确标记 V8/V9 (通过事件验证)
  await runner.run("TB-4", "TeamRewardDistributionCompleted 事件中 activeTiers 位图正确", async () => {
    const snap = await takeSnapshot();
    try {
      const userV8 = await createFundedWallet();
      const staker = await createFundedWallet();

      await safeBindReferral(staking, userV8, rootAddress);
      await safeBindReferral(staking, staker, userV8.address);

      await buildUserTier(staking, usdx, userV8, 8, stakingAddress);

      await prepareUser(usdx, staker, stakingAddress, parseEther("5000"));
      await advanceTimeSeconds(120);
      await staking.connect(staker).stake(parseEther("500"), 0);

      await advanceTime(8);
      const tx = await staking.connect(staker).unstake(0);
      const receipt = await tx.wait();

      // 查找 TeamRewardDistributionCompleted 事件
      const eventFragment = staking.interface.getEvent("TeamRewardDistributionCompleted");
      const topicHash = eventFragment.topicHash;
      const log = receipt.logs.find(l => l.topics[0] === topicHash);
      assert(log !== undefined, "应存在 TeamRewardDistributionCompleted 事件");

      const decoded = staking.interface.decodeEventLog(eventFragment, log.data, log.topics);
      const activeTiers = Number(decoded.activeTiers);
      console.log(`     activeTiers 位图: 0b${activeTiers.toString(2).padStart(9, '0')} (${activeTiers})`);

      // V8 对应 bit 7 (1 << 7 = 128)
      const hasV8 = (activeTiers & (1 << 7)) !== 0;
      console.log(`     V8 位 (bit 7): ${hasV8 ? '已设置' : '未设置'}`);
      assert(hasV8, "activeTiers 应包含 V8 位 (bit 7)");
    } finally {
      await revertSnapshot(snap);
    }
  });

  // TB-5: 合约余额查询
  await runner.run("TB-5", "合约 AE / USDX 余额查询", async () => {
    const aeBalance = await ae.balanceOf(stakingAddress);
    const usdxBalance = await usdx.balanceOf(stakingAddress);
    printBalances("合约当前余额:", aeBalance, usdxBalance);
    assert(aeBalance >= 0n, "AE 余额应 >= 0");
    assert(usdxBalance >= 0n, "USDX 余额应 >= 0");
  });

  const allPassed = runner.summary();

  // 测试结束后再次打印余额
  const aeBalFinal = await ae.balanceOf(stakingAddress);
  const usdxBalFinal = await usdx.balanceOf(stakingAddress);
  printBalances("\n合约最终余额:", aeBalFinal, usdxBalFinal);

  if (!allPassed) process.exit(1);
}

main()
  .then(() => process.exit(0))
  .catch((error) => { console.error(error); process.exit(1); });
