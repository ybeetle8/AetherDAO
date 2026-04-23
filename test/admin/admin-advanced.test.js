/**
 * 模块 8：管理员功能测试 - 第二部分
 * 测试项 8.8 ~ 8.10
 *
 * 8.8 非 owner 调用管理功能应 revert
 * 8.9 FeeRecipientUpdated 事件验证（已在 8.3 中覆盖，此处做独立验证）
 * 8.10 7 天重置后可再次质押
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
const { advanceTimeSeconds, takeSnapshot, revertSnapshot } = require("../helpers/time");

function errorContains(error, keyword) {
  return (error.message || "").includes(keyword);
}

async function main() {
  console.log("\n=== 模块 8：管理员功能测试 - 第二部分 (8.8~8.10) ===\n");

  const snapshotId = await takeSnapshot();

  const deployment = loadDeployment();
  const { ae, staking, usdx } = await getContracts(deployment);
  const [deployer, ...accounts] = await hre.ethers.getSigners();
  const stakingAddress = deployment.contracts.Staking;
  const rootAddress = deployment.addresses.rootAddress;
  const parseEther = hre.ethers.parseEther;
  const formatEther = hre.ethers.formatEther;

  const runner = new TestRunner("模块 8：管理员功能 - 第二部分");

  // 非 owner 用户
  const attacker = accounts[14];
  const dummyAddr = accounts[15];
  const userFor810 = accounts[16];

  // =========================================================================
  // 8.8 非 owner 调用管理功能应 revert
  // =========================================================================

  // 8.8a setRootAddress
  await runner.run("8.8a", "非 owner 调用 setRootAddress 应 revert", async () => {
    let reverted = false;
    try {
      await staking.connect(attacker).setRootAddress(attacker.address);
    } catch (e) {
      reverted = true;
      assert(
        errorContains(e, "OwnableUnauthorizedAccount") || errorContains(e, "caller is not the owner"),
        "应为权限错误"
      );
    }
    assert(reverted, "应 revert");
  });

  // 8.8b setAE
  await runner.run("8.8b", "非 owner 调用 setAE 应 revert", async () => {
    let reverted = false;
    try {
      await staking.connect(attacker).setAE(attacker.address);
    } catch (e) {
      reverted = true;
      assert(
        errorContains(e, "OwnableUnauthorizedAccount") || errorContains(e, "caller is not the owner"),
        "应为权限错误"
      );
    }
    assert(reverted, "应 revert");
  });

  // 8.8c setFeeRecipient
  await runner.run("8.8c", "非 owner 调用 setFeeRecipient 应 revert", async () => {
    let reverted = false;
    try {
      await staking.connect(attacker).setFeeRecipient(attacker.address);
    } catch (e) {
      reverted = true;
      assert(
        errorContains(e, "OwnableUnauthorizedAccount") || errorContains(e, "caller is not the owner"),
        "应为权限错误"
      );
    }
    assert(reverted, "应 revert");
  });

  // 8.8d emergencyWithdrawAE
  await runner.run("8.8d", "非 owner 调用 emergencyWithdrawAE 应 revert", async () => {
    let reverted = false;
    try {
      await staking.connect(attacker).emergencyWithdrawAE(attacker.address, parseEther("1"));
    } catch (e) {
      reverted = true;
      assert(
        errorContains(e, "OwnableUnauthorizedAccount") || errorContains(e, "caller is not the owner"),
        "应为权限错误"
      );
    }
    assert(reverted, "应 revert");
  });

  // 8.8e emergencyWithdrawUSDX
  await runner.run("8.8e", "非 owner 调用 emergencyWithdrawUSDX 应 revert", async () => {
    let reverted = false;
    try {
      await staking.connect(attacker).emergencyWithdrawUSDX(attacker.address, parseEther("1"));
    } catch (e) {
      reverted = true;
      assert(
        errorContains(e, "OwnableUnauthorizedAccount") || errorContains(e, "caller is not the owner"),
        "应为权限错误"
      );
    }
    assert(reverted, "应 revert");
  });

  // 8.8f reset7DayStakeUsage
  await runner.run("8.8f", "非 owner 调用 reset7DayStakeUsage 应 revert", async () => {
    let reverted = false;
    try {
      await staking.connect(attacker).reset7DayStakeUsage(dummyAddr.address);
    } catch (e) {
      reverted = true;
      assert(
        errorContains(e, "OwnableUnauthorizedAccount") || errorContains(e, "caller is not the owner"),
        "应为权限错误"
      );
    }
    assert(reverted, "应 revert");
  });

  // 8.8g batchReset7DayStakeUsage
  await runner.run("8.8g", "非 owner 调用 batchReset7DayStakeUsage 应 revert", async () => {
    let reverted = false;
    try {
      await staking.connect(attacker).batchReset7DayStakeUsage([dummyAddr.address]);
    } catch (e) {
      reverted = true;
      assert(
        errorContains(e, "OwnableUnauthorizedAccount") || errorContains(e, "caller is not the owner"),
        "应为权限错误"
      );
    }
    assert(reverted, "应 revert");
  });

  // =========================================================================
  // 8.9 FeeRecipientUpdated 事件独立验证
  // =========================================================================
  await runner.run("8.9", "FeeRecipientUpdated 事件参数验证", async () => {
    const oldFeeRecipient = await staking.feeRecipient();
    const newAddr = dummyAddr.address;

    const tx = await staking.connect(deployer).setFeeRecipient(newAddr);
    const receipt = await tx.wait();

    const evt = receipt.logs.find((l) => {
      try { return staking.interface.parseLog(l)?.name === "FeeRecipientUpdated"; }
      catch { return false; }
    });
    assert(evt, "应触发 FeeRecipientUpdated 事件");

    const parsed = staking.interface.parseLog(evt);
    assertEq(parsed.args.oldRecipient, oldFeeRecipient, "oldRecipient 应为旧地址");
    assertEq(parsed.args.newRecipient, newAddr, "newRecipient 应为新地址");
    console.log(`     事件: ${oldFeeRecipient} -> ${newAddr}`);

    // 恢复
    await staking.connect(deployer).setFeeRecipient(oldFeeRecipient);
  });

  // =========================================================================
  // 8.10 7 天重置后可再次质押
  // =========================================================================
  await runner.run("8.10", "7 天重置后可再次质押", async () => {
    // 准备用户
    await setUSDXBalance(userFor810.address, parseEther("10000"));
    await approveUSDX(usdx, userFor810, stakingAddress, parseEther("10000"));
    await staking.connect(userFor810).lockReferral(rootAddress);

    // 第一次 7 天质押
    await staking.connect(userFor810).stake(parseEther("100"), 0); // index 0 = 7天
    const usedAfterFirst = await staking.has7DayStakeBeenUsed(userFor810.address);
    assert(usedAfterFirst === true, "第一次 7 天质押后应标记已使用");

    // 第二次 7 天质押应失败
    let reverted = false;
    try {
      await staking.connect(userFor810).stake(parseEther("100"), 0);
    } catch (e) {
      reverted = true;
    }
    assert(reverted, "第二次 7 天质押应 revert");

    // owner 重置
    await staking.connect(deployer).reset7DayStakeUsage(userFor810.address);
    const usedAfterReset = await staking.has7DayStakeBeenUsed(userFor810.address);
    assert(usedAfterReset === false, "重置后应为 false");

    // 推进时间，避免近期流入限制
    await advanceTimeSeconds(120);

    // 第三次 7 天质押应成功
    const countBefore = Number(await staking.stakeCount(userFor810.address));
    await staking.connect(userFor810).stake(parseEther("100"), 0);
    const countAfter = Number(await staking.stakeCount(userFor810.address));
    assertEq(countAfter, countBefore + 1, "重置后应可再次 7 天质押");

    const usedAfterThird = await staking.has7DayStakeBeenUsed(userFor810.address);
    assert(usedAfterThird === true, "再次质押后应标记已使用");
    console.log("     7天质押 -> 重置 -> 再次7天质押 流程验证通过");
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
