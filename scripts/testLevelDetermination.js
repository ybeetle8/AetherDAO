const hre = require("hardhat");
const { ethers } = require("hardhat");

// 加载部署配置
const deploymentConfig = require("../ae-deployment-config.json");
const deployment = require("../ae-deployment.json");

// USDX 稳定币地址
const USDX_ADDRESS = deploymentConfig.addresses.usdx;

// 级别阈值配置
const LEVEL_THRESHOLDS = [
    { level: 1, team: 3000, personal: 1000 },
    { level: 2, team: 10000, personal: 3000 },
    { level: 3, team: 30000, personal: 10000 },
    { level: 4, team: 100000, personal: 30000 },
    { level: 5, team: 300000, personal: 100000 },
    { level: 6, team: 1000000, personal: 300000 },
    { level: 7, team: 3000000, personal: 1000000 },
    { level: 8, team: 10000000, personal: 3000000 },
    { level: 9, team: 30000000, personal: 10000000 }
];

// 辅助函数：格式化 USDX 金额
function formatUSDX(amount) {
    return ethers.parseUnits(amount.toString(), 18);
}

// 辅助函数：为地址分配 USDX (使用存储槽修改)
async function allocateUSDX(address, amount) {
    // BSC USDX 使用槽位 9 存储余额
    const slot = 9;
    const accountPadded = ethers.zeroPadValue(address, 32);
    const slotPadded = ethers.zeroPadValue(ethers.toBeHex(slot), 32);
    const storageSlot = ethers.keccak256(accountPadded + slotPadded.slice(2));

    // 设置余额
    await hre.network.provider.send("hardhat_setStorageAt", [
        USDX_ADDRESS,
        storageSlot,
        ethers.zeroPadValue(ethers.toBeHex(amount), 32)
    ]);

    // 挖一个区块确保状态更新
    await hre.network.provider.send("evm_mine", []);
}

// 辅助函数：创建测试用户并质押
async function createUserAndStake(stakingContract, usdcContract, amount) {
    const wallet = ethers.Wallet.createRandom().connect(ethers.provider);

    // 分配 BNB 用于 gas
    const [deployer] = await ethers.getSigners();
    await deployer.sendTransaction({
        to: wallet.address,
        value: ethers.parseEther("1")
    });

    // 分配 USDX
    await allocateUSDX(wallet.address, amount);

    // 授权并质押
    await usdcContract.connect(wallet).approve(stakingContract.target, amount);
    await stakingContract.connect(wallet).stake(amount, 0); // 0 = 7天期

    return wallet;
}

// 辅助函数：构建团队结构
async function buildTeamStructure(stakingContract, usdcContract, root, teamAmount, personalAmount) {
    // root 质押个人金额
    await usdcContract.connect(root).approve(stakingContract.target, personalAmount);
    await stakingContract.connect(root).stake(personalAmount, 0);

    // 创建下级用户来达到团队金额
    let remainingTeamAmount = teamAmount;
    const directReferrals = [];

    while (remainingTeamAmount > 0n) {
        // 每个下级质押一定金额
        const stakeAmount = remainingTeamAmount > formatUSDX(10000)
            ? formatUSDX(10000)
            : remainingTeamAmount;

        const referral = await createUserAndStake(stakingContract, usdcContract, stakeAmount);

        // 绑定推荐关系
        await stakingContract.connect(referral).bindReferrer(root.address);

        directReferrals.push(referral);
        remainingTeamAmount -= stakeAmount;
    }

    return directReferrals;
}

