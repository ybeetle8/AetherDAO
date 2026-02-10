# Aether-Referral 推荐关系管理合约部署说明文档

## 一、合约概述

Aether-Referral 是一个独立的推荐关系管理合约,用于管理用户的推荐人和好友关系。该合约支持推荐链查询、关系绑定、批量查询等功能。

### 核心特性

- **推荐关系管理**: 用户可以绑定推荐人,建立推荐链
- **好友关系管理**: 用户可以绑定好友,用于固定奖励分配
- **循环引用检测**: 自动检测并防止推荐关系形成循环
- **推荐链查询**: 支持查询任意深度的推荐链(最大30层)
- **批量查询**: 支持批量查询用户信息,提升前端性能
- **关系树可视化**: 可以查询用户的直接下线和完整推荐树

---

## 二、合约部署

### 2.1 前置条件

1. **安装依赖**:
```bash
npm install
```

2. **启动本地节点**(如果是本地测试):
```bash
npx hardhat node --hostname 0.0.0.0 --port 8545
```

### 2.2 编译合约

```bash
npx hardhat compile
```

### 2.3 部署到本地网络

```bash
npx hardhat run scripts/deployAetherReferral.js --network localhost
```

**部署输出示例**:
```
========================================
开始部署 Aether-Referral 合约...
========================================

部署账户: 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
账户余额: 10000.0 ETH

根地址(Root Address): 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266

正在部署 AetherReferral 合约...
✅ AetherReferral 合约部署成功!
   地址: 0x5075F0324f90bAFDc7837E8C68C9ec6e6bCaE938
   区块: 69877720

========================================
验证合约状态...
========================================

合约根地址: 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
最大推荐链深度: 30

========================================
部署信息已保存到: aether-referral-deployment.json
========================================

🎉 Aether-Referral 合约部署完成!

合约地址: 0x5075F0324f90bAFDc7837E8C68C9ec6e6bCaE938
```

### 2.4 部署到 BSC 测试网

修改 `hardhat.config.js` 添加 BSC 测试网配置:

```javascript
networks: {
    bscTestnet: {
        url: "https://data-seed-prebsc-1-s1.binance.org:8545",
        chainId: 97,
        accounts: [PRIVATE_KEY]
    }
}
```

然后部署:
```bash
npx hardhat run scripts/deployAetherReferral.js --network bscTestnet
```

### 2.5 部署到 BSC 主网

```bash
npx hardhat run scripts/deployAetherReferral.js --network bsc
```

---

## 三、运行测试

### 3.1 运行测试脚本

```bash
npx hardhat run scripts/testAetherReferral.js --network localhost
npx hardhat run scripts/testAetherReferralPaged.js --network localhost

```

### 3.2 测试用例说明

测试脚本会执行以下测试:

1. **建立推荐关系**: 创建一个包含10个账户的推荐树
2. **建立好友关系**: 部分账户绑定好友
3. **查询单个用户信息**: 查询每个账户的推荐人、好友、绑定状态
4. **查询推荐链**: 查询指定用户的完整推荐链
5. **查询推荐链(带深度)**: 查询推荐链并显示每层深度
6. **查询直接下线**: 查询指定用户的直接下线列表
7. **批量查询用户信息**: 批量查询多个用户信息
8. **关系树可视化**: 递归打印完整推荐关系树

### 3.3 测试输出示例

```
============================================================
测试 8: 关系树可视化
============================================================

推荐关系树:

账户 0 (0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266)
  └─ 账户 1 (下线: 2)
    └─ 账户 3 (下线: 1)
      └─ 账户 7 (下线: 0)
    └─ 账户 4 (下线: 1)
      └─ 账户 8 (下线: 0)
  └─ 账户 2 (下线: 2)
    └─ 账户 5 (下线: 1)
      └─ 账户 9 (下线: 0)
    └─ 账户 6 (下线: 0)
```

---

## 四、合约功能详解

### 4.1 绑定推荐人 (lockReferral)

**功能**: 用户绑定推荐人,建立推荐关系。

**调用示例**:
```javascript
// 用户绑定推荐人
await referral.connect(user).lockReferral(referrerAddress);
```

**规则**:
- 每个用户只能绑定一次推荐人
- 不能绑定自己为推荐人
- 自动检测循环引用,防止 A→B→C→A 的情况
- 如果传入 `address(0)`,自动绑定为 `rootAddress`

**事件**:
```solidity
event ReferralBound(
    address indexed user,
    address indexed referrer,
    uint256 timestamp
);
```

---

### 4.2 绑定好友 (lockFriend)

**功能**: 用户绑定好友,用于固定奖励分配。

**调用示例**:
```javascript
// 用户绑定好友
await referral.connect(user).lockFriend(friendAddress);
```

