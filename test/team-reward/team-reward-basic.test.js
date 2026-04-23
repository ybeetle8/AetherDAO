/**
 * 模块 6：差额团队奖励分配 - 第一部分
 * 测试项 6.1 ~ 6.5
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

/** 创建一个有 BNB 的随机钱包 */
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

async function stakeAmount(staking, user, totalAmount) {
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

async function buildUserTier(staking, usdx, user, tier, stakingAddress) {
  const personalThresholds = [0n, parseEther("100"), parseEther("300"), parseEther("600"),
    parseEther("1000"), parseEther("3000"), parseEther("6000"), parseEther("10000"),
    parseEther("15000"), parseEther("20000")];
  const kpiThresholds = [0n, parseEther("3000"), parseEther("10000"), parseEther("30000"),
    parseEther("100000"), parseEther("300000"), parseEther("1000000"), parseEther("3000000"),
    parseEther("10000000"), parseEther("30000000")];
  const personalNeeded = personalThresholds[tier];
  const currentStake = await staking.currentStakeValue(user.address);
  if (currentStake < personalNeeded) {
    const diff = personalNeeded - currentStake;
    await prepareUser(usdx, user, stakingAddress, diff + parseEther("2000"));
    await stakeAmount(staking, user, diff);
  }
  await setTeamKpi(stakingAddress, user.address, kpiThresholds[tier]);
}

async function main() {
  console.log("\n=== 模块 6：差额团队奖励分配 - 第一部分 (6.1~6.5) ===\n");

  const deployment = loadDeployment();
  const { ae, staking, usdx } = await getContracts(deployment);
  const [deployer] = await hre.ethers.getSigners();
  const stakingAddress = deployment.contracts.Staking;
  const rootAddress = deployment.addresses.rootAddress;
  const runner = new TestRunner("模块 6：差额团队奖励分配 - 第一部分");

  // 6.1 基本差额分配: Dave→Bob(V3)→Alice(V5)→Root
  await runner.run("6.1", "基本差额分配 (Dave→Bob(V3)→Alice(V5)→Root)", async () => {
    const snap = await takeSnapshot();
    const alice = await createFundedWallet();
    const bob = await createFundedWallet();
    const dave = await createFundedWallet();

    await safeBindReferral(staking, alice, rootAddress);
    await safeBindReferral(staking, bob, alice.address);
    await safeBindReferral(staking, dave, bob.address);

    await buildUserTier(staking, usdx, alice, 5, stakingAddress);
    await buildUserTier(staking, usdx, bob, 3, stakingAddress);

    const aT = await staking.getTeamPerformanceDetails(alice.address);
    const bT = await staking.getTeamPerformanceDetails(bob.address);
    console.log(`     Alice tier: V${aT.currentTier}, Bob tier: V${bT.currentTier}`);
    assert(Number(aT.currentTier) >= 5, `Alice 应为 V5+, 实际 V${aT.currentTier}`);
    assert(Number(bT.currentTier) >= 3, `Bob 应为 V3+, 实际 V${bT.currentTier}`);

    await prepareUser(usdx, dave, stakingAddress, parseEther("5000"));
    await advanceTimeSeconds(120);
    await staking.connect(dave).stake(parseEther("500"), 0);

    const bobBal0 = await usdx.balanceOf(bob.address);
    const aliceBal0 = await usdx.balanceOf(alice.address);
    const rootBal0 = await usdx.balanceOf(rootAddress);

    await advanceTime(8);
    await staking.connect(dave).unstake(0);

    const bobR = (await usdx.balanceOf(bob.address)) - bobBal0;
    const aliceR = (await usdx.balanceOf(alice.address)) - aliceBal0;
    const rootR = (await usdx.balanceOf(rootAddress)) - rootBal0;

    console.log(`     Bob(11%): ${formatEther(bobR)}, Alice(8%): ${formatEther(aliceR)}, Root(16%): ${formatEther(rootR)}`);
    assert(bobR > 0n, "Bob 应获得奖励");
    assert(aliceR > 0n, "Alice 应获得奖励");
    assert(rootR > 0n, "Root 应获得剩余奖励");
    assert(bobR > aliceR, `Bob(11%) 应 > Alice(8%)`);
    await revertSnapshot(snap);
  });

  // 6.2 无推荐链
  await runner.run("6.2", "无推荐链（直接绑定 Root，奖励全归 Root）", async () => {
    const snap = await takeSnapshot();
    const loner = await createFundedWallet();
    await safeBindReferral(staking, loner, rootAddress);
    await prepareUser(usdx, loner, stakingAddress, parseEther("5000"));
    await advanceTimeSeconds(120);
    await staking.connect(loner).stake(parseEther("500"), 0);
    const rootBal0 = await usdx.balanceOf(rootAddress);
    await advanceTime(8);
    await staking.connect(loner).unstake(0);
    const rootR = (await usdx.balanceOf(rootAddress)) - rootBal0;
    console.log(`     Root 获得全部团队奖励: ${formatEther(rootR)} USDX`);
    assert(rootR > 0n, "Root 应获得全部团队奖励");
    await revertSnapshot(snap);
  });

  // 6.3 同等级不重复
  await runner.run("6.3", "同等级不重复（连续两个 V3，只有第一个拿差额）", async () => {
    const snap = await takeSnapshot();
    const u1 = await createFundedWallet();
    const u2 = await createFundedWallet();
    const staker = await createFundedWallet();
    await safeBindReferral(staking, u2, rootAddress);
    await safeBindReferral(staking, u1, u2.address);
    await safeBindReferral(staking, staker, u1.address);
    await buildUserTier(staking, usdx, u1, 3, stakingAddress);
    await buildUserTier(staking, usdx, u2, 3, stakingAddress);
    const t1 = await staking.getTeamPerformanceDetails(u1.address);
    const t2 = await staking.getTeamPerformanceDetails(u2.address);
    console.log(`     u1 tier: V${t1.currentTier}, u2 tier: V${t2.currentTier}`);
    await prepareUser(usdx, staker, stakingAddress, parseEther("5000"));
    await advanceTimeSeconds(120);
    await staking.connect(staker).stake(parseEther("500"), 0);
    const b1 = await usdx.balanceOf(u1.address);
    const b2 = await usdx.balanceOf(u2.address);
    await advanceTime(8);
    await staking.connect(staker).unstake(0);
    const r1 = (await usdx.balanceOf(u1.address)) - b1;
    const r2 = (await usdx.balanceOf(u2.address)) - b2;
    console.log(`     第一个 V3: ${formatEther(r1)}, 第二个 V3: ${formatEther(r2)}`);
    assert(r1 > 0n, "第一个 V3 应获得奖励");
    assert(r2 === 0n, `第二个 V3 不应获得奖励, 实际 ${formatEther(r2)}`);
    await revertSnapshot(snap);
  });

  // 6.4 等级递增链 V1→V3→V5
  await runner.run("6.4", "等级递增链 (V1→V3→V5 差额验证)", async () => {
    const snap = await takeSnapshot();
    const uV5 = await createFundedWallet();
    const uV3 = await createFundedWallet();
    const uV1 = await createFundedWallet();
    const staker = await createFundedWallet();
    await safeBindReferral(staking, uV5, rootAddress);
    await safeBindReferral(staking, uV3, uV5.address);
    await safeBindReferral(staking, uV1, uV3.address);
    await safeBindReferral(staking, staker, uV1.address);
    await buildUserTier(staking, usdx, uV1, 1, stakingAddress);
    await buildUserTier(staking, usdx, uV3, 3, stakingAddress);
    await buildUserTier(staking, usdx, uV5, 5, stakingAddress);
    console.log(`     V1=${(await staking.getTeamPerformanceDetails(uV1.address)).currentTier}, V3=${(await staking.getTeamPerformanceDetails(uV3.address)).currentTier}, V5=${(await staking.getTeamPerformanceDetails(uV5.address)).currentTier}`);
    await prepareUser(usdx, staker, stakingAddress, parseEther("5000"));
    await advanceTimeSeconds(120);
    await staking.connect(staker).stake(parseEther("500"), 0);
    const bV1 = await usdx.balanceOf(uV1.address);
    const bV3 = await usdx.balanceOf(uV3.address);
    const bV5 = await usdx.balanceOf(uV5.address);
    const bRoot = await usdx.balanceOf(rootAddress);
    await advanceTime(8);
    await staking.connect(staker).unstake(0);
    const rV1 = (await usdx.balanceOf(uV1.address)) - bV1;
    const rV3 = (await usdx.balanceOf(uV3.address)) - bV3;
    const rV5 = (await usdx.balanceOf(uV5.address)) - bV5;
    const rRoot = (await usdx.balanceOf(rootAddress)) - bRoot;
    console.log(`     V1(3%): ${formatEther(rV1)}, V3(8%): ${formatEther(rV3)}, V5(8%): ${formatEther(rV5)}, Root(16%): ${formatEther(rRoot)}`);
    assert(rV1 > 0n, "V1 应获得奖励");
    assert(rV3 > 0n, "V3 应获得差额奖励");
    assert(rV5 > 0n, "V5 应获得差额奖励");
    assert(rRoot > 0n, "Root 应获得剩余奖励");
    if (rV3 > 0n && rV5 > 0n) {
      const ratio = Number(formatEther(rV3)) / Number(formatEther(rV5));
      console.log(`     V3/V5 比: ${ratio.toFixed(4)} (应接近 1.0)`);
      assert(ratio > 0.8 && ratio < 1.2, `V3 和 V5 差额应接近`);
    }
    await revertSnapshot(snap);
  });

  // 6.5 等级递减链
  await runner.run("6.5", "等级递减链（上级等级低于下级，不获得奖励）", async () => {
    const snap = await takeSnapshot();
    const uLow = await createFundedWallet();
    const uHigh = await createFundedWallet();
    const staker = await createFundedWallet();
    await safeBindReferral(staking, uLow, rootAddress);
    await safeBindReferral(staking, uHigh, uLow.address);
    await safeBindReferral(staking, staker, uHigh.address);
    await buildUserTier(staking, usdx, uHigh, 3, stakingAddress);
    await buildUserTier(staking, usdx, uLow, 1, stakingAddress);
    console.log(`     uHigh: V${(await staking.getTeamPerformanceDetails(uHigh.address)).currentTier}, uLow: V${(await staking.getTeamPerformanceDetails(uLow.address)).currentTier}`);
    await prepareUser(usdx, staker, stakingAddress, parseEther("5000"));
    await advanceTimeSeconds(120);
    await staking.connect(staker).stake(parseEther("500"), 0);
    const bH = await usdx.balanceOf(uHigh.address);
    const bL = await usdx.balanceOf(uLow.address);
    await advanceTime(8);
    await staking.connect(staker).unstake(0);
    const rH = (await usdx.balanceOf(uHigh.address)) - bH;
    const rL = (await usdx.balanceOf(uLow.address)) - bL;
    console.log(`     V3(下级): ${formatEther(rH)}, V1(上级): ${formatEther(rL)}`);
    assert(rH > 0n, "V3(下级) 应获得奖励");
    assert(rL === 0n, `V1(上级) 不应获得奖励, 实际 ${formatEther(rL)}`);
    await revertSnapshot(snap);
  });

  const allPassed = runner.summary();
  if (!allPassed) process.exit(1);
}

main()
  .then(() => process.exit(0))
  .catch((error) => { console.error(error); process.exit(1); });