// 测试函数：验证级别判定
async function testLevelDetermination(level, teamAmount, personalAmount, expectedLevel) {
    console.log(`\n测试 V${level}: 团队 ${teamAmount} + 个人 ${personalAmount}`);

    const stakingContract = await ethers.getContractAt("Staking", deployment.contracts.Staking);
    const usdcContract = await ethers.getContractAt(
        ["function transfer(address to, uint256 amount) returns (bool)",
         "function balanceOf(address) view returns (uint256)",
         "function approve(address spender, uint256 amount) returns (bool)"],
        USDX_ADDRESS
    );

    // 创建测试用户
    const user = ethers.Wallet.createRandom().connect(ethers.provider);

    // 分配 BNB
    const [deployer] = await ethers.getSigners();
    await deployer.sendTransaction({
        to: user.address,
        value: ethers.parseEther("2")
    });

    // 分配 USDX (团队金额 + 个人金额)
    const totalAmount = formatUSDX(teamAmount + personalAmount);
    await allocateUSDX(user.address, totalAmount);

    console.log(`  用户地址: ${user.address}`);
    console.log(`  USDX 余额: ${ethers.formatUnits(await usdcContract.balanceOf(user.address), 18)}`);

    // 构建团队结构
    await buildTeamStructure(
        stakingContract,
        usdcContract,
        user,
        formatUSDX(teamAmount),
        formatUSDX(personalAmount)
    );

    // 获取用户级别
    const userLevel = await stakingContract.getUserLevel(user.address);

    console.log(`  预期级别: V${expectedLevel}`);
    console.log(`  实际级别: V${userLevel}`);

    if (userLevel === BigInt(expectedLevel)) {
        console.log(`  ✅ 测试通过`);
        return true;
    } else {
        console.log(`  ❌ 测试失败`);
        return false;
    }
}

// 测试函数：验证取较小值逻辑
async function testMinLevelLogic() {
    console.log(`\n测试取较小值逻辑: 团队达 V3 (30000) 但个人只达 V1 (1000)`);

    const stakingContract = await ethers.getContractAt("Staking", deployment.contracts.Staking);
    const usdcContract = await ethers.getContractAt(
        ["function transfer(address to, uint256 amount) returns (bool)",
         "function balanceOf(address) view returns (uint256)",
         "function approve(address spender, uint256 amount) returns (bool)"],
        USDX_ADDRESS
    );

    // 创建测试用户
    const user = ethers.Wallet.createRandom().connect(ethers.provider);

    // 分配 BNB
    const [deployer] = await ethers.getSigners();
    await deployer.sendTransaction({
        to: user.address,
        value: ethers.parseEther("2")
    });

    // 分配 USDX
    const totalAmount = formatUSDX(30000 + 1000);
    await allocateUSDX(user.address, totalAmount);

    console.log(`  用户地址: ${user.address}`);

    // 构建团队: 团队 30000 (达到 V3), 个人 1000 (只达到 V1)
    await buildTeamStructure(
        stakingContract,
        usdcContract,
        user,
        formatUSDX(30000),
        formatUSDX(1000)
    );

    // 获取用户级别
    const userLevel = await stakingContract.getUserLevel(user.address);

    console.log(`  团队金额达标: V3 (30000)`);
    console.log(`  个人金额达标: V1 (1000)`);
    console.log(`  预期级别: V1 (取较小值)`);
    console.log(`  实际级别: V${userLevel}`);

    if (userLevel === 1n) {
        console.log(`  ✅ 测试通过`);
        return true;
    } else {
        console.log(`  ❌ 测试失败`);
        return false;
    }
}

async function main() {
    console.log("=".repeat(80));
    console.log("级别判定测试");
    console.log("=".repeat(80));

    const results = [];

    // 测试所有级别
    for (const threshold of LEVEL_THRESHOLDS) {
        const result = await testLevelDetermination(
            threshold.level,
            threshold.team,
            threshold.personal,
            threshold.level
        );
        results.push({ test: `V${threshold.level}`, passed: result });
    }

    // 测试取较小值逻辑
    const minLogicResult = await testMinLevelLogic();
    results.push({ test: "取较小值逻辑", passed: minLogicResult });

    // 输出测试总结
    console.log("\n" + "=".repeat(80));
    console.log("测试总结");
    console.log("=".repeat(80));

    const passedCount = results.filter(r => r.passed).length;
    const totalCount = results.length;

    results.forEach(r => {
        console.log(`${r.passed ? "✅" : "❌"} ${r.test}`);
    });

    console.log(`\n总计: ${passedCount}/${totalCount} 测试通过`);

    if (passedCount === totalCount) {
        console.log("\n🎉 所有测试通过！");
    } else {
        console.log("\n⚠️  部分测试失败，请检查");
        process.exit(1);
    }
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