**规则**:
- 每个用户只能绑定一次好友
- 不能绑定自己为好友
- 好友地址不能为 `address(0)`

**事件**:
```solidity
event FriendBound(
    address indexed user,
    address indexed friend,
    uint256 timestamp
);
```

---

### 4.3 查询推荐人 (getReferral)

**功能**: 查询用户的推荐人地址。

**调用示例**:
```javascript
const referrer = await referral.getReferral(userAddress);
```

**返回值**: 推荐人地址,如果未绑定返回 `address(0)`

---

### 4.4 查询好友 (getFriend)

**功能**: 查询用户的好友地址。

**调用示例**:
```javascript
const friend = await referral.getFriend(userAddress);
```

**返回值**: 好友地址,如果未绑定返回 `address(0)`

---

### 4.5 查询推荐链 (getReferrals)

**功能**: 查询用户的完整推荐链(从近到远)。

**调用示例**:
```javascript
// 查询推荐链,最大深度30层
const referrals = await referral.getReferrals(userAddress, 30);

// 输出推荐链
for (let i = 0; i < referrals.length; i++) {
    console.log(`第${i + 1}层推荐人: ${referrals[i]}`);
}
```

**返回值**: 推荐人地址数组,按从近到远排序

**示例输出**:
```
第1层推荐人: 0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc (账户 5)
第2层推荐人: 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC (账户 2)
第3层推荐人: 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 (账户 0)
```

---

### 4.6 查询推荐链(带深度) (getReferralChainWithDepth)

**功能**: 查询推荐链并返回每个地址的深度。

**调用示例**:
```javascript
const { chain, depths } = await referral.getReferralChainWithDepth(userAddress, 30);

for (let i = 0; i < chain.length; i++) {
    console.log(`深度${depths[i]}: ${chain[i]}`);
}
```

**返回值**:
- `chain`: 推荐人地址数组
- `depths`: 对应的深度数组(从1开始)

---

### 4.7 查询直接下线 (getChildren)

**功能**: 查询用户的直接下线列表。

**调用示例**:
```javascript
const children = await referral.getChildren(userAddress);
console.log(`直接下线数量: ${children.length}`);
```

**返回值**: 直接下线地址数组

---

### 4.8 查询用户信息 (getUserInfo)

**功能**: 查询用户的完整关系信息。

**调用示例**:
```javascript
const userInfo = await referral.getUserInfo(userAddress);
console.log('推荐人:', userInfo.referrer);
console.log('好友:', userInfo.friend);
console.log('已绑定推荐人:', userInfo.hasReferral);
console.log('已绑定好友:', userInfo.hasFriend);
console.log('直接下线数量:', userInfo.childrenCount.toString());
```

**返回值**:
```solidity
struct UserInfo {
    address referrer;        // 推荐人地址
    address friend;          // 好友地址
    bool hasReferral;        // 是否已绑定推荐人
    bool hasFriend;          // 是否已绑定好友
    uint256 childrenCount;   // 直接下线数量
}
```

---

### 4.9 批量查询用户信息 (batchGetUserInfo)

**功能**: 批量查询多个用户的信息,提升前端性能。

**调用示例**:
```javascript
const users = [user1, user2, user3, user4, user5];
const batchInfo = await referral.batchGetUserInfo(users);

for (let i = 0; i < users.length; i++) {
    console.log(`用户 ${i}:`);
    console.log(`  推荐人: ${batchInfo.referrers[i]}`);
    console.log(`  好友: ${batchInfo.friends[i]}`);
    console.log(`  已绑定推荐人: ${batchInfo.hasReferrals[i]}`);
    console.log(`  已绑定好友: ${batchInfo.hasFriends[i]}`);
}
```

**返回值**:
```solidity
struct BatchUserInfo {
    address[] referrers;      // 推荐人数组
    address[] friends;        // 好友数组
    bool[] hasReferrals;      // 是否已绑定推荐人数组
    bool[] hasFriends;        // 是否已绑定好友数组
}
```

---

## 五、前端集成示例

### 5.1 初始化合约

```javascript
import { ethers } from 'ethers';
import AetherReferralABI from './abis/AetherReferral.json';

// 连接到合约
const provider = new ethers.providers.JsonRpcProvider('http://localhost:8545');
const referralAddress = '0x5075F0324f90bAFDc7837E8C68C9ec6e6bCaE938';
const referral = new ethers.Contract(referralAddress, AetherReferralABI, provider);
```

### 5.2 绑定推荐人

```javascript
async function bindReferral(userSigner, referrerAddress) {
    try {
        const tx = await referral.connect(userSigner).lockReferral(referrerAddress);
        await tx.wait();
        console.log('推荐人绑定成功!');
        return true;
    } catch (error) {
        console.error('绑定失败:', error);
        return false;
    }
}
```

