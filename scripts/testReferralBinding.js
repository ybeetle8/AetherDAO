const hre = require("hardhat");
const { ethers } = require("hardhat");

// 加载部署配置
const deploymentConfig = require("../ae-deployment-config.json");
const deployment = require("../ae-deployment.json");

// USDC 地址 (配置文件中的 usdt 实际是 USDC)
const USDC_ADDRESS = deploymentConfig.addresses.usdt;
const USDC_WHALE = "0x8894E0a0c962CB723c1976a4421c95949bE2D4E3"; // BSC USDC 大户

// 颜色输出
const colors = {
    reset: "\x1b[0m",
    green: "\x1b[32m",
    red: "\x1b[31m",
    yellow: "\x1b[33m",
    blue: "\x1b[34m",
    cyan: "\x1b[36m",
};

function log(message, color = colors.reset) {
    console.log(`${color}${message}${colors.reset}`);
}

function logSuccess(message) {
    log(`✓ ${message}`, colors.green);
}

function logError(message) {
    log(`✗ ${message}`, colors.red);
}

function logInfo(message) {
    log(`ℹ ${message}`, colors.cyan);
}

function logSection(message) {
    log(`\n${"=".repeat(60)}`, colors.blue);
    log(message, colors.blue);
    log("=".repeat(60), colors.blue);
}

// 为地址分配 USDC（使用 setStorageAt 方法）
async function fundAccountWithUSDC(address, amount) {
    // BSC USDC 可能使用不同的存储槽，尝试常见的槽位
    const possibleSlots = [0, 1, 2, 9, 51];

    for (const slot of possibleSlots) {
        try {
            const accountPadded = ethers.zeroPadValue(address, 32);
            const slotPadded = ethers.zeroPadValue(ethers.toBeHex(slot), 32);
            const storageSlot = ethers.keccak256(accountPadded + slotPadded.slice(2));

            // 设置余额
            await hre.network.provider.send("hardhat_setStorageAt", [
                USDC_ADDRESS,
                storageSlot,
                ethers.zeroPadValue(ethers.toBeHex(amount), 32)
            ]);

            // 验证余额是否设置成功
            await hre.network.provider.send("evm_mine", []);

            // 检查余额
            const usdc = await ethers.getContractAt(
                ["function balanceOf(address) view returns (uint256)"],
                USDC_ADDRESS
            );
            const balance = await usdc.balanceOf(address);

            if (balance >= amount) {
                logInfo(`已为 ${address} 分配 ${ethers.formatUnits(amount, 18)} USDC (使用槽位 ${slot})`);
                return;
            }
        } catch (e) {
            // 继续尝试下一个槽位
        }
    }

    throw new Error("无法设置 USDC 余额，所有槽位都失败");
}

// 为地址分配 BNB (用于 gas)
async function fundAccountWithBNB(address, amount) {
    await hre.network.provider.send("hardhat_setBalance", [
        address,
        ethers.toBeHex(amount)
    ]);
    logInfo(`已为 ${address} 分配 ${ethers.formatEther(amount)} BNB`);
}

