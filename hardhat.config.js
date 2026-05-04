require("dotenv").config();
require("@nomicfoundation/hardhat-toolbox");
require("hardhat-preprocessor");
const fs = require("fs");

function getRemappings() {
  return fs
    .readFileSync("remappings.txt", "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => line.trim().split("="));
}

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.28",
    settings: {
      evmVersion: "cancun",
      optimizer: {
        enabled: true,
        runs: 200
      },
      viaIR: true
    }
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts"
  },
  preprocess: {
    eachLine: (hre) => ({
      transform: (line) => {
        if (line.match(/^\s*import /i)) {
          getRemappings().forEach(([find, replace]) => {
            if (line.match(find)) {
              line = line.replace(find, replace);
            }
          });
        }
        return line;
      },
    }),
  },
  networks: {
    hardhat: {
      allowUnlimitedContractSize: true,
      chainId: 10056,
      accounts: {
        mnemonic: "test test test test test test test test test test test junk",
        accountsBalance: "100000000000000000000" // 每个账户 100 BNB
      },
      forking: {
        url: "https://bsc.rpc.pinax.network/v1/311e9e281c8e2995ddf582f2bb074d0f132a8e6fd87eb785/",
        blockNumber: 64340000,
        enabled: true
      },
      chains: {
        56: {
          hardforkHistory: {
            berlin: 0,
            london: 0,
            shanghai: 0,
            cancun: 0,
          },
        },
      },
      mining: {
        auto: true,
        interval: 3000  // 每3秒自动挖一个块 (单位: 毫秒)
      }
    },

    localhost: {
      url: "http://47.109.157.92:8545",
      //url: "http://127.0.0.1:8545",
      //url: "https://bsc.ai-hello.cn/",
      chainId: 10056,
      accounts: {
        mnemonic: "test test test test test test test test test test test junk"
      },
      timeout: 120000, // 2分钟超时
    },
    bsc: {
      url: process.env.BSC_RPC_URL || "https://bsc.rpc.pinax.network/v1/311e9e281c8e2995ddf582f2bb074d0f132a8e6fd87eb785/",
      chainId: 56,
      accounts: process.env.BSC_PRIVATE_KEY
        ? [`0x${process.env.BSC_PRIVATE_KEY}`]
        : [],
      gasPrice: 3000000000, // 3 Gwei
      timeout: 120000, // 2分钟超时
    },
    bscTestnet: {
      url: process.env.BSC_TESTNET_RPC_URL || "https://data-seed-prebsc-1-s1.binance.org:8545/",
      chainId: 97,
      accounts: process.env.BSC_PRIVATE_KEY
        ? [`0x${process.env.BSC_PRIVATE_KEY}`]
        : [],
      gasPrice: 5000000000, // 5 Gwei
      timeout: 120000,
    }
  },
  etherscan: {
    apiKey: {
      bsc: process.env.BSCSCAN_API_KEY || "",
      bscTestnet: process.env.BSCSCAN_API_KEY || ""
    },
    customChains: [
      {
        network: "bsc",
        chainId: 56,
        urls: {
          apiURL: "https://api.etherscan.io/v2/api?chainid=56",
          browserURL: "https://bscscan.com"
        }
      },
      {
        network: "bscTestnet",
        chainId: 97,
        urls: {
          apiURL: "https://api.etherscan.io/v2/api?chainid=97",
          browserURL: "https://testnet.bscscan.com"
        }
      }
    ]
  }
};