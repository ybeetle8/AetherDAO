/**
 * 模块 6：差额团队奖励分配 - 第二部分
 * 测试项 6.6 ~ 6.13
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
const { advanceTime, advanceTimeSeconds, takeSnapshot, revertSnapshot } = require("../helpers/time");

const parseEther = hre.ethers.parseEther;
const formatEther = hre.ethers.formatEther;
const MAX_TEAM_REWARD_RATE = 35n;
const PERCENTAGE_BASE = 100n;
const KPI_STORAGE_SLOT = 14;

async function createFundedWallet() {
  const wallet = hre.ethers.Wallet.createRandom().connect(hre.ethers.provider);
  const [funder] = await hre.ethers.getSigners();
  await funder.sendTransaction({ to: wallet.address, value: parseEther("1") });
  return wallet;
}

async function safeBindReferral(staking, user, referrer) {
  const isBound = await staking.isBindReferral(user.address);
  if (!isBound) await staking.connect(user).lockReferral(referrer);
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
  console.log("\n=== 模块 6：差额团队奖励分配 - 第二部分 (6.6~6.13) ===\n");
  const deployment = loadDeployment();
  const { ae, staking, usdx } = await getContracts(deployment);
  const [deployer] = await hre.ethers.getSigners();
  const stakingAddress = deployment.contracts.Staking;
  const rootAddress = deployment.addresses.rootAddress;
  const runner = new TestRunner("模块 6：差额团队奖励分配 - 第二部分");

  // 6.6 布道者检查
  await runner.run("6.6", "布道者检查（质押<200 不参与分配）", async () => {
    const snap = await takeSnapshot();
    const np = await createFundedWallet();
    const staker = await createFundedWallet();
    await safeBindReferral(staking, np, rootAddress);
    await safeBindReferral(staking, staker, np.address);
    await prepareUser(usdx, np, stakingAddress, parseEther("5000"));
    await advanceTimeSeconds(120);
    await staking.connect(np).stake(parseEther("100"), 1);
    const isPreach = await staking.isPreacher(np.address);
    console.log(`     isPreacher: ${isPreach} (应为 false)`);
    assert(!isPreach, "质押 100 不应是布道者");
    await prepareUser(usdx, staker, stakingAddress, parseEther("5000"));
    await advanceTimeSeconds(120);
    await staking.connect(staker).stake(parseEther("500"), 0);
    const npBal0 = await usdx.balanceOf(np.address);
    const rootBal0 = await usdx.balanceOf(rootAddress);
    await advanceTime(8);
    await staking.connect(staker).unstake(0);
    const npR = (await usdx.balanceOf(np.address)) - npBal0;
    const rootR = (await usdx.balanceOf(rootAddress)) - rootBal0;
    console.log(`     非布道者: ${formatEther(npR)}, Root: ${formatEther(rootR)}`);
    assert(npR === 0n, `非布道者不应获得奖励`);
    assert(rootR > 0n, "Root 应获得全部团队奖励");
    await revertSnapshot(snap);
  });

  // 6.7 非布道者隐式排除
  await runner.run("6.7", "非布道者隐式排除验证（tier=0 跳过）", async () => {
    const snap = await takeSnapshot();
    const low = await createFundedWallet();
    const staker = await createFundedWallet();
    await safeBindReferral(staking, low, rootAddress);
    await safeBindReferral(staking, staker, low.address);
    await prepareUser(usdx, low, stakingAddress, parseEther("5000"));
    await advanceTimeSeconds(120);
    await staking.connect(low).stake(parseEther("100"), 1);
    const tier = await staking.getTeamPerformanceDetails(low.address);
    console.log(`     tier: V${tier.currentTier} (应为 0)`);
    assertEq(Number(tier.currentTier), 0, "tier 应为 0");
    await prepareUser(usdx, staker, stakingAddress, parseEther("5000"));
    await advanceTimeSeconds(120);
    await staking.connect(staker).stake(parseEther("500"), 0);
    await advanceTime(8);
    const tx = await staking.connect(staker).unstake(0);
    const receipt = await tx.wait();
    const evt = receipt.logs.find(l => { try { return staking.interface.parseLog(l)?.name === "TeamRewardDistributionCompleted"; } catch { return false; } });
    if (evt) {
      const p = staking.interface.parseLog(evt);
      console.log(`     totalDistributed: ${formatEther(p.args.totalDistributed)} (应为 0)`);
      assertEq(p.args.totalDistributed, 0n, "totalDistributed 应为 0");
    }
    await revertSnapshot(snap);
  });

  // 6.8 奖励池总额验证
  await runner.run("6.8", "奖励池总额验证（利息 × 35%）", async () => {
    const snap = await takeSnapshot();
    const u = await createFundedWallet();
    const staker = await createFundedWallet();
    await safeBindReferral(staking, u, rootAddress);
    await safeBindReferral(staking, staker, u.address);
    await buildUserTier(staking, usdx, u, 3, stakingAddress);
    await prepareUser(usdx, staker, stakingAddress, parseEther("5000"));
    await advanceTimeSeconds(120);
    await staking.connect(staker).stake(parseEther("500"), 0);
    await advanceTime(8);
    const tx = await staking.connect(staker).unstake(0);
    const receipt = await tx.wait();
    const evt = receipt.logs.find(l => { try { return staking.interface.parseLog(l)?.name === "TeamRewardDistributionCompleted"; } catch { return false; } });
    assert(evt !== undefined, "应触发事件");
    const p = staking.interface.parseLog(evt);
    const expected = p.args.interestAmount * MAX_TEAM_REWARD_RATE / PERCENTAGE_BASE;
    console.log(`     利息: ${formatEther(p.args.interestAmount)}, 池: ${formatEther(p.args.totalTeamRewardPool)}, 期望: ${formatEther(expected)}`);
    assertEq(p.args.totalTeamRewardPool, expected, "奖励池应为利息×35%");
    await revertSnapshot(snap);
  });

  // 6.9 分配总额不超池
  await runner.run("6.9", "分配总额不超池（分配 + Root剩余 = 池总额）", async () => {
    const snap = await takeSnapshot();
    const uA = await createFundedWallet();
    const uB = await createFundedWallet();
    const staker = await createFundedWallet();
    await safeBindReferral(staking, uA, rootAddress);
    await safeBindReferral(staking, uB, uA.address);
    await safeBindReferral(staking, staker, uB.address);
    await buildUserTier(staking, usdx, uA, 5, stakingAddress);
    await buildUserTier(staking, usdx, uB, 3, stakingAddress);
    await prepareUser(usdx, staker, stakingAddress, parseEther("5000"));
    await advanceTimeSeconds(120);
    await staking.connect(staker).stake(parseEther("500"), 0);
    await advanceTime(8);
    const tx = await staking.connect(staker).unstake(0);
    const receipt = await tx.wait();
    const evt = receipt.logs.find(l => { try { return staking.interface.parseLog(l)?.name === "TeamRewardDistributionCompleted"; } catch { return false; } });
    assert(evt !== undefined, "应触发事件");
    const p = staking.interface.parseLog(evt);
    console.log(`     池: ${formatEther(p.args.totalTeamRewardPool)}, 分配: ${formatEther(p.args.totalDistributed)}, Root: ${formatEther(p.args.marketingAmount)}`);
    assertEq(p.args.totalDistributed + p.args.marketingAmount, p.args.totalTeamRewardPool, "分配+剩余=池总额");
    await revertSnapshot(snap);
  });

  // 6.10 TeamRewardDistributionCompleted 事件验证
  await runner.run("6.10", "TeamRewardDistributionCompleted 事件验证", async () => {
    const snap = await takeSnapshot();
    const u = await createFundedWallet();
    const staker = await createFundedWallet();
    await safeBindReferral(staking, u, rootAddress);
    await safeBindReferral(staking, staker, u.address);
    await buildUserTier(staking, usdx, u, 3, stakingAddress);
    await prepareUser(usdx, staker, stakingAddress, parseEther("5000"));
    await advanceTimeSeconds(120);
    await staking.connect(staker).stake(parseEther("500"), 0);
    await advanceTime(8);
    const tx = await staking.connect(staker).unstake(0);
    const receipt = await tx.wait();
    const evt = receipt.logs.find(l => { try { return staking.interface.parseLog(l)?.name === "TeamRewardDistributionCompleted"; } catch { return false; } });
    assert(evt !== undefined, "应触发事件");
    const p = staking.interface.parseLog(evt);
    assert(p.args.interestAmount > 0n, "interestAmount > 0");
    assert(p.args.totalDistributed > 0n, "totalDistributed > 0");
    assertEq(p.args.tierRecipients.length, 7, "tierRecipients 长度 7");
    assert(p.args.tierRecipients[2] !== hre.ethers.ZeroAddress, "V3 接收者非零");
    assert(p.args.tierAmounts[2] > 0n, "V3 金额 > 0");
    const at = Number(p.args.activeTiers);
    assert((at & 4) !== 0, `activeTiers 含 V3 bit, 实际 ${at}`);
    console.log(`     interest: ${formatEther(p.args.interestAmount)}, distributed: ${formatEther(p.args.totalDistributed)}, activeTiers: ${at}`);
    await revertSnapshot(snap);
  });

  // 6.11 StrictDifferentialRewardPaid 事件验证
  await runner.run("6.11", "StrictDifferentialRewardPaid 事件验证", async () => {
    const snap = await takeSnapshot();
    const uV5 = await createFundedWallet();
    const uV3 = await createFundedWallet();
    const staker = await createFundedWallet();
    await safeBindReferral(staking, uV5, rootAddress);
    await safeBindReferral(staking, uV3, uV5.address);
    await safeBindReferral(staking, staker, uV3.address);
    await buildUserTier(staking, usdx, uV5, 5, stakingAddress);
    await buildUserTier(staking, usdx, uV3, 3, stakingAddress);
    await prepareUser(usdx, staker, stakingAddress, parseEther("5000"));
    await advanceTimeSeconds(120);
    await staking.connect(staker).stake(parseEther("500"), 0);
    await advanceTime(8);
    const tx = await staking.connect(staker).unstake(0);
    const receipt = await tx.wait();
    const diffs = receipt.logs.filter(l => { try { return staking.interface.parseLog(l)?.name === "StrictDifferentialRewardPaid"; } catch { return false; } }).map(l => staking.interface.parseLog(l));
    console.log(`     事件数: ${diffs.length}`);
    assert(diffs.length >= 2, `应至少 2 个事件, 实际 ${diffs.length}`);
    const v3 = diffs.find(e => Number(e.args.tier) === 3);
    assert(v3, "应有 V3 事件");
    assertEq(Number(v3.args.actualRewardRate), 11, "V3 rate=11");
    assertEq(Number(v3.args.previousCumulativeRate), 0, "V3 prev=0");
    console.log(`     V3: ${formatEther(v3.args.rewardAmount)}`);
    const v5 = diffs.find(e => Number(e.args.tier) === 5);
    assert(v5, "应有 V5 事件");
    assertEq(Number(v5.args.actualRewardRate), 8, "V5 rate=8");
    assertEq(Number(v5.args.previousCumulativeRate), 11, "V5 prev=11");
    console.log(`     V5: ${formatEther(v5.args.rewardAmount)}`);
    await revertSnapshot(snap);
  });

  // 6.12 长推荐链分配
  await runner.run("6.12", "长推荐链分配（10+ 级推荐链）", async () => {
    const snap = await takeSnapshot();
    const chain = [];
    for (let i = 0; i < 12; i++) chain.push(await createFundedWallet());
    const staker = await createFundedWallet();
    await safeBindReferral(staking, chain[0], rootAddress);
    for (let i = 1; i < chain.length; i++) await safeBindReferral(staking, chain[i], chain[i - 1].address);
    await safeBindReferral(staking, staker, chain[chain.length - 1].address);
    // chain[8] → V3, chain[3] → V1 (从 staker 向上数)
    await buildUserTier(staking, usdx, chain[8], 3, stakingAddress);
    await buildUserTier(staking, usdx, chain[3], 1, stakingAddress);
    await prepareUser(usdx, staker, stakingAddress, parseEther("5000"));
    await advanceTimeSeconds(120);
    await staking.connect(staker).stake(parseEther("500"), 0);
    const bals = {};
    for (let i = 0; i < chain.length; i++) bals[i] = await usdx.balanceOf(chain[i].address);
    const rootBal0 = await usdx.balanceOf(rootAddress);
    await advanceTime(8);
    const tx = await staking.connect(staker).unstake(0);
    const receipt = await tx.wait();
    for (let i = 0; i < chain.length; i++) {
      const r = (await usdx.balanceOf(chain[i].address)) - bals[i];
      if (r > 0n) console.log(`     chain[${i}]: ${formatEther(r)} USDX`);
    }
    console.log(`     Root: ${formatEther((await usdx.balanceOf(rootAddress)) - rootBal0)}`);
    const evt = receipt.logs.find(l => { try { return staking.interface.parseLog(l)?.name === "TeamRewardDistributionCompleted"; } catch { return false; } });
    assert(evt, "应触发事件");
    const p = staking.interface.parseLog(evt);
    assertEq(p.args.totalDistributed + p.args.marketingAmount, p.args.totalTeamRewardPool, "分配+剩余=池总额");
    await revertSnapshot(snap);
  });

  // 6.13 全链无布道者
  await runner.run("6.13", "全链无布道者（所有人 tier=0，奖励全归 Root）", async () => {
    const snap = await takeSnapshot();
    const u1 = await createFundedWallet();
    const u2 = await createFundedWallet();
    const u3 = await createFundedWallet();
    const staker = await createFundedWallet();
    await safeBindReferral(staking, u1, rootAddress);
    await safeBindReferral(staking, u2, u1.address);
    await safeBindReferral(staking, u3, u2.address);
    await safeBindReferral(staking, staker, u3.address);
    await prepareUser(usdx, staker, stakingAddress, parseEther("5000"));
    await advanceTimeSeconds(120);
    await staking.connect(staker).stake(parseEther("500"), 0);
    const b1 = await usdx.balanceOf(u1.address);
    const b2 = await usdx.balanceOf(u2.address);
    const b3 = await usdx.balanceOf(u3.address);
    const rootBal0 = await usdx.balanceOf(rootAddress);
    await advanceTime(8);
    const tx = await staking.connect(staker).unstake(0);
    const receipt = await tx.wait();
    const r1 = (await usdx.balanceOf(u1.address)) - b1;
    const r2 = (await usdx.balanceOf(u2.address)) - b2;
    const r3 = (await usdx.balanceOf(u3.address)) - b3;
    const rootR = (await usdx.balanceOf(rootAddress)) - rootBal0;
    console.log(`     u1: ${formatEther(r1)}, u2: ${formatEther(r2)}, u3: ${formatEther(r3)}, Root: ${formatEther(rootR)}`);
    assert(r1 === 0n, "u1 不应获得奖励");
    assert(r2 === 0n, "u2 不应获得奖励");
    assert(r3 === 0n, "u3 不应获得奖励");
    assert(rootR > 0n, "Root 应获得全部团队奖励");
    const evt = receipt.logs.find(l => { try { return staking.interface.parseLog(l)?.name === "TeamRewardDistributionCompleted"; } catch { return false; } });
    if (evt) {
      const p = staking.interface.parseLog(evt);
      assertEq(p.args.totalDistributed, 0n, "totalDistributed=0");
      assert(p.args.marketingAmount > 0n, "marketingAmount>0");
    }
    await revertSnapshot(snap);
  });

  const allPassed = runner.summary();
  if (!allPassed) process.exit(1);
}

main()
  .then(() => process.exit(0))
  .catch((error) => { console.error(error); process.exit(1); });
