# SYI-Referral 前端集成指南

本文档为前端开发者提供 SYIReferral 合约的完整调用指南，包括合约接口、事件监听、错误处理和最佳实践。

## 目录

- [合约概述](#合约概述)
- [环境准备](#环境准备)
- [核心功能](#核心功能)
  - [1. 绑定推荐人](#1-绑定推荐人)
  - [2. 绑定好友](#2-绑定好友)
  - [3. 查询用户关系](#3-查询用户关系)
  - [4. 获取推荐链](#4-获取推荐链)
  - [5. 查询下线列表](#5-查询下线列表)
  - [6. 批量查询](#6-批量查询)
- [事件监听](#事件监听)
- [错误处理](#错误处理)
- [完整示例](#完整示例)
- [最佳实践](#最佳实践)

---

## 合约概述

**合约名称**: SYIReferral
**功能**: 独立的推荐关系管理合约，用于管理用户的推荐人（Referral）和好友（Friend）关系

**核心特性**:
- 用户只能绑定一次推荐人和好友（不可修改）
- 自动循环引用检测
- 支持推荐链查询（最多 30 层）
- 支持分页和批量查询
- 完全独立，可被其他合约调用

**合约地址** (请根据实际部署填写):
- BSC 主网: `0x...`
- BSC 测试网: `0x...`

---

## 环境准备

### 1. 安装依赖

```bash
npm install ethers
# 或
npm install web3
```

### 2. 导入 ABI

ABI 文件位置: `abi/SYIReferral.json`

```javascript
import { ethers } from 'ethers';
import SYIReferralABI from './abi/SYIReferral.json';

// 合约地址
const REFERRAL_CONTRACT_ADDRESS = '0x...';

// 创建合约实例
const provider = new ethers.providers.Web3Provider(window.ethereum);
const signer = provider.getSigner();
const referralContract = new ethers.Contract(
  REFERRAL_CONTRACT_ADDRESS,
  SYIReferralABI,
  signer
);
```

---

## 核心功能

### 1. 绑定推荐人

#### 函数签名

```solidity
function lockReferral(address _referrer) external
```

#### 参数说明

- `_referrer` (address): 推荐人地址
  - 如果传入 `address(0)`，自动绑定为 `rootAddress`
  - 不能绑定自己
  - 必须避免循环引用

#### 调用示例

```javascript
/**
 * 绑定推荐人
 * @param {string} referrerAddress - 推荐人地址
 * @returns {Promise<TransactionReceipt>}
 */
async function bindReferral(referrerAddress) {
  try {
    // 1. 检查是否已绑定
    const userAddress = await signer.getAddress();
    const hasLocked = await referralContract.hasLockedReferral(userAddress);

    if (hasLocked) {
      throw new Error('您已经绑定过推荐人，无法重复绑定');
    }

    // 2. 验证推荐人地址
    if (!ethers.utils.isAddress(referrerAddress)) {
      throw new Error('推荐人地址格式错误');
    }

    if (referrerAddress.toLowerCase() === userAddress.toLowerCase()) {
      throw new Error('不能推荐自己');
    }

    // 3. 发送交易
    const tx = await referralContract.lockReferral(referrerAddress);

    console.log('交易已发送:', tx.hash);

    // 4. 等待确认
    const receipt = await tx.wait();

    console.log('绑定成功！交易哈希:', receipt.transactionHash);

    return receipt;
  } catch (error) {
    console.error('绑定推荐人失败:', error);
    throw handleContractError(error);
  }
}
```

#### 事件

成功后会触发 `ReferralBound` 事件:

```javascript
event ReferralBound(
    address indexed user,
    address indexed referrer,
    uint256 timestamp
);
```

---

### 2. 绑定好友

#### 函数签名

```solidity
function lockFriend(address _friend) external
```

#### 参数说明

- `_friend` (address): 好友地址
  - 不能为 `address(0)`
  - 不能绑定自己

#### 调用示例

```javascript
/**
 * 绑定好友
 * @param {string} friendAddress - 好友地址
 * @returns {Promise<TransactionReceipt>}
 */
async function bindFriend(friendAddress) {
  try {
    // 1. 检查是否已绑定
    const userAddress = await signer.getAddress();
    const hasLocked = await referralContract.hasLockedFriend(userAddress);

    if (hasLocked) {
      throw new Error('您已经绑定过好友，无法重复绑定');
    }

    // 2. 验证好友地址
    if (!ethers.utils.isAddress(friendAddress)) {
      throw new Error('好友地址格式错误');
    }

    if (friendAddress === ethers.constants.AddressZero) {
      throw new Error('好友地址不能为空');
    }

    if (friendAddress.toLowerCase() === userAddress.toLowerCase()) {
      throw new Error('不能绑定自己为好友');
    }

    // 3. 发送交易
    const tx = await referralContract.lockFriend(friendAddress);

    console.log('交易已发送:', tx.hash);

    // 4. 等待确认
    const receipt = await tx.wait();

    console.log('绑定成功！交易哈希:', receipt.transactionHash);

    return receipt;
  } catch (error) {
    console.error('绑定好友失败:', error);
    throw handleContractError(error);
  }
}
```

#### 事件

成功后会触发 `FriendBound` 事件:

```javascript
event FriendBound(
    address indexed user,
    address indexed friend,
    uint256 timestamp
);
```

---

### 3. 查询用户关系

#### 3.1 获取完整用户信息 (推荐)

```solidity
function getUserInfo(address user)
    external view
    returns (
        address referrer,
        address friend,
        bool hasReferral,
        bool hasFriend,
        uint256 childrenCount
    )
```

#### 调用示例

```javascript
/**
 * 获取用户的完整关系信息
 * @param {string} userAddress - 用户地址
 * @returns {Promise<Object>}
 */
async function getUserInfo(userAddress) {
  try {
    const [referrer, friend, hasReferral, hasFriend, childrenCount] =
      await referralContract.getUserInfo(userAddress);

    return {
      referrer,           // 推荐人地址
      friend,             // 好友地址
      hasReferral,        // 是否已绑定推荐人
      hasFriend,          // 是否已绑定好友
      childrenCount: childrenCount.toNumber()  // 直接下线数量
    };
  } catch (error) {
    console.error('查询用户信息失败:', error);
    throw error;
  }
}
```

#### 3.2 单独查询方法

```javascript
// 获取推荐人
async function getReferral(userAddress) {
  return await referralContract.getReferral(userAddress);
}

// 获取好友
async function getFriend(userAddress) {
  return await referralContract.getFriend(userAddress);
}

// 检查是否已绑定推荐人
async function hasLockedReferral(userAddress) {
  return await referralContract.hasLockedReferral(userAddress);
}

// 检查是否已绑定好友
async function hasLockedFriend(userAddress) {
  return await referralContract.hasLockedFriend(userAddress);
}
```

---

### 4. 获取推荐链

#### 4.1 基础推荐链查询

```solidity
function getReferrals(address user, uint256 maxDepth)
    external view
    returns (address[] memory)
```

#### 调用示例

```javascript
/**
 * 获取用户的推荐链
 * @param {string} userAddress - 用户地址
 * @param {number} maxDepth - 最大深度 (1-30)
 * @returns {Promise<string[]>} 推荐链地址数组（从近到远）
 */
async function getReferrals(userAddress, maxDepth = 30) {
  try {
    const referrals = await referralContract.getReferrals(userAddress, maxDepth);
    return referrals;
  } catch (error) {
    console.error('获取推荐链失败:', error);
    throw error;
  }
}

// 示例: 获取前 10 层推荐人
const referralChain = await getReferrals(userAddress, 10);
console.log('推荐链:', referralChain);
// 输出: ['0xAAA...', '0xBBB...', '0xCCC...']
```

#### 4.2 带深度信息的推荐链

```solidity
function getReferralChainWithDepth(address user, uint256 maxDepth)
    external view
    returns (address[] memory chain, uint256[] memory depths)
```

#### 调用示例

```javascript
/**
 * 获取带深度信息的推荐链
 * @param {string} userAddress - 用户地址
 * @param {number} maxDepth - 最大深度
 * @returns {Promise<Object>}
 */
async function getReferralChainWithDepth(userAddress, maxDepth = 30) {
  try {
    const [chain, depths] = await referralContract.getReferralChainWithDepth(
      userAddress,
      maxDepth
    );

    // 格式化返回数据
    return chain.map((address, index) => ({
      address,
      depth: depths[index].toNumber()
    }));
  } catch (error) {
    console.error('获取推荐链失败:', error);
    throw error;
  }
}

// 使用示例
const chainData = await getReferralChainWithDepth(userAddress, 10);
console.log(chainData);
/* 输出:
[
  { address: '0xAAA...', depth: 1 },
  { address: '0xBBB...', depth: 2 },
  { address: '0xCCC...', depth: 3 }
]
*/
```

---

### 5. 查询下线列表

#### 5.1 获取所有直接下线

```solidity
function getChildren(address user) external view returns (address[] memory)
```

```javascript
/**
 * 获取用户的所有直接下线
 * @param {string} userAddress - 用户地址
 * @returns {Promise<string[]>}
 */
async function getChildren(userAddress) {
  try {
    const children = await referralContract.getChildren(userAddress);
    return children;
  } catch (error) {
    console.error('获取下线列表失败:', error);
    throw error;
  }
}
```

#### 5.2 获取下线数量

```solidity
function getChildrenCount(address user) external view returns (uint256)
```

```javascript
/**
 * 获取直接下线数量
 * @param {string} userAddress - 用户地址
 * @returns {Promise<number>}
 */
async function getChildrenCount(userAddress) {
  try {
    const count = await referralContract.getChildrenCount(userAddress);
    return count.toNumber();
  } catch (error) {
    console.error('获取下线数量失败:', error);
    throw error;
  }
}
```

#### 5.3 分页获取下线列表 (推荐)

```solidity
function getChildrenPaged(address user, uint256 offset, uint256 limit)
    external view
    returns (address[] memory)
```

#### 调用示例

```javascript
/**
 * 分页获取下线列表
 * @param {string} userAddress - 用户地址
 * @param {number} page - 页码（从 1 开始）
 * @param {number} pageSize - 每页数量
 * @returns {Promise<Object>}
 */
async function getChildrenPaged(userAddress, page = 1, pageSize = 20) {
  try {
    // 1. 获取总数量
    const totalCount = await referralContract.getChildrenCount(userAddress);
    const total = totalCount.toNumber();

    // 2. 计算分页参数
    const offset = (page - 1) * pageSize;

    if (offset >= total) {
      return {
        data: [],
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize)
      };
    }

    // 3. 获取分页数据
    const children = await referralContract.getChildrenPaged(
      userAddress,
      offset,
      pageSize
    );

    return {
      data: children,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize)
    };
  } catch (error) {
    console.error('分页查询失败:', error);
    throw error;
  }
}

// 使用示例
const result = await getChildrenPaged(userAddress, 1, 20);
console.log(`第 ${result.page} 页，共 ${result.totalPages} 页`);
console.log('下线列表:', result.data);
```

---

### 6. 批量查询

```solidity
function batchGetUserInfo(address[] calldata users)
    external view
    returns (
        address[] memory referrers,
        address[] memory friends,
        bool[] memory hasReferrals,
        bool[] memory hasFriends
    )
```

#### 调用示例

```javascript
/**
 * 批量查询用户信息
 * @param {string[]} userAddresses - 用户地址数组
 * @returns {Promise<Object[]>}
 */
async function batchGetUserInfo(userAddresses) {
  try {
    const [referrers, friends, hasReferrals, hasFriends] =
      await referralContract.batchGetUserInfo(userAddresses);

    // 格式化返回数据
    return userAddresses.map((address, index) => ({
      address,
      referrer: referrers[index],
      friend: friends[index],
      hasReferral: hasReferrals[index],
      hasFriend: hasFriends[index]
    }));
  } catch (error) {
    console.error('批量查询失败:', error);
    throw error;
  }
}

// 使用示例
const users = ['0xAAA...', '0xBBB...', '0xCCC...'];
const results = await batchGetUserInfo(users);
console.log(results);
/* 输出:
[
  {
    address: '0xAAA...',
    referrer: '0xXXX...',
    friend: '0xYYY...',
    hasReferral: true,
    hasFriend: true
  },
  ...
]
*/
```

---

## 事件监听

### 监听推荐人绑定事件

```javascript
// 监听 ReferralBound 事件
referralContract.on('ReferralBound', (user, referrer, timestamp, event) => {
  console.log('推荐关系绑定:', {
    user,
    referrer,
    timestamp: timestamp.toNumber(),
    blockNumber: event.blockNumber,
    transactionHash: event.transactionHash
  });
});
```

### 监听好友绑定事件

```javascript
// 监听 FriendBound 事件
referralContract.on('FriendBound', (user, friend, timestamp, event) => {
  console.log('好友关系绑定:', {
    user,
    friend,
    timestamp: timestamp.toNumber(),
    blockNumber: event.blockNumber,
    transactionHash: event.transactionHash
  });
});
```

### 查询历史事件

```javascript
/**
 * 查询历史绑定事件
 * @param {string} userAddress - 用户地址
 * @param {number} fromBlock - 起始区块
 * @returns {Promise<Object[]>}
 */
async function getUserBindingHistory(userAddress, fromBlock = 0) {
  try {
    // 查询推荐人绑定事件
    const referralFilter = referralContract.filters.ReferralBound(userAddress);
    const referralEvents = await referralContract.queryFilter(
      referralFilter,
      fromBlock
    );

    // 查询好友绑定事件
    const friendFilter = referralContract.filters.FriendBound(userAddress);
    const friendEvents = await referralContract.queryFilter(
      friendFilter,
      fromBlock
    );

    return {
      referralBindings: referralEvents.map(e => ({
        user: e.args.user,
        referrer: e.args.referrer,
        timestamp: e.args.timestamp.toNumber(),
        blockNumber: e.blockNumber,
        transactionHash: e.transactionHash
      })),
      friendBindings: friendEvents.map(e => ({
        user: e.args.user,
        friend: e.args.friend,
        timestamp: e.args.timestamp.toNumber(),
        blockNumber: e.blockNumber,
        transactionHash: e.transactionHash
      }))
    };
  } catch (error) {
    console.error('查询历史事件失败:', error);
    throw error;
  }
}
```

---

## 错误处理

### 合约错误类型

```solidity
error AlreadyBound();         // 已经绑定
error CannotBindSelf();       // 不能绑定自己
error InvalidAddress();       // 无效地址
error CircularReference();    // 循环引用
```

### 错误处理函数

```javascript
/**
 * 处理合约错误
 * @param {Error} error - 错误对象
 * @returns {Error}
 */
function handleContractError(error) {
  // 解析自定义错误
  if (error.data) {
    const errorData = error.data;

    // AlreadyBound()
    if (errorData.includes('0x774eeb13')) {
      return new Error('已经绑定过，无法重复绑定');
    }

    // CannotBindSelf()
    if (errorData.includes('0x0e56c012')) {
      return new Error('不能绑定自己');
    }

    // InvalidAddress()
    if (errorData.includes('0xe6c4247b')) {
      return new Error('地址无效');
    }

    // CircularReference()
    if (errorData.includes('0x56c6ea52')) {
      return new Error('检测到循环引用，无法绑定');
    }
  }

  // 用户拒绝交易
  if (error.code === 4001) {
    return new Error('您已取消交易');
  }

  // Gas 估算失败
  if (error.code === -32000) {
    return new Error('交易将失败，请检查参数');
  }

  // 其他错误
  return error;
}
```

---

## 完整示例

### React Hook 示例

```javascript
import { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import SYIReferralABI from './abi/SYIReferral.json';

const REFERRAL_CONTRACT_ADDRESS = '0x...';

export function useReferralContract() {
  const [contract, setContract] = useState(null);
  const [userAddress, setUserAddress] = useState('');
  const [userInfo, setUserInfo] = useState(null);
  const [loading, setLoading] = useState(false);

  // 初始化合约
  useEffect(() => {
    async function init() {
      if (window.ethereum) {
        const provider = new ethers.providers.Web3Provider(window.ethereum);
        const signer = provider.getSigner();
        const address = await signer.getAddress();

        const referralContract = new ethers.Contract(
          REFERRAL_CONTRACT_ADDRESS,
          SYIReferralABI,
          signer
        );

        setContract(referralContract);
        setUserAddress(address);

        // 加载用户信息
        await loadUserInfo(referralContract, address);
      }
    }

    init();
  }, []);

  // 加载用户信息
  async function loadUserInfo(contractInstance, address) {
    try {
      setLoading(true);
      const [referrer, friend, hasReferral, hasFriend, childrenCount] =
        await (contractInstance || contract).getUserInfo(address);

      setUserInfo({
        referrer,
        friend,
        hasReferral,
        hasFriend,
        childrenCount: childrenCount.toNumber()
      });
    } catch (error) {
      console.error('加载用户信息失败:', error);
    } finally {
      setLoading(false);
    }
  }

  // 绑定推荐人
  async function bindReferral(referrerAddress) {
    try {
      setLoading(true);

      if (userInfo?.hasReferral) {
        throw new Error('您已经绑定过推荐人');
      }

      const tx = await contract.lockReferral(referrerAddress);
      await tx.wait();

      // 刷新用户信息
      await loadUserInfo(contract, userAddress);

      return { success: true };
    } catch (error) {
      return { success: false, error: handleContractError(error) };
    } finally {
      setLoading(false);
    }
  }

  // 绑定好友
  async function bindFriend(friendAddress) {
    try {
      setLoading(true);

      if (userInfo?.hasFriend) {
        throw new Error('您已经绑定过好友');
      }

      const tx = await contract.lockFriend(friendAddress);
      await tx.wait();

      // 刷新用户信息
      await loadUserInfo(contract, userAddress);

      return { success: true };
    } catch (error) {
      return { success: false, error: handleContractError(error) };
    } finally {
      setLoading(false);
    }
  }

  // 获取下线列表
  async function getChildrenList(page = 1, pageSize = 20) {
    try {
      setLoading(true);

      const totalCount = await contract.getChildrenCount(userAddress);
      const total = totalCount.toNumber();
      const offset = (page - 1) * pageSize;

      if (offset >= total) {
        return { data: [], total, page, pageSize, totalPages: 0 };
      }

      const children = await contract.getChildrenPaged(
        userAddress,
        offset,
        pageSize
      );

      return {
        data: children,
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize)
      };
    } catch (error) {
      console.error('获取下线列表失败:', error);
      throw error;
    } finally {
      setLoading(false);
    }
  }

  return {
    contract,
    userAddress,
    userInfo,
    loading,
    bindReferral,
    bindFriend,
    getChildrenList,
    refresh: () => loadUserInfo(contract, userAddress)
  };
}
```

### Vue Composition API 示例

```javascript
import { ref, onMounted } from 'vue';
import { ethers } from 'ethers';
import SYIReferralABI from './abi/SYIReferral.json';

const REFERRAL_CONTRACT_ADDRESS = '0x...';

export function useReferralContract() {
  const contract = ref(null);
  const userAddress = ref('');
  const userInfo = ref(null);
  const loading = ref(false);

  onMounted(async () => {
    if (window.ethereum) {
      const provider = new ethers.providers.Web3Provider(window.ethereum);
      const signer = provider.getSigner();
      const address = await signer.getAddress();

      contract.value = new ethers.Contract(
        REFERRAL_CONTRACT_ADDRESS,
        SYIReferralABI,
        signer
      );

      userAddress.value = address;
      await loadUserInfo();
    }
  });

  async function loadUserInfo() {
    try {
      loading.value = true;
      const [referrer, friend, hasReferral, hasFriend, childrenCount] =
        await contract.value.getUserInfo(userAddress.value);

      userInfo.value = {
        referrer,
        friend,
        hasReferral,
        hasFriend,
        childrenCount: childrenCount.toNumber()
      };
    } catch (error) {
      console.error('加载用户信息失败:', error);
    } finally {
      loading.value = false;
    }
  }

  async function bindReferral(referrerAddress) {
    try {
      loading.value = true;
      const tx = await contract.value.lockReferral(referrerAddress);
      await tx.wait();
      await loadUserInfo();
      return { success: true };
    } catch (error) {
      return { success: false, error: handleContractError(error) };
    } finally {
      loading.value = false;
    }
  }

  return {
    contract,
    userAddress,
    userInfo,
    loading,
    bindReferral,
    loadUserInfo
  };
}
```

---

## 最佳实践

### 1. 用户体验优化

```javascript
// 在绑定前进行完整校验
async function bindReferralWithValidation(referrerAddress) {
  try {
    // 1. 地址格式校验
    if (!ethers.utils.isAddress(referrerAddress)) {
      throw new Error('推荐人地址格式错误');
    }

    // 2. 检查是否已绑定
    const userAddress = await signer.getAddress();
    const hasLocked = await referralContract.hasLockedReferral(userAddress);
    if (hasLocked) {
      throw new Error('您已经绑定过推荐人');
    }

    // 3. 检查推荐人是否存在（可选）
    const referrerInfo = await referralContract.getUserInfo(referrerAddress);
    if (!referrerInfo.hasReferral && referrerAddress !== rootAddress) {
      // 警告：推荐人本人还未绑定推荐人
      console.warn('推荐人本人尚未绑定推荐关系');
    }

    // 4. Gas 估算
    const gasEstimate = await referralContract.estimateGas.lockReferral(
      referrerAddress
    );
    console.log('预估 Gas:', gasEstimate.toString());

    // 5. 发送交易
    const tx = await referralContract.lockReferral(referrerAddress, {
      gasLimit: gasEstimate.mul(120).div(100) // 增加 20% 安全边际
    });

    // 6. 等待确认（显示进度）
    const receipt = await tx.wait();

    return { success: true, receipt };
  } catch (error) {
    return { success: false, error: handleContractError(error) };
  }
}
```

### 2. 性能优化

```javascript
// 使用批量查询减少 RPC 调用
async function loadTeamMembers(userAddress) {
  try {
    // 1. 获取下线列表
    const children = await referralContract.getChildren(userAddress);

    if (children.length === 0) {
      return [];
    }

    // 2. 批量查询下线信息
    const batchSize = 50; // 每次最多查询 50 个
    const results = [];

    for (let i = 0; i < children.length; i += batchSize) {
      const batch = children.slice(i, i + batchSize);
      const batchInfo = await referralContract.batchGetUserInfo(batch);

      results.push(...formatBatchResult(batch, batchInfo));
    }

    return results;
  } catch (error) {
    console.error('加载团队成员失败:', error);
    throw error;
  }
}

function formatBatchResult(addresses, [referrers, friends, hasReferrals, hasFriends]) {
  return addresses.map((address, index) => ({
    address,
    referrer: referrers[index],
    friend: friends[index],
    hasReferral: hasReferrals[index],
    hasFriend: hasFriends[index]
  }));
}
```

### 3. 缓存策略

```javascript
// 使用缓存减少链上查询
class ReferralCache {
  constructor(contract) {
    this.contract = contract;
    this.cache = new Map();
    this.cacheTimeout = 60000; // 1 分钟过期
  }

  async getUserInfo(address) {
    const cacheKey = `userInfo:${address}`;
    const cached = this.cache.get(cacheKey);

    if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
      return cached.data;
    }

    const data = await this.contract.getUserInfo(address);
    this.cache.set(cacheKey, {
      data,
      timestamp: Date.now()
    });

    return data;
  }

  invalidate(address) {
    this.cache.delete(`userInfo:${address}`);
  }

  clear() {
    this.cache.clear();
  }
}
```

### 4. 错误重试机制

```javascript
/**
 * 自动重试函数
 * @param {Function} fn - 要执行的异步函数
 * @param {number} maxRetries - 最大重试次数
 * @param {number} delay - 重试延迟（毫秒）
 */
async function retryWithBackoff(fn, maxRetries = 3, delay = 1000) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (i === maxRetries - 1) throw error;

      console.log(`重试 ${i + 1}/${maxRetries}...`);
      await new Promise(resolve => setTimeout(resolve, delay * (i + 1)));
    }
  }
}

// 使用示例
const userInfo = await retryWithBackoff(
  () => referralContract.getUserInfo(userAddress)
);
```

### 5. 链上数据同步

```javascript
// 监听事件并更新本地状态
class ReferralEventListener {
  constructor(contract) {
    this.contract = contract;
    this.listeners = [];
  }

  start() {
    // 监听推荐人绑定
    this.contract.on('ReferralBound', (user, referrer, timestamp) => {
      this.notifyListeners('referralBound', { user, referrer, timestamp });
    });

    // 监听好友绑定
    this.contract.on('FriendBound', (user, friend, timestamp) => {
      this.notifyListeners('friendBound', { user, friend, timestamp });
    });
  }

  stop() {
    this.contract.removeAllListeners();
  }

  subscribe(callback) {
    this.listeners.push(callback);
    return () => {
      this.listeners = this.listeners.filter(cb => cb !== callback);
    };
  }

  notifyListeners(event, data) {
    this.listeners.forEach(callback => callback(event, data));
  }
}

// 使用示例
const eventListener = new ReferralEventListener(referralContract);
eventListener.start();

eventListener.subscribe((event, data) => {
  console.log('事件:', event, data);
  // 更新 UI
});
```

---

## 常见问题

### Q1: 用户可以修改已绑定的推荐人吗？

**A**: 不可以。推荐人和好友关系一旦绑定，永久生效，无法修改。请在绑定前务必确认地址正确。

### Q2: 如果不提供推荐人地址会怎样？

**A**: 如果传入 `address(0)` 或空地址，系统会自动将 `rootAddress` 设为推荐人。

### Q3: 推荐链最多支持多少层？

**A**: 最多支持 30 层（`MAX_REFERRAL_DEPTH = 30`）。

### Q4: 如何防止循环引用？

**A**: 合约内置循环引用检测。如果绑定会导致循环（如 A→B→C→A），交易会失败并返回 `CircularReference` 错误。

### Q5: 批量查询有数量限制吗？

**A**: 理论上没有硬性限制，但建议单次不超过 100 个地址，避免 Gas 超限或 RPC 超时。

### Q6: 如何处理网络切换？

```javascript
// 监听网络切换
window.ethereum.on('chainChanged', (chainId) => {
  console.log('网络已切换:', chainId);
  // 重新初始化合约
  window.location.reload();
});

// 监听账户切换
window.ethereum.on('accountsChanged', (accounts) => {
  console.log('账户已切换:', accounts[0]);
  // 重新加载用户数据
});
```

---

## 参考资源

- **合约源码**: `contracts/SYI-Referral/SYIReferral.sol`
- **部署脚本**: `scripts/deployReferral.js`
- **测试脚本**: `scripts/testReferralPaged.js`
- **部署说明**: `doc/SYI-Referral部署说明文档.md`
- **Ethers.js 文档**: https://docs.ethers.org/v5/
- **Web3.js 文档**: https://web3js.readthedocs.io/

---

## 更新日志

- **2025-11-29**: 初版发布，完整覆盖所有合约接口