async function main() {
    logSection("推荐关系绑定测试");

    // 获取合约实例
    const stakingAddress = deployment.contracts.Staking;
    const staking = await ethers.getContractAt("contracts/AE-Staking/src/interfaces/IStaking.sol:IStaking", stakingAddress);

    logInfo(`Staking 合约地址: ${stakingAddress}`);
    logInfo(`Root 地址: ${deployment.addresses.rootAddress}`);

    // 创建测试账户
    const wallet1 = ethers.Wallet.createRandom().connect(ethers.provider);
    const wallet2 = ethers.Wallet.createRandom().connect(ethers.provider);
    const wallet3 = ethers.Wallet.createRandom().connect(ethers.provider);

    logInfo(`\n测试账户:`);
    logInfo(`  用户1 (推荐人): ${wallet1.address}`);
    logInfo(`  用户2 (被推荐人): ${wallet2.address}`);
    logInfo(`  用户3 (二级被推荐人): ${wallet3.address}`);

    // 为测试账户分配资金
    const fundAmount = ethers.parseUnits("1000", 18); // 1000 USDC
    const bnbAmount = ethers.parseEther("0.1"); // 0.1 BNB for gas

    await fundAccountWithBNB(wallet1.address, bnbAmount);
    await fundAccountWithBNB(wallet2.address, bnbAmount);
    await fundAccountWithBNB(wallet3.address, bnbAmount);

    await fundAccountWithUSDC(wallet1.address, fundAmount);
    await fundAccountWithUSDC(wallet2.address, fundAmount);
    await fundAccountWithUSDC(wallet3.address, fundAmount);

    // =========================================================================
    // 测试 1: 用户首次绑定推荐人
    // =========================================================================
    logSection("测试 1: 用户首次绑定推荐人");

    try {
        // 检查绑定前状态
        const isBindBefore = await staking.isBindReferral(wallet2.address);
        logInfo(`绑定前状态: ${isBindBefore ? "已绑定" : "未绑定"}`);

        if (isBindBefore) {
            logError("用户在绑定前已经有推荐人，测试环境异常");
            return;
        }

        // 执行绑定
        logInfo(`用户2 绑定推荐人 (用户1)...`);
        const tx = await staking.connect(wallet2).lockReferral(wallet1.address);
        const receipt = await tx.wait();

        // 检查事件
        const event = receipt.logs.find(
            (log) => {
                try {
                    const parsed = staking.interface.parseLog(log);
                    return parsed && parsed.name === "ReferralBound";
                } catch {
                    return false;
                }
            }
        );

        if (event) {
            const parsed = staking.interface.parseLog(event);
            logSuccess(`触发 ReferralBound 事件:`);
            logInfo(`  用户: ${parsed.args.user}`);
            logInfo(`  推荐人: ${parsed.args.referrer}`);
            logInfo(`  时间戳: ${parsed.args.timestamp}`);
        } else {
            logError("未找到 ReferralBound 事件");
        }

        // 验证绑定后状态
        const isBindAfter = await staking.isBindReferral(wallet2.address);
        const referrer = await staking.getReferral(wallet2.address);

        if (isBindAfter && referrer === wallet1.address) {
            logSuccess("绑定成功！");
            logInfo(`  用户2 的推荐人: ${referrer}`);
        } else {
            logError("绑定验证失败");
        }

    } catch (error) {
        logError(`测试 1 失败: ${error.message}`);
    }

    // =========================================================================
    // 测试 2: 已绑定用户重复绑定
    // =========================================================================
    logSection("测试 2: 已绑定用户重复绑定");

    try {
        logInfo(`用户2 尝试重复绑定到用户3...`);

        // 尝试重复绑定，应该失败
        await staking.connect(wallet2).lockReferral(wallet3.address);

        logError("重复绑定应该失败但却成功了！");

    } catch (error) {
        if (error.message.includes("AlreadyBound")) {
            logSuccess("正确拒绝重复绑定");
            logInfo(`  错误信息: ${error.message.split("(")[0].trim()}`);
        } else {
            logError(`意外错误: ${error.message}`);
        }
    }

    // =========================================================================
    // 测试 3: 绑定后查询推荐链
    // =========================================================================
    logSection("测试 3: 绑定后查询推荐链");

    try {
        // 用户3 绑定用户2 (形成推荐链: 用户1 -> 用户2 -> 用户3)
        logInfo(`用户3 绑定推荐人 (用户2)...`);
        const tx = await staking.connect(wallet3).lockReferral(wallet2.address);
        await tx.wait();
        logSuccess("用户3 绑定成功");

        // 查询推荐链
        logInfo(`\n查询推荐链结构:`);

        // 查询用户2的推荐人
        const user2Referrer = await staking.getReferral(wallet2.address);
        logInfo(`  用户2 的推荐人: ${user2Referrer}`);
        logInfo(`  预期: ${wallet1.address}`);

        if (user2Referrer === wallet1.address) {
            logSuccess("用户2 推荐关系正确");
        } else {
            logError("用户2 推荐关系错误");
        }

        // 查询用户3的推荐人
        const user3Referrer = await staking.getReferral(wallet3.address);
        logInfo(`  用户3 的推荐人: ${user3Referrer}`);
        logInfo(`  预期: ${wallet2.address}`);

        if (user3Referrer === wallet2.address) {
            logSuccess("用户3 推荐关系正确");
        } else {
            logError("用户3 推荐关系错误");
        }

        // 验证推荐链: 用户1 -> 用户2 -> 用户3
        logInfo(`\n推荐链验证:`);
        logInfo(`  用户1 (${wallet1.address.slice(0, 10)}...)`);
        logInfo(`    ↓`);
        logInfo(`  用户2 (${wallet2.address.slice(0, 10)}...)`);
        logInfo(`    ↓`);
        logInfo(`  用户3 (${wallet3.address.slice(0, 10)}...)`);

        if (user2Referrer === wallet1.address && user3Referrer === wallet2.address) {
            logSuccess("推荐链结构正确！");
        } else {
            logError("推荐链结构错误");
        }

        // 查询绑定状态
        const user1Bind = await staking.isBindReferral(wallet1.address);
        const user2Bind = await staking.isBindReferral(wallet2.address);
        const user3Bind = await staking.isBindReferral(wallet3.address);

        logInfo(`\n绑定状态:`);
        logInfo(`  用户1: ${user1Bind ? "已绑定" : "未绑定"}`);
        logInfo(`  用户2: ${user2Bind ? "已绑定" : "未绑定"}`);
        logInfo(`  用户3: ${user3Bind ? "已绑定" : "未绑定"}`);

    } catch (error) {
        logError(`测试 3 失败: ${error.message}`);
    }

    // =========================================================================
    // 测试总结
    // =========================================================================
    logSection("测试总结");

    logSuccess("所有推荐关系绑定测试完成！");
    logInfo("\n测试覆盖:");
    logInfo("  ✓ 用户首次绑定推荐人");
    logInfo("  ✓ 已绑定用户重复绑定（应失败）");
    logInfo("  ✓ 绑定后查询推荐链");
    logInfo("  ✓ 推荐链结构验证");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
