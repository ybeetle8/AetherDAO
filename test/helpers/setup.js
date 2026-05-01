const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

const USDX_ADDRESS = "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d";
const ROUTER_ADDRESS = "0x10ED43C718714eb63d5aA57B78B54704E256024E";
const USDX_BALANCE_SLOT = 9;

/**
 * 加载部署信息
 */
function loadDeployment() {
  const deploymentPath = path.join(__dirname, "..", "..", "ae-deployment.json");
  if (!fs.existsSync(deploymentPath)) {
    console.error("❌ 未找到部署文件。请先运行 deployAE.js。");
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(deploymentPath, "utf8"));
}

/**
 * 获取所有合约实例
 */
async function getContracts(deployment) {
  const ae = await hre.ethers.getContractAt(
    "contracts/AE/src/mainnet/AE.sol:AE",
    deployment.contracts.AE
  );
  const staking = await hre.ethers.getContractAt(
    "contracts/AE-Staking/src/mainnet/Staking.sol:Staking",
    deployment.contracts.Staking
  );
  const pair = await hre.ethers.getContractAt(
    "IUniswapV2Pair",
    deployment.contracts.Pair
  );
  const usdx = await hre.ethers.getContractAt("IERC20", USDX_ADDRESS);
  const router = await hre.ethers.getContractAt("IUniswapV2Router02", ROUTER_ADDRESS);

  return { ae, staking, pair, usdx, router };
}

/**
 * 为指定地址设置 BNB（原生代币）余额，用于支付 gas
 */
async function setBalance(address, amount) {
  await hre.network.provider.send("hardhat_setBalance", [
    address,
    hre.ethers.toBeHex(amount),
  ]);
}

/**
 * 为指定地址设置 USDX 余额
 * 使用 solidityPackedKeccak256 + slot 1（BSC USDX 代理合约）
 * 同时自动设置 BNB 余额（1 BNB）用于支付 gas
 */
async function setUSDXBalance(address, amount) {
  // 设置 BNB 余额用于 gas
  await setBalance(address, hre.ethers.parseEther("1"));
  const balanceSlot = hre.ethers.solidityPackedKeccak256(
    ["uint256", "uint256"],
    [address, 1]
  );
  await hre.network.provider.send("hardhat_setStorageAt", [
    USDX_ADDRESS,
    balanceSlot,
    hre.ethers.toBeHex(amount, 32),
  ]);
}

/**
 * 为用户授权 USDX 给质押合约
 */
async function approveUSDX(usdx, user, spender, amount) {
  await usdx.connect(user).approve(spender, amount);
}

/**
 * 绑定推荐人（绑定到 root）
 */
async function bindReferral(staking, user, referrer) {
  await staking.connect(user).lockReferral(referrer);
}

/**
 * 测试结果统计
 */
class TestRunner {
  constructor(moduleName) {
    this.moduleName = moduleName;
    this.passed = 0;
    this.failed = 0;
    this.errors = [];
  }

  async run(testId, testName, testFn) {
    try {
      await testFn();
      this.passed++;
      console.log(`  ✅ ${testId} ${testName}`);
    } catch (error) {
      this.failed++;
      this.errors.push({ testId, testName, error: error.message });
      console.log(`  ❌ ${testId} ${testName}`);
      console.log(`     错误: ${error.message}`);
    }
  }

  summary() {
    console.log(`\n=== ${this.moduleName} 测试结果 ===`);
    console.log(`通过: ${this.passed}, 失败: ${this.failed}, 总计: ${this.passed + this.failed}`);
    if (this.errors.length > 0) {
      console.log("\n失败的测试:");
      this.errors.forEach((e) => {
        console.log(`  ${e.testId} ${e.testName}: ${e.error}`);
      });
    }
    console.log("");
    return this.failed === 0;
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message || "断言失败");
  }
}

function assertEq(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message || "断言失败"}: 期望 ${expected}, 实际 ${actual}`);
  }
}

function assertApproxEq(actual, expected, tolerance, message) {
  const diff = actual > expected ? actual - expected : expected - actual;
  if (diff > tolerance) {
    throw new Error(
      `${message || "近似断言失败"}: 期望 ${expected} ± ${tolerance}, 实际 ${actual}, 差值 ${diff}`
    );
  }
}

module.exports = {
  loadDeployment,
  getContracts,
  setBalance,
  setUSDXBalance,
  approveUSDX,
  bindReferral,
  TestRunner,
  assert,
  assertEq,
  assertApproxEq,
  USDX_ADDRESS,
  ROUTER_ADDRESS,
};
