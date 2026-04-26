const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

// =====================================================================
// 合约验证脚本 — 直接调用 Etherscan V2 API
// 绕过 hardhat-verify 插件的 V1 兼容性问题
//
// 用法:
//   npx hardhat run scripts/verifyContracts.js --network bscTestnet
//   npx hardhat run scripts/verifyContracts.js --network bsc
//
// 会自动读取对应的 deployment JSON 文件获取合约地址
// =====================================================================

const ETHERSCAN_V2_API = "https://api.etherscan.io/v2/api";

// 网络 → chainId 映射
const CHAIN_IDS = {
  bsc: 56,
  bscTestnet: 97,
};

// 网络 → 部署文件映射
const DEPLOYMENT_FILES = {
  bsc: "ae-mainnet-deployment.json",
  bscTestnet: "ae-testnet-deployment.json",
};

// =====================================================================
// 从 build-info 中提取 Standard JSON Input
// =====================================================================
function getSolcInput() {
  const buildInfoDir = path.join(__dirname, "..", "artifacts", "build-info");
  const files = fs.readdirSync(buildInfoDir).filter(f => f.endsWith(".json"));

  if (files.length === 0) {
    throw new Error("未找到 build-info，请先运行 npx hardhat compile");
  }

  // 取最新的 build-info
  const latestFile = files
    .map(f => ({ name: f, mtime: fs.statSync(path.join(buildInfoDir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)[0].name;

  const buildInfo = JSON.parse(fs.readFileSync(path.join(buildInfoDir, latestFile), "utf8"));

  return {
    solcVersion: `v${buildInfo.solcLongVersion}`,
    solcInput: buildInfo.input,
  };
}

// =====================================================================
// ABI 编码构造函数参数
// =====================================================================
function encodeConstructorArgs(contractPath, constructorArgs) {
  // 从 artifacts 读取合约 ABI
  const parts = contractPath.split(":");
  const contractName = parts[parts.length - 1];
  const artifactPath = path.join(
    __dirname, "..", "artifacts",
    parts[0],
    `${contractName}.json`
  );

  const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
  const constructorAbi = artifact.abi.find(item => item.type === "constructor");

  if (!constructorAbi || constructorAbi.inputs.length === 0) {
    return "";
  }

  const types = constructorAbi.inputs.map(input => input.type);
  const encoded = hre.ethers.AbiCoder.defaultAbiCoder().encode(types, constructorArgs);
  // 去掉 0x 前缀
  return encoded.slice(2);
}

// =====================================================================
// 调用 Etherscan V2 API 提交验证
// =====================================================================
async function submitVerification(chainId, apiKey, params) {
  const url = `${ETHERSCAN_V2_API}?chainid=${chainId}&module=contract&action=verifysourcecode&apikey=${apiKey}`;

  const formData = new URLSearchParams();
  formData.append("sourceCode", JSON.stringify(params.solcInput));
  formData.append("codeformat", "solidity-standard-json-input");
  formData.append("contractaddress", params.address);
  formData.append("contractname", params.contractPath);
  formData.append("compilerversion", params.solcVersion);
  if (params.constructorArgs) {
    formData.append("constructorArguements", params.constructorArgs); // Etherscan 拼写错误是故意的
  }

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: formData.toString(),
  });

  return await response.json();
}

// =====================================================================
// 轮询验证状态
// =====================================================================
async function checkVerificationStatus(chainId, apiKey, guid) {
  const url = `${ETHERSCAN_V2_API}?chainid=${chainId}&module=contract&action=checkverifystatus&guid=${guid}&apikey=${apiKey}`;

  for (let i = 0; i < 10; i++) {
    await new Promise(resolve => setTimeout(resolve, 5000)); // 等 5 秒

    const response = await fetch(url);
    const data = await response.json();

    if (data.result === "Pending in queue") {
      process.stdout.write(".");
      continue;
    }

    return data;
  }

  return { status: "0", result: "Timeout: 验证状态查询超时" };
}

// =====================================================================
// 验证单个合约
// =====================================================================
async function verifyOne(name, address, constructorArgs, contractPath, chainId, apiKey, solcVersion, solcInput) {
  console.log(`\n  验证 ${name} (${address})...`);

  // ABI 编码构造参数
  let encodedArgs = "";
  try {
    encodedArgs = encodeConstructorArgs(contractPath, constructorArgs);
  } catch (e) {
    console.log(`    构造参数编码失败: ${e.message}，将不带参数提交`);
  }

  // 提交验证
  const submitResult = await submitVerification(chainId, apiKey, {
    address,
    contractPath,
    solcVersion,
    solcInput,
    constructorArgs: encodedArgs,
  });

  if (submitResult.status === "0") {
    const msg = submitResult.result || submitResult.message || "";
    if (msg.includes("Already Verified") || msg.includes("already verified")) {
      console.log(`  ✓ ${name} 已经验证过了`);
      return true;
    }
    console.error(`  ✗ ${name} 提交失败: ${msg}`);
    return false;
  }

  const guid = submitResult.result;
  console.log(`    已提交，GUID: ${guid}`);
  process.stdout.write("    等待验证结果");

  // 轮询状态
  const statusResult = await checkVerificationStatus(chainId, apiKey, guid);
  console.log();

  if (statusResult.status === "1" || (statusResult.result && statusResult.result.includes("Pass"))) {
    console.log(`  ✓ ${name} 验证成功!`);
    return true;
  } else {
    console.error(`  ✗ ${name} 验证失败: ${statusResult.result}`);
    return false;
  }
}

// =====================================================================
// 主流程
// =====================================================================
async function main() {
  const network = hre.network.name;
  const chainId = CHAIN_IDS[network];

  if (!chainId) {
    console.error(`不支持的网络: ${network}，仅支持 bsc / bscTestnet`);
    process.exit(1);
  }

  const apiKey = process.env.BSCSCAN_API_KEY;
  if (!apiKey) {
    console.error("未配置 BSCSCAN_API_KEY，请在 .env 中设置");
    process.exit(1);
  }

  // 读取部署信息
  const deployFile = path.join(__dirname, "..", DEPLOYMENT_FILES[network]);
  if (!fs.existsSync(deployFile)) {
    console.error(`未找到部署文件: ${deployFile}`);
    console.error("请先运行部署脚本");
    process.exit(1);
  }

  const deployment = JSON.parse(fs.readFileSync(deployFile, "utf8"));
  const C = deployment.contracts;
  const deployer = deployment.deployer;

  console.log("\n╔══════════════════════════════════════════════════════╗");
  console.log(`║    Etherscan V2 API 合约验证 (${network})`.padEnd(55) + "║");
  console.log("╚══════════════════════════════════════════════════════╝");
  console.log(`\n  Chain ID: ${chainId}`);
  console.log(`  部署者: ${deployer}`);
  console.log(`  API: ${ETHERSCAN_V2_API}`);

  // 获取编译信息
  console.log("\n  读取编译信息...");
  const { solcVersion, solcInput } = getSolcInput();
  console.log(`  编译器版本: ${solcVersion}`);

  // 构建验证列表
  const USDX_ADDRESS = C.MockUSDC || deployment.configAddresses?.usdx || "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d";

  // PancakeSwap 地址
  const ROUTER = deployment.pancakeSwap?.router || "0x10ED43C718714eb63d5aA57B78B54704E256024E";

  // 配置地址 (测试网用 deployer，主网从 configAddresses 读)
  const cfgAddr = deployment.configAddresses || {};
  const ALL_ADDR = deployer; // 测试网默认
  const getAddr = (key) => cfgAddr[key] || ALL_ADDR;

  const contracts = [];

  // MockUSDC (仅测试网)
  if (C.MockUSDC) {
    contracts.push({
      name: "MockUSDC",
      address: C.MockUSDC,
      args: ["Mock USDC", "USDC", hre.ethers.parseEther("1000000").toString()],
      path: "contracts/test/MockERC20.sol:MockERC20",
    });
  }

  // Staking
  contracts.push({
    name: "Staking",
    address: C.Staking,
    args: [USDX_ADDRESS, ROUTER, getAddr("rootAddress"), getAddr("feeRecipient"), getAddr("educationFundAddress")],
    path: "contracts/AE-Staking/src/mainnet/Staking.sol:Staking",
  });

  // AE
  contracts.push({
    name: "AE",
    address: C.AE,
    args: [
      USDX_ADDRESS, ROUTER, C.Staking,
      getAddr("marketingAddress"),
      getAddr("buyTaxNodeRewardAddress"),
      getAddr("buyTaxCommunityRewardAddress"),
      getAddr("marketingFundAddress"),
      getAddr("weeklyTop15RewardAddress"),
    ],
    path: "contracts/AE/src/mainnet/AE.sol:AE",
  });

  // LiquidityStaking
  contracts.push({
    name: "LiquidityStaking",
    address: C.LiquidityStaking,
    args: [USDX_ADDRESS, C.AE, C.Pair || C["AE/USDC Pair"], C.Staking, getAddr("marketingAddress"), deployer, ROUTER],
    path: "contracts/LiquidityStaking/src/mainnet/LiquidityStaking.sol:LiquidityStaking",
  });

  // FundRelay
  contracts.push({
    name: "FundRelay",
    address: C.FundRelay,
    args: [C.AE, USDX_ADDRESS, deployer],
    path: "contracts/AE/src/utils/FundRelay.sol:FundRelay",
  });

  // 逐个验证
  let success = 0;
  let failed = 0;

  for (const c of contracts) {
    const ok = await verifyOne(c.name, c.address, c.args, c.path, chainId, apiKey, solcVersion, solcInput);
    if (ok) success++;
    else failed++;
  }

  // 结果汇总
  console.log("\n╔══════════════════════════════════════════════════════╗");
  console.log(`║  验证完成: ${success} 成功, ${failed} 失败`.padEnd(55) + "║");
  console.log("╚══════════════════════════════════════════════════════╝\n");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("验证脚本出错:", error);
    process.exit(1);
  });
