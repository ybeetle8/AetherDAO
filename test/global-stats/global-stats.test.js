/**
 * 全局数据记录功能测试
 * 测试项 GS-1 ~ GS-11
 *
 * 验证全局统计数据的链上记录:
 * - totalDividendsDistributed: 全网累计分红
 * - totalEducationFundDistributed: 全网累计教育基金
 * - totalStakers: 当前质押参与人数
 * - getGlobalStats(): 统一查询接口
 * - getTotalBurned(): AE 累计销毁量
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
const {
  advanceTime,
  advanceTimeSeconds,
  takeSnapshot,
  revertSnapshot,
} = require("../helpers/time");

const parseEther = hre.ethers.parseEther;
const formatEther = hre.ethers.formatEther;

/**
 * 为地址设置 BNB 余额 (用于支付 gas)
 */
async function setBNBBalance(address) {
  await hre.network.provider.send("hardhat_setBalance", [
    address,
    "0x56BC75E2D63100000", // 100 BNB
  ]);
}

async function safeBindReferral(staking, user, referrer) {
  const isBound = await staking.isBindReferral(user.address);
  if (!isBound) {
    await staking.connect(user).lockReferral(referrer);
  }
}

async function prepareUser(usdx, staking, user, stakingAddress, rootAddress) {
  await setBNBBalance(user.address);
  await setUSDXBalance(user.address, parseEther("100000"));
  await approveUSDX(usdx, user, stakingAddress, parseEther("100000"));
  await safeBindReferral(staking, user, rootAddress);
}

