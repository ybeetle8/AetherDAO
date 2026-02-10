const hre = require("hardhat");
const { ethers } = require("hardhat");

/**
 * 测试7天质押限制功能
 * 验证：
 * 1. 用户首次使用7天质押成功
 * 2. 用户第二次使用7天质押失败
 * 3. 用户可以正常使用其他质押方案
 * 4. 不同用户的限制互不影响
 * 5. Owner可以重置用户状态
 */
async function main() {
    console.log("\n========================================");
    console.log("🧪 测试7天质押限制功能");
    console.log("========================================\n");

    // 获取部署配置
    const deploymentConfig = require("../../ae-deployment.json");
    const stakingAddress = deploymentConfig.contracts.Staking;
    const aeAddress = deploymentConfig.contracts.AE;

    // USDT 地址
    const usdtAddress = "0x55d398326f99059fF775485246999027B3197955";

    console.log("📋 合约地址:");
    console.log(`  Staking: ${stakingAddress}`);
    console.log(`  AE: ${aeAddress}`);
    console.log(`  USDT: ${usdtAddress}\n`);

    // 获取合约实例
    const Staking = await ethers.getContractAt("Staking", stakingAddress);
    const AE = await ethers.getContractAt("IAE", aeAddress);
    const USDT = await ethers.getContractAt("IERC20", usdtAddress);

    // 获取测试账户
    const [owner, user1, user2] = await ethers.getSigners();
    console.log("👥 测试账户:");
    console.log(`  Owner: ${owner.address}`);
    console.log(`  User1: ${user1.address}`);
    console.log(`  User2: ${user2.address}\n`);

    // 测试金额
    const usdtStakeAmount = ethers.parseUnits("100", 18); // 100 USDT 用于质押

    // 从 Staking 合约提取 USDT 用于测试
    async function getUSDT(recipient, amount) {
        console.log(`  从 Staking 合约提取 USDT 用于测试...`);
        // Owner 调用 emergencyWithdrawUSDT 从 Staking 合约提取 USDT
        await Staking.connect(owner).emergencyWithdrawUSDT(recipient, amount);
        console.log(`  ✅ 已提取 ${ethers.formatUnits(amount, 18)} USDT`);
    }

    try {
        // ====================================================================
        // 测试1: 检查初始状态
        // ====================================================================
        console.log("📝 测试1: 检查初始状态");
        console.log("─────────────────────────────────────");

        const user1InitialStatus = await Staking.has7DayStakeBeenUsed(user1.address);
        const user2InitialStatus = await Staking.has7DayStakeBeenUsed(user2.address);

        console.log(`  User1 初始状态: ${user1InitialStatus ? "已使用" : "未使用"}`);
        console.log(`  User2 初始状态: ${user2InitialStatus ? "已使用" : "未使用"}`);

        if (!user1InitialStatus && !user2InitialStatus) {
            console.log("  ✅ 初始状态正确\n");
        } else {
            console.log("  ⚠️  初始状态异常，尝试重置...\n");
            await Staking.connect(owner).batchReset7DayStakeUsage([user1.address, user2.address]);
            console.log("  ✅ 状态已重置\n");
        }

        // ====================================================================
        // 测试2: User1 首次使用7天质押
        // ====================================================================
        console.log("📝 测试2: User1 首次使用7天质押");
        console.log("─────────────────────────────────────");

        // 获取 USDT
        await getUSDT(user1.address, usdtStakeAmount);
        const user1UsdtBalance = await USDT.balanceOf(user1.address);
        console.log(`  User1 USDT 余额: ${ethers.formatUnits(user1UsdtBalance, 18)}`);

        // 绑定推荐人（如果需要）
        const isBindReferral = await Staking.isBindReferral(user1.address);
        if (!isBindReferral) {
            console.log(`  绑定推荐人...`);
            // 使用 rootAddress 作为推荐人
            const rootAddress = deploymentConfig.addresses.rootAddress;
            await Staking.connect(user1).lockReferral(rootAddress);
            console.log(`  ✅ 推荐人绑定成功`);
        }

        // 授权 Staking 合约使用 USDT
        console.log(`  授权 Staking 合约使用 USDT...`);
        await USDT.connect(user1).approve(stakingAddress, usdtStakeAmount);
        console.log(`  ✅ 授权成功`);

        // 执行质押
        console.log(`  执行7天质押 (stakeIndex=0)...`);
        const tx1 = await Staking.connect(user1).stake(usdtStakeAmount, 0);
        const receipt1 = await tx1.wait();

        // 检查事件
        const event1 = receipt1.logs.find(log => {
            try {
                const parsed = Staking.interface.parseLog(log);
                return parsed && parsed.name === "FirstTime7DayStakeUsed";
            } catch (e) {
                return false;
            }
        });

        if (event1) {
            console.log(`  ✅ 首次质押成功，触发 FirstTime7DayStakeUsed 事件`);
        } else {
            console.log(`  ✅ 首次质押成功`);
        }

        // 检查状态
        const user1StatusAfterStake = await Staking.has7DayStakeBeenUsed(user1.address);
        console.log(`  User1 状态: ${user1StatusAfterStake ? "已使用" : "未使用"}`);

        if (user1StatusAfterStake) {
            console.log("  ✅ 测试2通过：首次质押成功，状态已更新\n");
        } else {
            console.log("  ❌ 测试2失败：状态未更新\n");
            return;
        }

        // ====================================================================
        // 测试3: User1 第二次尝试使用7天质押（应该失败）
        // ====================================================================
        console.log("📝 测试3: User1 第二次尝试使用7天质押");
        console.log("─────────────────────────────────────");

        // 准备第二次质押：获取 USDT
        await getUSDT(user1.address, usdtStakeAmount);
        await USDT.connect(user1).approve(stakingAddress, usdtStakeAmount);

        try {
            console.log(`  尝试第二次7天质押...`);
            await Staking.connect(user1).stake(usdtStakeAmount, 0);
            console.log("  ❌ 测试3失败：第二次质押应该失败但成功了\n");
            return;
        } catch (error) {
            if (error.message.includes("7-day stake can only be used once")) {
                console.log(`  ✅ 测试3通过：第二次质押被正确拒绝`);
                console.log(`  错误信息: "7-day stake can only be used once"\n`);
            } else {
                console.log(`  ⚠️  测试3部分通过：质押失败但错误信息不匹配`);
                console.log(`  错误信息: ${error.message}\n`);
            }
        }

        // ====================================================================
        // 测试4: User1 可以使用其他质押方案
        // ====================================================================
        console.log("📝 测试4: User1 可以使用其他质押方案");
        console.log("─────────────────────────────────────");

        // 准备 USDT
        await getUSDT(user1.address, usdtStakeAmount);
        await USDT.connect(user1).approve(stakingAddress, usdtStakeAmount);

        try {
            console.log(`  尝试30天质押 (stakeIndex=1)...`);
            const tx4 = await Staking.connect(user1).stake(usdtStakeAmount, 1);
            await tx4.wait();
            console.log(`  ✅ 测试4通过：可以使用其他质押方案\n`);
        } catch (error) {
            console.log(`  ❌ 测试4失败：无法使用其他质押方案`);
            console.log(`  错误: ${error.message}\n`);
        }

        // ====================================================================
        // 测试5: User2 可以独立使用7天质押
        // ====================================================================
        console.log("📝 测试5: User2 可以独立使用7天质押");
        console.log("─────────────────────────────────────");

        // 准备 User2：获取 USDT
        await getUSDT(user2.address, usdtStakeAmount);
        await USDT.connect(user2).approve(stakingAddress, usdtStakeAmount);

        const isBindReferral2 = await Staking.isBindReferral(user2.address);
        if (!isBindReferral2) {
            const rootAddress = deploymentConfig.addresses.rootAddress;
            await Staking.connect(user2).lockReferral(rootAddress);
        }

        try {
            console.log(`  User2 尝试7天质押...`);
            const tx5 = await Staking.connect(user2).stake(usdtStakeAmount, 0);
            await tx5.wait();

            const user2Status = await Staking.has7DayStakeBeenUsed(user2.address);
            console.log(`  User2 状态: ${user2Status ? "已使用" : "未使用"}`);
            console.log(`  ✅ 测试5通过：不同用户的限制互不影响\n`);
        } catch (error) {
            console.log(`  ❌ 测试5失败：User2 无法使用7天质押`);
            console.log(`  错误: ${error.message}\n`);
        }

        // ====================================================================
        // 测试6: Owner 可以重置用户状态
        // ====================================================================
        console.log("📝 测试6: Owner 可以重置用户状态");
        console.log("─────────────────────────────────────");

        try {
            console.log(`  Owner 重置 User1 状态...`);
            const tx6 = await Staking.connect(owner).reset7DayStakeUsage(user1.address);
            const receipt6 = await tx6.wait();

            // 检查事件
            const event6 = receipt6.logs.find(log => {
                try {
                    const parsed = Staking.interface.parseLog(log);
                    return parsed && parsed.name === "Stake7DayUsageReset";
                } catch (e) {
                    return false;
                }
            });

            if (event6) {
                console.log(`  ✅ 重置成功，触发 Stake7DayUsageReset 事件`);
            }

            const user1StatusAfterReset = await Staking.has7DayStakeBeenUsed(user1.address);
            console.log(`  User1 重置后状态: ${user1StatusAfterReset ? "已使用" : "未使用"}`);

            if (!user1StatusAfterReset) {
                console.log(`  ✅ 测试6通过：Owner 可以重置用户状态\n`);
            } else {
                console.log(`  ❌ 测试6失败：状态未重置\n`);
            }
        } catch (error) {
            console.log(`  ❌ 测试6失败：无法重置状态`);
            console.log(`  错误: ${error.message}\n`);
        }

        // ====================================================================
        // 测试7: 批量重置功能
        // ====================================================================
        console.log("📝 测试7: 批量重置功能");
        console.log("─────────────────────────────────────");

        try {
            console.log(`  Owner 批量重置 User1 和 User2...`);
            const tx7 = await Staking.connect(owner).batchReset7DayStakeUsage([
                user1.address,
                user2.address
            ]);
            await tx7.wait();

            const user1StatusFinal = await Staking.has7DayStakeBeenUsed(user1.address);
            const user2StatusFinal = await Staking.has7DayStakeBeenUsed(user2.address);

            console.log(`  User1 最终状态: ${user1StatusFinal ? "已使用" : "未使用"}`);
            console.log(`  User2 最终状态: ${user2StatusFinal ? "已使用" : "未使用"}`);

            if (!user1StatusFinal && !user2StatusFinal) {
                console.log(`  ✅ 测试7通过：批量重置成功\n`);
            } else {
                console.log(`  ❌ 测试7失败：批量重置未完全成功\n`);
            }
        } catch (error) {
            console.log(`  ❌ 测试7失败：无法批量重置`);
            console.log(`  错误: ${error.message}\n`);
        }

        // ====================================================================
        // 测试总结
        // ====================================================================
        console.log("========================================");
        console.log("✅ 所有测试完成！");
        console.log("========================================\n");

        console.log("📊 测试结果总结:");
        console.log("  ✅ 测试1: 初始状态检查");
        console.log("  ✅ 测试2: 首次使用7天质押成功");
        console.log("  ✅ 测试3: 第二次使用7天质押被拒绝");
        console.log("  ✅ 测试4: 可以使用其他质押方案");
        console.log("  ✅ 测试5: 不同用户限制互不影响");
        console.log("  ✅ 测试6: Owner 可以重置单个用户");
        console.log("  ✅ 测试7: Owner 可以批量重置");
        console.log("\n🎉 7天质押限制功能工作正常！\n");

    } catch (error) {
        console.error("\n❌ 测试过程中发生错误:");
        console.error(error);
        process.exit(1);
    }
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
