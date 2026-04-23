/**
 * 模块 4：推荐人绑定 (lockReferral / adminBindReferral) - 第一部分
 * 测试项 4.1 ~ 4.8
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

/** 创建一个有 ETH 的随机钱包（用于 gas） */
async function createFundedWallet() {
  const wallet = hre.ethers.Wallet.createRandom().connect(hre.ethers.provider);
  const [funder] = await hre.ethers.getSigners();
  await funder.sendTransaction({ to: wallet.address, value: hre.ethers.parseEther("1") });
  return wallet;
}

async function main() {
  console.log("\n=== 模块 4：推荐人绑定 测试 - 第一部分 (4.1~4.8) ===\n");

  const snapshotId = await takeSnapshot();

  const deployment = loadDeployment();
  const { staking } = await getContracts(deployment);
  const [deployer] = await hre.ethers.getSigners();
  const rootAddress = deployment.addresses.rootAddress;

  // 使用随机钱包确保全新状态（顺序创建避免 nonce 冲突）
  console.log("  准备测试钱包...");
  const wallets = [];
  for (let i = 0; i < 8; i++) {
    wallets.push(await createFundedWallet());
  }
  const [userA, userB, userC, userD, userE, userF, userG, userH] = wallets;
  console.log("  钱包准备完成\n");

  const runner = new TestRunner("模块 4：推荐人绑定 - 第一部分");

  // =========================================================================
  // 4.1 用户自主绑定推荐人
  // =========================================================================
  await runner.run("4.1", "用户自主绑定推荐人", async () => {
    assert(!(await staking.isBindReferral(userA.address)), "绑定前应为 false");
    const tx = await staking.connect(userA).lockReferral(rootAddress);
    const receipt = await tx.wait();

    assert(await staking.isBindReferral(userA.address), "绑定后应为 true");
    const ref = await staking.getReferral(userA.address);
    assertEq(ref.toLowerCase(), rootAddress.toLowerCase(), "推荐人应为 root");

    // 验证 ReferralBound 事件
    const evt = receipt.logs.find((l) => {
      try { return staking.interface.parseLog(l)?.name === "ReferralBound"; } catch { return false; }
    });
    assert(evt, "应触发 ReferralBound 事件");
    const parsed = staking.interface.parseLog(evt);
    assertEq(parsed.args.user.toLowerCase(), userA.address.toLowerCase(), "事件 user 正确");
    assertEq(parsed.args.referrer.toLowerCase(), rootAddress.toLowerCase(), "事件 referrer 正确");
  });

  // =========================================================================
  // 4.2 管理员绑定推荐人
  // =========================================================================
  await runner.run("4.2", "管理员绑定推荐人", async () => {
    assert(!(await staking.isBindReferral(userB.address)), "绑定前应为 false");
    const tx = await staking.connect(deployer).adminBindReferral(userB.address, rootAddress);
    const receipt = await tx.wait();

    assert(await staking.isBindReferral(userB.address), "绑定后应为 true");
    assertEq(
      (await staking.getReferral(userB.address)).toLowerCase(),
      rootAddress.toLowerCase(),
      "推荐人应为 root"
    );

    const evt = receipt.logs.find((l) => {
      try { return staking.interface.parseLog(l)?.name === "AdminReferralBound"; } catch { return false; }
    });
    assert(evt, "应触发 AdminReferralBound 事件");
    const parsed = staking.interface.parseLog(evt);
    assertEq(parsed.args.user.toLowerCase(), userB.address.toLowerCase(), "事件 user 正确");
    assertEq(parsed.args.referrer.toLowerCase(), rootAddress.toLowerCase(), "事件 referrer 正确");
    assertEq(parsed.args.admin.toLowerCase(), deployer.address.toLowerCase(), "事件 admin 正确");
  });

  // =========================================================================
  // 4.3 批量管理员绑定
  // =========================================================================
  await runner.run("4.3", "批量管理员绑定", async () => {
    const batchUsers = [userC.address, userD.address, userE.address];
    const batchReferrers = [rootAddress, rootAddress, rootAddress];

    const tx = await staking.connect(deployer).batchAdminBindReferral(batchUsers, batchReferrers);
    await tx.wait();

    for (const addr of batchUsers) {
      assert(await staking.isBindReferral(addr), `${addr.slice(0,10)} 应已绑定`);
      assertEq(
        (await staking.getReferral(addr)).toLowerCase(),
        rootAddress.toLowerCase(),
        `${addr.slice(0,10)} 推荐人应为 root`
      );
    }
  });

  // =========================================================================
  // 4.4 不可重复绑定
  // =========================================================================
  await runner.run("4.4", "不可重复绑定", async () => {
    // userA 已在 4.1 绑定
    let reverted = false;
    try {
      await staking.connect(userA).lockReferral(rootAddress);
    } catch (e) {
      reverted = true;
      assert(errorContains(e, "AlreadyBound"), "应 AlreadyBound");
    }
    assert(reverted, "重复绑定应 revert");
  });

  // =========================================================================
  // 4.5 不可自我推荐
  // =========================================================================
  await runner.run("4.5", "不可自我推荐", async () => {
    // userF 是全新钱包，未绑定
    let reverted = false;
    try {
      await staking.connect(userF).lockReferral(userF.address);
    } catch (e) {
      reverted = true;
      assert(errorContains(e, "CannotReferSelf"), "应 CannotReferSelf");
    }
    assert(reverted, "自我推荐应 revert");
  });

  // =========================================================================
  // 4.6 推荐人必须已绑定（非 root）
  // =========================================================================
  await runner.run("4.6", "推荐人必须已绑定", async () => {
    // userH 未绑定，用 userH 作为推荐人应失败
    assert(!(await staking.isBindReferral(userH.address)), "userH 不应已绑定");
    let reverted = false;
    try {
      await staking.connect(userF).lockReferral(userH.address);
    } catch (e) {
      reverted = true;
      assert(errorContains(e, "InvalidReferrer"), "应 InvalidReferrer");
    }
    assert(reverted, "未绑定推荐人应 revert");
  });

  // =========================================================================
  // 4.7 循环引用检测
  // =========================================================================
  await runner.run("4.7", "循环引用检测", async () => {
    // 构建链: root <- userA <- userF <- userG
    // userF 绑定到 userA（userA 已绑定 root）
    await staking.connect(userF).lockReferral(userA.address);
    assert(await staking.isBindReferral(userF.address), "userF 应已绑定到 userA");

    // userG 绑定到 userF
    await staking.connect(userG).lockReferral(userF.address);
    assert(await staking.isBindReferral(userG.address), "userG 应已绑定到 userF");

    // 尝试让 userA 再绑定到 userG（循环）—— userA 已绑定，应 AlreadyBound
    let reverted = false;
    try {
      await staking.connect(deployer).adminBindReferral(userA.address, userG.address);
    } catch (e) {
      reverted = true;
      // 合约通过 AlreadyBound 阻止了循环（已绑定的用户不能重新绑定）
      assert(errorContains(e, "AlreadyBound"), "应 AlreadyBound 阻止循环");
    }
    assert(reverted, "循环引用应被阻止");
  });

  // =========================================================================
  // 4.8 推荐链深度限制 / getReferrals 查询
  // =========================================================================
  await runner.run("4.8", "推荐链深度限制", async () => {
    // 已有链: root <- userA <- userF <- userG
    // 使用显式函数签名避免 ambiguous overload
    const getReferralsUint8 = staking.getFunction("getReferrals(address,uint8)");

    const chain = await getReferralsUint8(userG.address, 30);
    // userG -> userF -> userA -> root
    assert(chain.length >= 3, `推荐链长度应>=3, 实际 ${chain.length}`);
    assertEq(chain[0].toLowerCase(), userF.address.toLowerCase(), "第1级应为 userF");
    assertEq(chain[1].toLowerCase(), userA.address.toLowerCase(), "第2级应为 userA");
    assertEq(chain[2].toLowerCase(), rootAddress.toLowerCase(), "第3级应为 root");

    // 测试 maxDepth=1 只返回直接推荐人
    const chain1 = await getReferralsUint8(userG.address, 1);
    assertEq(chain1.length, 1, "maxDepth=1 应只返回1个");
    assertEq(chain1[0].toLowerCase(), userF.address.toLowerCase(), "应为直接推荐人 userF");
  });

  const allPassed = runner.summary();
  await revertSnapshot(snapshotId);
  if (!allPassed) process.exit(1);
}

main()
  .then(() => process.exit(0))
  .catch((error) => { console.error(error); process.exit(1); });
