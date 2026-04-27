/**
 * 质押订单列表查询功能测试
 * 测试项 SOL-1 ~ SOL-7
 *
 * 验证 getUserStakeRecords() 批量查询接口:
 * - 无质押时返回空数组
 * - 单笔/多笔质押后列表正确
 * - 当前价值计算正确
 * - 到期判断正确
 * - 已提取状态正确
 * - 已提取利息金额正确
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
  console.log("\n=== 质押订单列表查询功能测试 (SOL-1 ~ SOL-7) ===\n");

  const snapshotId = await takeSnapshot();

  const deployment = loadDeployment();
  const { ae, staking, pair, usdx } = await getContracts(deployment);
  const [deployer, ...accounts] = await hre.ethers.getSigners();
  const stakingAddress = deployment.contracts.Staking;
  const rootAddress = deployment.addresses.rootAddress;

  const user1 = accounts[0];
  const user2 = accounts[1];

  const runner = new TestRunner("质押订单列表查询");

  // 准备用户
  for (const u of [user1, user2]) {
    await prepareUser(usdx, staking, u, stakingAddress, rootAddress);
  }

  // =========================================================================
  // SOL-1 无质押时返回空数组
  // =========================================================================
  await runner.run("SOL-1", "无质押时返回空数组", async () => {
    // user2 未质押过
    const orders = await staking.getUserStakeRecords(user2.address);
    assertEq(BigInt(orders.length), 0n, "未质押用户应返回空数组");
    console.log(`     user2 订单数: ${orders.length}`);
  });

  // =========================================================================
  // SOL-2 单笔质押后列表正确
  // =========================================================================
  await advanceTimeSeconds(120);
  await runner.run("SOL-2", "单笔质押后列表包含1条记录，字段正确", async () => {
    const stakeAmount = parseEther("500");
    const stakeIndex = 1; // 30 天期

    await staking.connect(user1).stake(stakeAmount, stakeIndex);

    const orders = await staking.getUserStakeRecords(user1.address);
    assertEq(BigInt(orders.length), 1n, "应有1条记录");

    const order = orders[0];
    assertEq(order.index, 0n, "index 应为 0");
    assertEq(order.amount, stakeAmount, "amount 应等于质押金额");
    assertEq(order.status, false, "status 应为 false (未提取)");
    assertEq(BigInt(order.stakeIndex), BigInt(stakeIndex), "stakeIndex 应正确");
    assert(order.stakeTime > 0n, "stakeTime 应 > 0");
    assert(order.currentValue >= stakeAmount, "currentValue 应 >= amount");
    assertEq(order.canWithdraw, false, "未到期, canWithdraw 应为 false");
    assert(order.timeRemaining > 0n, "未到期, timeRemaining 应 > 0");
    assertEq(order.withdrawnInterestAmount, 0n, "withdrawnInterestAmount 应为 0");

    console.log(`     index=${order.index}, amount=${formatEther(order.amount)}`);
    console.log(`     stakeIndex=${order.stakeIndex}, stakeTime=${order.stakeTime}`);
    console.log(`     currentValue=${formatEther(order.currentValue)}, canWithdraw=${order.canWithdraw}`);
    console.log(`     timeRemaining=${order.timeRemaining}s, earnedInterest=${formatEther(order.earnedInterest)}`);
  });

  // =========================================================================
  // SOL-3 多笔质押列表完整
  // =========================================================================
  await advanceTimeSeconds(120);
  await runner.run("SOL-3", "质押3笔不同档位后, 列表包含3条记录, index 0/1/2", async () => {
    // user1 已有 1 笔 (index=0, 30天期), 再质押 2 笔不同档位
    await staking.connect(user1).stake(parseEther("300"), 2); // 90 天期
    await advanceTimeSeconds(120);
    await staking.connect(user1).stake(parseEther("200"), 3); // 180 天期

    const orders = await staking.getUserStakeRecords(user1.address);
    assertEq(BigInt(orders.length), 3n, "应有3条记录");

    // 验证 index 顺序
    assertEq(orders[0].index, 0n, "第一条 index 应为 0");
    assertEq(orders[1].index, 1n, "第二条 index 应为 1");
    assertEq(orders[2].index, 2n, "第三条 index 应为 2");

    // 验证金额
    assertEq(orders[0].amount, parseEther("500"), "第一笔应为 500");
    assertEq(orders[1].amount, parseEther("300"), "第二笔应为 300");
    assertEq(orders[2].amount, parseEther("200"), "第三笔应为 200");

    // 验证档位
    assertEq(BigInt(orders[0].stakeIndex), 1n, "第一笔档位应为 1");
    assertEq(BigInt(orders[1].stakeIndex), 2n, "第二笔档位应为 2");
    assertEq(BigInt(orders[2].stakeIndex), 3n, "第三笔档位应为 3");

    // 所有都未提取
    for (let i = 0; i < 3; i++) {
      assertEq(orders[i].status, false, `第 ${i + 1} 笔 status 应为 false`);
      assertEq(orders[i].canWithdraw, false, `第 ${i + 1} 笔应未到期`);
    }

    console.log(`     共 ${orders.length} 条记录:`);
    for (const o of orders) {
      console.log(`     #${o.index}: ${formatEther(o.amount)} USDX, 档位=${o.stakeIndex}, 剩余=${o.timeRemaining}s`);
    }
  });

  // =========================================================================
  // SOL-4 当前价值计算正确
  // =========================================================================
  await runner.run("SOL-4", "currentValue >= amount (因含利息)", async () => {
    // 推进一些时间让利息累积
    await advanceTime(5);

    const orders = await staking.getUserStakeRecords(user1.address);

    for (let i = 0; i < orders.length; i++) {
      const order = orders[i];
      assert(
        order.currentValue >= order.amount,
        `第 ${i} 笔 currentValue (${formatEther(order.currentValue)}) 应 >= amount (${formatEther(order.amount)})`
      );
      // earnedInterest = currentValue - amount
      const expectedInterest = order.currentValue - BigInt(order.amount);
      assertEq(
        order.earnedInterest,
        expectedInterest,
        `第 ${i} 笔 earnedInterest 应等于 currentValue - amount`
      );
    }

    console.log(`     推进 5 天后各笔价值:`);
    for (const o of orders) {
      console.log(`     #${o.index}: 本金=${formatEther(o.amount)}, 当前价值=${formatEther(o.currentValue)}, 利息=${formatEther(o.earnedInterest)}`);
    }
  });

  // =========================================================================
  // SOL-5 到期判断正确
  // =========================================================================
  await runner.run("SOL-5", "推进时间到期后, canWithdraw=true, timeRemaining=0", async () => {
    // 推进到 30 天后, 使第一笔 (30天期) 到期
    await advanceTime(26); // 之前已推进 5 天, 再推进 26 天 = 31 天

    const orders = await staking.getUserStakeRecords(user1.address);

    // 第一笔 (30天期) 应已到期
    assertEq(orders[0].canWithdraw, true, "30天期应已到期, canWithdraw=true");
    assertEq(orders[0].timeRemaining, 0n, "30天期应已到期, timeRemaining=0");

    // 第二笔 (90天期) 应未到期
    assertEq(orders[1].canWithdraw, false, "90天期应未到期");
    assert(orders[1].timeRemaining > 0n, "90天期 timeRemaining 应 > 0");

    // 第三笔 (180天期) 应未到期
    assertEq(orders[2].canWithdraw, false, "180天期应未到期");
    assert(orders[2].timeRemaining > 0n, "180天期 timeRemaining 应 > 0");

    console.log(`     推进到 31 天后:`);
    for (const o of orders) {
      console.log(`     #${o.index}: 档位=${o.stakeIndex}, canWithdraw=${o.canWithdraw}, timeRemaining=${o.timeRemaining}s`);
    }
  });

  // =========================================================================
  // SOL-6 已提取状态正确
  // =========================================================================
  await runner.run("SOL-6", "unstake 后该订单 status=true, currentValue=0", async () => {
    // 赎回第一笔 (已到期)
    await staking.connect(user1).unstake(0);

    const orders = await staking.getUserStakeRecords(user1.address);

    // 第一笔应已提取
    assertEq(orders[0].status, true, "第一笔 status 应为 true (已提取)");
    assertEq(orders[0].currentValue, 0n, "已提取订单 currentValue 应为 0");
    assertEq(orders[0].canWithdraw, false, "已提取订单 canWithdraw 应为 false");
    assertEq(orders[0].timeRemaining, 0n, "已提取订单 timeRemaining 应为 0");
    assertEq(orders[0].earnedInterest, 0n, "已提取订单 earnedInterest 应为 0");

    // 其他两笔应不受影响
    assertEq(orders[1].status, false, "第二笔应仍未提取");
    assertEq(orders[2].status, false, "第三笔应仍未提取");
    assert(orders[1].currentValue > 0n, "第二笔 currentValue 应 > 0");
    assert(orders[2].currentValue > 0n, "第三笔 currentValue 应 > 0");

    console.log(`     赎回第一笔后:`);
    for (const o of orders) {
      console.log(`     #${o.index}: status=${o.status}, currentValue=${formatEther(o.currentValue)}, canWithdraw=${o.canWithdraw}`);
    }
  });

  // =========================================================================
  // SOL-7 已提取利息金额正确
  // =========================================================================
  await advanceTimeSeconds(120);
  await runner.run("SOL-7", "withdrawInterest 后 withdrawnInterestAmount > 0", async () => {
    // 再推进一些时间让利息继续累积
    await advanceTime(10);

    // 查看提取利息前的状态
    const ordersBefore = await staking.getUserStakeRecords(user1.address);
    const interestBefore = ordersBefore[1].withdrawnInterestAmount;
    assertEq(interestBefore, 0n, "提取利息前 withdrawnInterestAmount 应为 0");

    // 对第二笔 (index=1) 提取利息
    await staking.connect(user1).withdrawInterest(1);

    const ordersAfter = await staking.getUserStakeRecords(user1.address);
    const interestAfter = ordersAfter[1].withdrawnInterestAmount;

    assert(interestAfter > 0n, "提取利息后 withdrawnInterestAmount 应 > 0");

    // 对比 getWithdrawnInterest 单独查询的值
    const withdrawnFromGetter = await staking.getWithdrawnInterest(user1.address, 1);
    assertEq(
      interestAfter,
      withdrawnFromGetter,
      "withdrawnInterestAmount 应与 getWithdrawnInterest 一致"
    );

    console.log(`     第二笔提取利息后:`);
    console.log(`     withdrawnInterestAmount=${formatEther(interestAfter)} USDX`);
    console.log(`     currentValue=${formatEther(ordersAfter[1].currentValue)}`);
    console.log(`     earnedInterest=${formatEther(ordersAfter[1].earnedInterest)}`);
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
