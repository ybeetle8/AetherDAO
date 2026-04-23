/**
 * 模块 4：推荐人绑定 (lockReferral / adminBindReferral) - 第二部分
 * 测试项 4.9 ~ 4.16
 */
const hre = require("hardhat");
const {
  loadDeployment,
  getContracts,
  TestRunner,
  assert,
  assertEq,
} = require("../helpers/setup");
const { takeSnapshot, revertSnapshot } = require("../helpers/time");

function errorContains(error, keyword) {
  return (error.message || "").includes(keyword);
}

async function createFundedWallet() {
  const wallet = hre.ethers.Wallet.createRandom().connect(hre.ethers.provider);
  const [funder] = await hre.ethers.getSigners();
  await funder.sendTransaction({ to: wallet.address, value: hre.ethers.parseEther("1") });
  return wallet;
}

async function main() {
  console.log("\n=== 模块 4：推荐人绑定 测试 - 第二部分 (4.9~4.16) ===\n");

  const snapshotId = await takeSnapshot();

  const deployment = loadDeployment();
  const { staking } = await getContracts(deployment);
  const [deployer, ...accounts] = await hre.ethers.getSigners();
  const rootAddress = deployment.addresses.rootAddress;

  console.log("  准备测试钱包...");
  const wallets = [];
  for (let i = 0; i < 6; i++) {
    wallets.push(await createFundedWallet());
  }
  const [userA, userB, userC, userD, userE, nonOwner] = wallets;
  console.log("  钱包准备完成\n");

  // 用于 4.16 批量测试的额外钱包
  const batchWallets = [];
  for (let i = 0; i < 3; i++) {
    batchWallets.push(await createFundedWallet());
  }
  const [batchU1, batchU2, batchU3] = batchWallets;

  const runner = new TestRunner("模块 4：推荐人绑定 - 第二部分");
  const getReferralsUint8 = staking.getFunction("getReferrals(address,uint8)");

  // =========================================================================
  // 4.9 Root 地址作为推荐人
  // =========================================================================
  await runner.run("4.9", "Root 地址作为推荐人", async () => {
    const tx = await staking.connect(userA).lockReferral(rootAddress);
    await tx.wait();
    assert(await staking.isBindReferral(userA.address), "应绑定成功");
    assertEq(
      (await staking.getReferral(userA.address)).toLowerCase(),
      rootAddress.toLowerCase(),
      "推荐人应为 root"
    );
  });

  // =========================================================================
  // 4.10 非 owner 调用 adminBindReferral 应 revert
  // =========================================================================
  await runner.run("4.10", "非 owner 调用 adminBindReferral 应 revert", async () => {
    let reverted = false;
    try {
      await staking.connect(nonOwner).adminBindReferral(userB.address, rootAddress);
    } catch (e) {
      reverted = true;
      assert(
        errorContains(e, "OwnableUnauthorizedAccount") || errorContains(e, "caller is not the owner"),
        "应权限错误"
      );
    }
    assert(reverted, "非 owner 应 revert");
  });

  // =========================================================================
  // 4.11 ReferralBound 事件验证
  // =========================================================================
  await runner.run("4.11", "ReferralBound 事件验证", async () => {
    const tx = await staking.connect(userB).lockReferral(rootAddress);
    const receipt = await tx.wait();

    const evt = receipt.logs.find((l) => {
      try { return staking.interface.parseLog(l)?.name === "ReferralBound"; } catch { return false; }
    });
    assert(evt, "应触发 ReferralBound 事件");
    const parsed = staking.interface.parseLog(evt);
    assertEq(parsed.args.user.toLowerCase(), userB.address.toLowerCase(), "user 参数正确");
    assertEq(parsed.args.referrer.toLowerCase(), rootAddress.toLowerCase(), "referrer 参数正确");
    assert(parsed.args.timestamp > 0n, "timestamp 应大于 0");
  });

  // =========================================================================
  // 4.12 AdminReferralBound 事件验证
  // =========================================================================
  await runner.run("4.12", "AdminReferralBound 事件验证", async () => {
    const tx = await staking.connect(deployer).adminBindReferral(userC.address, rootAddress);
    const receipt = await tx.wait();

    const evt = receipt.logs.find((l) => {
      try { return staking.interface.parseLog(l)?.name === "AdminReferralBound"; } catch { return false; }
    });
    assert(evt, "应触发 AdminReferralBound 事件");
    const parsed = staking.interface.parseLog(evt);
    assertEq(parsed.args.user.toLowerCase(), userC.address.toLowerCase(), "user 参数正确");
    assertEq(parsed.args.referrer.toLowerCase(), rootAddress.toLowerCase(), "referrer 参数正确");
    assertEq(parsed.args.admin.toLowerCase(), deployer.address.toLowerCase(), "admin 参数正确");
    assert(parsed.args.timestamp > 0n, "timestamp 应大于 0");
  });

  // =========================================================================
  // 4.13 getReferral 查询
  // =========================================================================
  await runner.run("4.13", "getReferral 查询", async () => {
    assertEq(
      (await staking.getReferral(userA.address)).toLowerCase(),
      rootAddress.toLowerCase(),
      "userA 推荐人应为 root"
    );
    assertEq(
      (await staking.getReferral(userC.address)).toLowerCase(),
      rootAddress.toLowerCase(),
      "userC 推荐人应为 root"
    );
    // 未绑定用户应返回零地址
    assertEq(
      await staking.getReferral(userD.address),
      hre.ethers.ZeroAddress,
      "未绑定用户应返回零地址"
    );
  });

  // =========================================================================
  // 4.14 isBindReferral 查询
  // =========================================================================
  await runner.run("4.14", "isBindReferral 查询", async () => {
    assert(await staking.isBindReferral(userA.address), "userA 已绑定应返回 true");
    assert(await staking.isBindReferral(userB.address), "userB 已绑定应返回 true");
    assert(!(await staking.isBindReferral(userD.address)), "userD 未绑定应返回 false");
    assert(!(await staking.isBindReferral(userE.address)), "userE 未绑定应返回 false");
  });

  // =========================================================================
  // 4.15 getReferrals 链查询
  // =========================================================================
  await runner.run("4.15", "getReferrals 链查询", async () => {
    // 构建多级链: userD -> userC -> root
    await staking.connect(userD).lockReferral(userC.address);
    // 再加一级: userE -> userD -> userC -> root
    await staking.connect(userE).lockReferral(userD.address);

    const chain = await getReferralsUint8(userE.address, 10);
    assert(chain.length >= 3, `链长度应>=3, 实际 ${chain.length}`);
    assertEq(chain[0].toLowerCase(), userD.address.toLowerCase(), "第1级: userD");
    assertEq(chain[1].toLowerCase(), userC.address.toLowerCase(), "第2级: userC");
    assertEq(chain[2].toLowerCase(), rootAddress.toLowerCase(), "第3级: root");

    // 验证 maxDepth=2 截断
    const chain2 = await getReferralsUint8(userE.address, 2);
    assertEq(chain2.length, 2, "maxDepth=2 应返回2个");
    assertEq(chain2[0].toLowerCase(), userD.address.toLowerCase(), "截断后第1级: userD");
    assertEq(chain2[1].toLowerCase(), userC.address.toLowerCase(), "截断后第2级: userC");
  });

  // =========================================================================
  // 4.16 批量绑定数组长度不匹配应 revert
  // =========================================================================
  await runner.run("4.16", "批量绑定数组长度不匹配应 revert", async () => {
    const users3 = [batchU1.address, batchU2.address, batchU3.address];
    const referrers2 = [rootAddress, rootAddress]; // 长度不匹配

    let reverted = false;
    try {
      await staking.connect(deployer).batchAdminBindReferral(users3, referrers2);
    } catch (e) {
      reverted = true;
      assert(errorContains(e, "Length mismatch") || errorContains(e, "mismatch"), "应 Length mismatch");
    }
    assert(reverted, "数组长度不匹配应 revert");
  });

  const allPassed = runner.summary();
  await revertSnapshot(snapshotId);
  if (!allPassed) process.exit(1);
}

main()
  .then(() => process.exit(0))
  .catch((error) => { console.error(error); process.exit(1); });
