/**
 * 模块 8：管理员功能测试 - 第一部分
 * 测试项 8.1 ~ 8.7
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
const { takeSnapshot, revertSnapshot } = require("../helpers/time");

function errorContains(error, keyword) {
  return (error.message || "").includes(keyword);
}

async function main() {
  console.log("\n=== 模块 8：管理员功能测试 - 第一部分 (8.1~8.7) ===\n");

  const snapshotId = await takeSnapshot();

  const deployment = loadDeployment();
  const { ae, staking, usdx } = await getContracts(deployment);
  const [deployer, ...accounts] = await hre.ethers.getSigners();
  const stakingAddress = deployment.contracts.Staking;
  const rootAddress = deployment.addresses.rootAddress;
  const parseEther = hre.ethers.parseEther;
  const formatEther = hre.ethers.formatEther;

  const runner = new TestRunner("模块 8：管理员功能 - 第一部分");

  // 用于测试的账户（hardhat 默认 20 个 signer，deployer 占 1 个，accounts 共 19 个: 0~18）
  const newRoot = accounts[14];
  const newFeeRecipient = accounts[15];
  const withdrawTarget = accounts[16];
  const userForReset = accounts[17];
  const userForBatchReset1 = accounts[10];
  const userForBatchReset2 = accounts[11];
  const userForBatchReset3 = accounts[12];

  // =========================================================================
  // 8.1 setRootAddress - owner 设置新 root 地址
  // =========================================================================
  await runner.run("8.1", "setRootAddress - owner 设置新 root 地址", async () => {
    const oldRoot = await staking.getRootAddress();
    console.log(`     旧 root: ${oldRoot}`);

    await staking.connect(deployer).setRootAddress(newRoot.address);

    const updatedRoot = await staking.getRootAddress();
    assertEq(updatedRoot, newRoot.address, "root 地址应更新");
    console.log(`     新 root: ${updatedRoot}`);

    // 恢复原 root，避免影响后续测试
    await staking.connect(deployer).setRootAddress(oldRoot);
    const restoredRoot = await staking.getRootAddress();
    assertEq(restoredRoot, oldRoot, "root 地址应恢复");
  });

  // =========================================================================
  // 8.2 setAE - owner 设置 AE 代币合约地址
  // =========================================================================
  await runner.run("8.2", "setAE - owner 设置 AE 代币合约地址", async () => {
    const currentAE = await staking.AE();
    console.log(`     当前 AE 地址: ${currentAE}`);

    // setAE 内部会调用 AE.approve(router)，所以新地址必须是合约
    // 用当前 AE 地址重新设置来验证功能和事件
    const innerSnapshot = await takeSnapshot();

    const tx = await staking.connect(deployer).setAE(currentAE);
    const receipt = await tx.wait();

    // 验证 AEContractSet 事件
    const evt = receipt.logs.find((l) => {
      try { return staking.interface.parseLog(l)?.name === "AEContractSet"; }
      catch { return false; }
    });
    assert(evt, "应触发 AEContractSet 事件");
    const parsed = staking.interface.parseLog(evt);
    assertEq(parsed.args.aeAddress, currentAE, "事件中 AE 地址应正确");
    console.log(`     AEContractSet 事件验证通过`);

    // 验证零地址应 revert
    let reverted = false;
    try { await staking.connect(deployer).setAE(hre.ethers.ZeroAddress); }
    catch (e) { reverted = true; }
    assert(reverted, "零地址应 revert");

    // 恢复快照
    await revertSnapshot(innerSnapshot);
  });

  // =========================================================================
  // 8.3 setFeeRecipient - owner 更新赎回费接收地址
  // =========================================================================
  await runner.run("8.3", "setFeeRecipient - owner 更新赎回费接收地址", async () => {
    const oldFeeRecipient = await staking.feeRecipient();
    console.log(`     旧 feeRecipient: ${oldFeeRecipient}`);

    const tx = await staking.connect(deployer).setFeeRecipient(newFeeRecipient.address);
    const receipt = await tx.wait();

    const updatedFeeRecipient = await staking.feeRecipient();
    assertEq(updatedFeeRecipient, newFeeRecipient.address, "feeRecipient 应更新");
    console.log(`     新 feeRecipient: ${updatedFeeRecipient}`);

    // 验证 FeeRecipientUpdated 事件
    const evt = receipt.logs.find((l) => {
      try { return staking.interface.parseLog(l)?.name === "FeeRecipientUpdated"; }
      catch { return false; }
    });
    assert(evt, "应触发 FeeRecipientUpdated 事件");
    const parsed = staking.interface.parseLog(evt);
    assertEq(parsed.args.oldRecipient, oldFeeRecipient, "旧地址应正确");
    assertEq(parsed.args.newRecipient, newFeeRecipient.address, "新地址应正确");

    // 恢复原 feeRecipient
    await staking.connect(deployer).setFeeRecipient(oldFeeRecipient);
  });

  // =========================================================================
  // 8.4 emergencyWithdrawAE - owner 紧急提取 AE 代币
  // =========================================================================
  await runner.run("8.4", "emergencyWithdrawAE - owner 紧急提取 AE 代币", async () => {
    const stakingAEBefore = await ae.balanceOf(stakingAddress);
    const targetAEBefore = await ae.balanceOf(withdrawTarget.address);
    const withdrawAmount = parseEther("1000");

    assert(stakingAEBefore >= withdrawAmount, "质押合约应有足够 AE");
    console.log(`     质押合约 AE 余额: ${formatEther(stakingAEBefore)}`);

    await staking.connect(deployer).emergencyWithdrawAE(withdrawTarget.address, withdrawAmount);

    const stakingAEAfter = await ae.balanceOf(stakingAddress);
    const targetAEAfter = await ae.balanceOf(withdrawTarget.address);

    assertEq(stakingAEBefore - stakingAEAfter, withdrawAmount, "质押合约 AE 应减少");
    assertEq(targetAEAfter - targetAEBefore, withdrawAmount, "目标地址 AE 应增加");
    console.log(`     提取 ${formatEther(withdrawAmount)} AE 到 ${withdrawTarget.address}`);
  });

  // =========================================================================
  // 8.5 emergencyWithdrawUSDX - owner 紧急提取 USDX 代币
  // =========================================================================
  await runner.run("8.5", "emergencyWithdrawUSDX - owner 紧急提取 USDX 代币", async () => {
    // 先给质押合约一些 USDX
    await setUSDXBalance(stakingAddress, parseEther("5000"));
    const stakingUSDXBefore = await usdx.balanceOf(stakingAddress);
    const targetUSDXBefore = await usdx.balanceOf(withdrawTarget.address);
    const withdrawAmount = parseEther("2000");

    assert(stakingUSDXBefore >= withdrawAmount, "质押合约应有足够 USDX");
    console.log(`     质押合约 USDX 余额: ${formatEther(stakingUSDXBefore)}`);

    await staking.connect(deployer).emergencyWithdrawUSDX(withdrawTarget.address, withdrawAmount);

    const stakingUSDXAfter = await usdx.balanceOf(stakingAddress);
    const targetUSDXAfter = await usdx.balanceOf(withdrawTarget.address);

    assertEq(stakingUSDXBefore - stakingUSDXAfter, withdrawAmount, "质押合约 USDX 应减少");
    assertEq(targetUSDXAfter - targetUSDXBefore, withdrawAmount, "目标地址 USDX 应增加");
    console.log(`     提取 ${formatEther(withdrawAmount)} USDX 到 ${withdrawTarget.address}`);
  });

  // =========================================================================
  // 8.6 reset7DayStakeUsage - owner 重置用户 7 天质押使用记录
  // =========================================================================
  await runner.run("8.6", "reset7DayStakeUsage - owner 重置用户 7 天质押使用记录", async () => {
    // 先让用户进行一次 7 天质押，使 hasUsed7DayStake 变为 true
    await setUSDXBalance(userForReset.address, parseEther("10000"));
    await approveUSDX(usdx, userForReset, stakingAddress, parseEther("10000"));
    await staking.connect(userForReset).lockReferral(rootAddress);
    await staking.connect(userForReset).stake(parseEther("100"), 0); // index 0 = 7天

    const usedBefore = await staking.has7DayStakeBeenUsed(userForReset.address);
    assert(usedBefore === true, "7 天质押应已使用");

    const tx = await staking.connect(deployer).reset7DayStakeUsage(userForReset.address);
    const receipt = await tx.wait();

    const usedAfter = await staking.has7DayStakeBeenUsed(userForReset.address);
    assert(usedAfter === false, "7 天质押使用记录应已重置");

    // 验证 Stake7DayUsageReset 事件
    const evt = receipt.logs.find((l) => {
      try { return staking.interface.parseLog(l)?.name === "Stake7DayUsageReset"; }
      catch { return false; }
    });
    assert(evt, "应触发 Stake7DayUsageReset 事件");
    const parsed = staking.interface.parseLog(evt);
    assertEq(parsed.args.user, userForReset.address, "事件中用户地址应正确");
  });

  // =========================================================================
  // 8.7 batchReset7DayStakeUsage - 批量重置 7 天质押使用记录
  // =========================================================================
  await runner.run("8.7", "batchReset7DayStakeUsage - 批量重置 7 天质押使用记录", async () => {
    const batchUsers = [userForBatchReset1, userForBatchReset2, userForBatchReset3];

    // 为每个用户设置余额、授权、绑定推荐人、进行 7 天质押
    for (const u of batchUsers) {
      await setUSDXBalance(u.address, parseEther("10000"));
      await approveUSDX(usdx, u, stakingAddress, parseEther("10000"));
      await staking.connect(u).lockReferral(rootAddress);
      await staking.connect(u).stake(parseEther("100"), 0); // 7天质押
    }

    // 验证全部已使用
    for (const u of batchUsers) {
      const used = await staking.has7DayStakeBeenUsed(u.address);
      assert(used === true, `${u.address} 7 天质押应已使用`);
    }

    const addresses = batchUsers.map((u) => u.address);
    const tx = await staking.connect(deployer).batchReset7DayStakeUsage(addresses);
    const receipt = await tx.wait();

    // 验证全部已重置
    for (const u of batchUsers) {
      const used = await staking.has7DayStakeBeenUsed(u.address);
      assert(used === false, `${u.address} 7 天质押使用记录应已重置`);
    }

    // 验证事件数量
    const resetEvents = receipt.logs.filter((l) => {
      try { return staking.interface.parseLog(l)?.name === "Stake7DayUsageReset"; }
      catch { return false; }
    });
    assertEq(resetEvents.length, batchUsers.length, `应触发 ${batchUsers.length} 个 Stake7DayUsageReset 事件`);
  });

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