async function main() {
  console.log("\n=== 全局数据记录功能测试 (GS-1 ~ GS-11) ===\n");

  const snapshotId = await takeSnapshot();

  const deployment = loadDeployment();
  const { ae, staking, pair, usdx } = await getContracts(deployment);
  const [deployer, ...accounts] = await hre.ethers.getSigners();
  const stakingAddress = deployment.contracts.Staking;
  const rootAddress = deployment.addresses.rootAddress;

  const user1 = accounts[0];
  const user2 = accounts[1];
  const user3 = accounts[2];

  const runner = new TestRunner("全局数据记录");

  // 准备所有用户
  for (const u of [user1, user2, user3]) {
    await prepareUser(usdx, staking, u, stakingAddress, rootAddress);
  }

  // =========================================================================
  // GS-1 初始值验证
  // =========================================================================
  await runner.run("GS-1", "初始值验证: 所有全局统计初始值为 0", async () => {
    const stats = await staking.getGlobalStats();
    // tvl 可能非零 (之前部署脚本可能已有质押), 主要验证新增的三个变量
    assertEq(stats.dividends, 0n, "totalDividendsDistributed 应为 0");
    assertEq(stats.educationFund, 0n, "totalEducationFundDistributed 应为 0");
    assertEq(stats.stakerCount, 0n, "totalStakers 应为 0");
    console.log(`     tvl=${formatEther(stats.tvl)}, dividends=${formatEther(stats.dividends)}, educationFund=${formatEther(stats.educationFund)}, stakerCount=${stats.stakerCount}`);
  });

  // =========================================================================
  // GS-2 质押后参与人数增加
  // =========================================================================
  await advanceTimeSeconds(120);
  await runner.run("GS-2", "新用户首次质押后 totalStakers +1", async () => {
    const statsBefore = await staking.getGlobalStats();
    const stakersBefore = statsBefore.stakerCount;

    await staking.connect(user1).stake(parseEther("500"), 0); // 7 天期

    const statsAfter = await staking.getGlobalStats();
    assertEq(statsAfter.stakerCount, stakersBefore + 1n, "参与人数应 +1");
    console.log(`     质押前 stakerCount=${stakersBefore}, 质押后=${statsAfter.stakerCount}`);
  });

  // =========================================================================
  // GS-3 同一用户多次质押不重复计数
  // =========================================================================
  await advanceTimeSeconds(120);
  await runner.run("GS-3", "已有质押的用户再次质押, totalStakers 不变", async () => {
    const statsBefore = await staking.getGlobalStats();
    const stakersBefore = statsBefore.stakerCount;

    // user1 已经有质押, 再次质押 (用 stakeIndex=1 即 30 天期, 因为 7 天期每用户只能用一次)
    await staking.connect(user1).stake(parseEther("300"), 1); // 30 天期

    const statsAfter = await staking.getGlobalStats();
    assertEq(statsAfter.stakerCount, stakersBefore, "参与人数应不变");
    console.log(`     二次质押前 stakerCount=${stakersBefore}, 二次质押后=${statsAfter.stakerCount}`);
  });

  // =========================================================================
  // GS-4 多用户质押后参与人数正确
  // =========================================================================
  await advanceTimeSeconds(120);
  await runner.run("GS-4", "第二个用户质押后 totalStakers 再 +1", async () => {
    const statsBefore = await staking.getGlobalStats();
    const stakersBefore = statsBefore.stakerCount;

    await staking.connect(user2).stake(parseEther("500"), 0);

    const statsAfter = await staking.getGlobalStats();
    assertEq(statsAfter.stakerCount, stakersBefore + 1n, "参与人数应 +1");
    console.log(`     质押前 stakerCount=${stakersBefore}, 质押后=${statsAfter.stakerCount}`);
  });

  // =========================================================================
  // GS-5 解质押后分红累计正确 + 教育基金累计正确
  // =========================================================================
  await advanceTimeSeconds(120);
  await runner.run("GS-5", "unstake 后 totalDividendsDistributed 和 totalEducationFundDistributed 增加", async () => {
    // 推进 30 天 + 1 秒使所有质押到期 (user1 有 7 天期和 30 天期)
    await advanceTime(30);
    await advanceTimeSeconds(1);

    const statsBefore = await staking.getGlobalStats();
    const dividendsBefore = statsBefore.dividends;
    const educationFundBefore = statsBefore.educationFund;

    // user1 赎回第一笔质押 (index 0)
    const usdxBefore = await usdx.balanceOf(user1.address);
    await staking.connect(user1).unstake(0);
    const usdxAfter = await usdx.balanceOf(user1.address);

    const received = usdxAfter - usdxBefore;

    const statsAfter = await staking.getGlobalStats();
    const dividendsIncrease = statsAfter.dividends - dividendsBefore;
    const educationFundIncrease = statsAfter.educationFund - educationFundBefore;

    assert(dividendsIncrease > 0n, "分红累计应增加");
    assert(educationFundIncrease > 0n, "教育基金累计应增加");
    // userPayout 就是用户收到的金额
    assertEq(dividendsIncrease, received, "分红增量应等于用户收到的金额");

    console.log(`     分红增量: ${formatEther(dividendsIncrease)} USDX`);
    console.log(`     教育基金增量: ${formatEther(educationFundIncrease)} USDX`);
    console.log(`     用户实收: ${formatEther(received)} USDX`);
  });

  // =========================================================================
  // GS-6 部分解质押不影响参与人数
  // =========================================================================
  await runner.run("GS-6", "用户只取出部分质押, totalStakers 不变 (user1 还有第二笔)", async () => {
    // user1 已经赎回 index 0, 但 index 1 (GS-3 中质押的 300) 仍在
    const stats = await staking.getGlobalStats();
    const balance = await staking.principalBalance(user1.address);
    assert(balance > 0n, "user1 应仍有质押余额");
    // stakerCount 应该没变（user1 还在，user2 也在）
    assertEq(stats.stakerCount, 2n, "参与人数应仍为 2");
    console.log(`     user1 剩余本金: ${formatEther(balance)}, stakerCount=${stats.stakerCount}`);
  });

  // =========================================================================
  // GS-7 全部解质押后参与人数减少
  // =========================================================================
  await runner.run("GS-7", "用户取出全部本金后 totalStakers -1", async () => {
    const statsBefore = await staking.getGlobalStats();
    const stakersBefore = statsBefore.stakerCount;

    // user1 赎回第二笔 (index 1)
    await staking.connect(user1).unstake(1);

    const balanceAfter = await staking.principalBalance(user1.address);
    assertEq(balanceAfter, 0n, "user1 本金应为 0");

    const statsAfter = await staking.getGlobalStats();
    assertEq(statsAfter.stakerCount, stakersBefore - 1n, "参与人数应 -1");
    console.log(`     解质押后 stakerCount=${statsAfter.stakerCount} (从 ${stakersBefore} 减少)`);
  });

  // =========================================================================
  // GS-8 withdrawInterest 后分红累计正确
  // =========================================================================
  await advanceTimeSeconds(120);
  await runner.run("GS-8", "withdrawInterest 后 totalDividendsDistributed 增加", async () => {
    // user3 质押一笔，等几天后提取利息
    await staking.connect(user3).stake(parseEther("500"), 0);
    await advanceTime(3); // 等 3 天产生利息

    const statsBefore = await staking.getGlobalStats();
    const dividendsBefore = statsBefore.dividends;

    const usdxBefore = await usdx.balanceOf(user3.address);
    await staking.connect(user3).withdrawInterest(0);
    const usdxAfter = await usdx.balanceOf(user3.address);

    const received = usdxAfter - usdxBefore;

    const statsAfter = await staking.getGlobalStats();
    const dividendsIncrease = statsAfter.dividends - dividendsBefore;

    assert(dividendsIncrease > 0n, "分红累计应增加");
    assertEq(dividendsIncrease, received, "分红增量应等于用户收到的金额");
    console.log(`     提取利息 — 分红增量: ${formatEther(dividendsIncrease)} USDX, 用户实收: ${formatEther(received)} USDX`);
  });

  // =========================================================================
  // GS-9 getTotalBurned 返回正确值
  // =========================================================================
  await runner.run("GS-9", "getTotalBurned() 返回 DEAD_ADDRESS 的 AE 余额", async () => {
    const DEAD_ADDRESS = "0x000000000000000000000000000000000000dEaD";
    const totalBurned = await ae.getTotalBurned();
    const deadBalance = await ae.balanceOf(DEAD_ADDRESS);
    assertEq(totalBurned, deadBalance, "getTotalBurned 应等于 DEAD_ADDRESS 余额");
    console.log(`     AE 累计销毁量: ${formatEther(totalBurned)}`);
  });

  // =========================================================================
  // GS-10 getGlobalStats 返回一致数据
  // =========================================================================
  await runner.run("GS-10", "getGlobalStats() 返回值与单独查询一致", async () => {
    const stats = await staking.getGlobalStats();

    const tvl = await staking.totalSupply();
    const dividends = await staking.totalDividendsDistributed();
    const educationFund = await staking.totalEducationFundDistributed();
    const stakerCount = await staking.totalStakers();

    assertEq(stats.tvl, tvl, "tvl 应一致");
    assertEq(stats.dividends, dividends, "dividends 应一致");
    assertEq(stats.educationFund, educationFund, "educationFund 应一致");
    assertEq(stats.stakerCount, stakerCount, "stakerCount 应一致");
    console.log(`     tvl=${formatEther(tvl)}, dividends=${formatEther(dividends)}, educationFund=${formatEther(educationFund)}, stakerCount=${stakerCount}`);
  });

  // =========================================================================
  // GS-11 多用户交叉操作正确性
  // =========================================================================
  await advanceTimeSeconds(120);
  await runner.run("GS-11", "多用户交叉操作后所有计数器正确", async () => {
    // 先记录当前状态
    const statsStart = await staking.getGlobalStats();
    const stakersStart = statsStart.stakerCount;
    const dividendsStart = statsStart.dividends;

    // user1 重新质押 (从 stakerCount 0 -> +1), 用 stakeIndex=1 (30 天期)
    await setUSDXBalance(user1.address, parseEther("100000"));
    await approveUSDX(usdx, user1, stakingAddress, parseEther("100000"));
    await staking.connect(user1).stake(parseEther("200"), 1);

    const statsAfterU1Stake = await staking.getGlobalStats();
    assertEq(statsAfterU1Stake.stakerCount, stakersStart + 1n, "user1 重新质押后参与人数 +1");

    // user2 赎回 (到期了因为前面推进了 7 天 + 3 天)
    const usdxBeforeU2 = await usdx.balanceOf(user2.address);
    await staking.connect(user2).unstake(0);
    const usdxAfterU2 = await usdx.balanceOf(user2.address);
    const receivedU2 = usdxAfterU2 - usdxBeforeU2;

    const statsAfterU2Unstake = await staking.getGlobalStats();
    // user2 全部解质押，应 -1
    const u2Balance = await staking.principalBalance(user2.address);
    if (u2Balance === 0n) {
      assertEq(statsAfterU2Unstake.stakerCount, statsAfterU1Stake.stakerCount - 1n, "user2 全部解质押后参与人数 -1");
    }

    // 验证分红也正确累计
    assert(statsAfterU2Unstake.dividends > dividendsStart, "分红总量应持续增加");

    console.log(`     起始: stakerCount=${stakersStart}, dividends=${formatEther(dividendsStart)}`);
    console.log(`     user1 质押后: stakerCount=${statsAfterU1Stake.stakerCount}`);
    console.log(`     user2 解质押后: stakerCount=${statsAfterU2Unstake.stakerCount}, dividends=${formatEther(statsAfterU2Unstake.dividends)}`);
    console.log(`     user2 收到: ${formatEther(receivedU2)} USDX`);
  });

  // =========================================================================
  // 输出结果 & 恢复快照
  // =========================================================================
  const allPassed = runner.summary();
  await revertSnapshot(snapshotId);
  if (!allPassed) process.exit(1);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