### 5.3 查询用户推荐链

```javascript
async function getUserReferralChain(userAddress) {
    const referrals = await referral.getReferrals(userAddress, 30);
    return referrals;
}
```

### 5.4 查询用户完整信息

```javascript
async function getUserFullInfo(userAddress) {
    const userInfo = await referral.getUserInfo(userAddress);
    const children = await referral.getChildren(userAddress);
    const referrals = await referral.getReferrals(userAddress, 30);

    return {
        referrer: userInfo.referrer,
        friend: userInfo.friend,
        hasReferral: userInfo.hasReferral,
        hasFriend: userInfo.hasFriend,
        childrenCount: userInfo.childrenCount.toString(),
        children: children,
        referralChain: referrals
    };
}
```

### 5.5 监听事件

```javascript
// 监听推荐人绑定事件
referral.on('ReferralBound', (user, referrer, timestamp, event) => {
    console.log(`用户 ${user} 绑定了推荐人 ${referrer}`);
});

// 监听好友绑定事件
referral.on('FriendBound', (user, friend, timestamp, event) => {
    console.log(`用户 ${user} 绑定了好友 ${friend}`);
});
```

---

## 六、安全机制

### 6.1 循环引用检测

合约内置循环引用检测机制,防止以下情况:

```
用户A → 用户B → 用户C → 用户A (❌ 不允许)
```

**检测逻辑**:
- 绑定推荐人时,自动检查推荐人的推荐链(最多30层)
- 如果发现用户自己在推荐链中,拒绝绑定
- 如果推荐人是 `rootAddress`,不会产生循环

### 6.2 单次绑定限制

- 每个用户只能绑定一次推荐人
- 每个用户只能绑定一次好友
- 绑定后不可修改

### 6.3 地址验证

- 推荐人地址如果为 `address(0)`,自动替换为 `rootAddress`
- 好友地址不能为 `address(0)`
- 不能绑定自己为推荐人或好友

---

## 七、管理员功能

### 7.1 设置根地址

**功能**: 修改根地址(默认推荐人)。

**调用示例**:
```javascript
await referral.connect(owner).setRootAddress(newRootAddress);
```

**事件**:
```solidity
event RootAddressUpdated(
    address indexed oldRoot,
    address indexed newRoot,
    uint256 timestamp
);
```

---

## 八、部署信息

部署成功后,合约信息会自动保存到 `aether-referral-deployment.json`:

```json
{
  "network": "localhost",
  "contractAddress": "0x5075F0324f90bAFDc7837E8C68C9ec6e6bCaE938",
  "rootAddress": "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
  "deployer": "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
  "deployedAt": "2025-11-29T12:34:56.789Z",
  "blockNumber": 69877720
}
```

---

## 九、常见问题

### Q1: 为什么绑定推荐人失败?

**可能原因**:
1. 用户已经绑定过推荐人
2. 尝试绑定自己为推荐人
3. 会产生循环引用

**解决方案**:
- 使用 `hasLockedReferral()` 检查是否已绑定
- 使用 `getReferral()` 查询当前推荐人
- 检查推荐人地址是否有效

### Q2: 如何查询某个用户的所有下线?

**答**: 使用 `getChildren()` 只能查询直接下线,如果要查询所有下线,需要递归查询:

```javascript
async function getAllDescendants(userAddress, maxDepth = 5) {
    const descendants = [];

    async function recurse(address, depth) {
        if (depth > maxDepth) return;

        const children = await referral.getChildren(address);
        for (const child of children) {
            descendants.push(child);
            await recurse(child, depth + 1);
        }
    }

    await recurse(userAddress, 0);
    return descendants;
}
```

### Q3: 推荐链最大深度是多少?

**答**: 最大深度为 30 层,这是为了防止 gas 消耗过大。

---

## 十、合约地址

### 本地网络
- **合约地址**: `0x5075F0324f90bAFDc7837E8C68C9ec6e6bCaE938`
- **根地址**: `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266`

### BSC 测试网
- 待部署

### BSC 主网
- 待部署

---

## 十一、文件结构

```
contracts/Aether-Referral/
└── AetherReferral.sol         # 推荐关系管理合约

scripts/
├── deployAetherReferral.js    # 部署脚本
└── testAetherReferral.js      # 测试脚本

aether-referral-deployment.json   # 部署信息(自动生成)
```

---

## 十二、更新日志

### v1.0.0 (2025-11-29)
- ✅ 初始版本发布
- ✅ 支持推荐人和好友绑定
- ✅ 支持推荐链查询
- ✅ 支持批量查询
- ✅ 内置循环引用检测
- ✅ 完整的事件系统

---

**文档版本**: v1.0
**最后更新**: 2025-11-29
**适用合约版本**: Solidity ^0.8.20
