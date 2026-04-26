# M-02: setRootAddress 未处理已绑定用户的推荐链 — 详细分析

## 1. 问题概述

**合约:** `StakingBase.sol`
**函数:** `setRootAddress()` (第 483-487 行)
**严重等级:** 中危 (Medium)
**影响范围:** 推荐关系系统、团队 KPI 计算、奖励分配

当 Owner 调用 `setRootAddress` 切换根地址时，合约仅做了三件事：
1. 将旧 root 的 `_hasLocked` 设为 `false`
2. 更新 `rootAddress` 状态变量
3. 将新 root 的 `_hasLocked` 设为 `true`

```solidity
function setRootAddress(address _rootAddress) external onlyOwner {
    _hasLocked[rootAddress] = false;
    rootAddress = _rootAddress;
    _hasLocked[_rootAddress] = true;
}
```

**但合约没有处理以下任何事项：**
- 已绑定旧 root 的用户的推荐关系（`_referrals` 映射）
- 旧 root 的子节点列表（`_children` 映射）
- 旧 root 积累的团队投资值（`teamTotalInvestValue`）
- 旧 root 在整棵推荐树中作为"终止节点"的角色

---

## 2. 推荐系统数据结构回顾

理解问题前，需要先理解推荐系统的数据结构：

```
状态变量:
├── rootAddress          — 推荐树的根节点地址
├── _referrals[user]     — 用户 → 其推荐人（向上指针）
├── _children[user]      — 用户 → 其直推用户列表（向下指针）
├── _hasLocked[user]     — 用户是否已锁定（绑定推荐关系的前提）
└── teamTotalInvestValue[user] — 用户下属团队的总投资额
```

推荐树的结构：
```
          rootAddress (旧)
         /     |      \
      UserA  UserB  UserC
      /   \          |
  UserD  UserE    UserF
```

关键约束：
- `_referrals[rootAddress] == address(0)` — root 没有推荐人，链到此终止
- `_hasLocked[rootAddress] == true` — 允许新用户绑定 root 作为推荐人
- `rootAddress` 在 `_getUserTier()` 中返回 tier 0（不参与等级奖励）
- `rootAddress` 是未分配团队奖励的兜底接收地址

---

## 3. 逐项问题分析

### 3.1 推荐链断裂 — 树分裂为两个不连通子图

**切换前的推荐树：**
```
          oldRoot (rootAddress)
         /     |      \
      UserA  UserB  UserC    ← _referrals[UserA] = oldRoot
      /   \                  ← _referrals[UserD] = UserA
  UserD  UserE
```

**切换后（调用 `setRootAddress(newRoot)`）：**
```
子图1:                    子图2:
     oldRoot (孤立)         newRoot (rootAddress, 孤立)
    /     |      \
 UserA  UserB  UserC        （没有任何用户绑定到 newRoot）
 /   \
UserD UserE
```

**结果：**
- 所有已有用户的 `_referrals` 仍然指向旧的上级，链最终到达 `oldRoot`
- `newRoot` 是一个**没有任何子节点的空节点**
- 新用户可以绑定到 `newRoot`（因为 `_hasLocked[newRoot] = true`），但他们与旧用户处于完全不同的子树

### 3.2 旧 Root 变为"幽灵节点"

调用 `setRootAddress` 后，旧 root 的状态：

| 属性 | 值 | 问题 |
|------|-----|------|
| `_hasLocked[oldRoot]` | `false` | 新用户无法绑定到旧 root |
| `_referrals[oldRoot]` | `address(0)` | 链到旧 root 仍然正常终止 |
| `_children[oldRoot]` | `[UserA, UserB, UserC]` | 旧 root 仍然有子节点 |
| `teamTotalInvestValue[oldRoot]` | 历史累计值 | 数据未迁移，成为脏数据 |

旧 root 不再是 `rootAddress`，导致：

**`_getUserTier` 行为变化：**
```solidity
function _getUserTier(address user) private view returns (uint8 tier) {
    if (user == rootAddress) {  // 现在只匹配 newRoot
        return 0;
    }
    // oldRoot 现在会被当作普通用户计算 tier！
    uint256 teamKPI = getTeamKpi(user);
    // oldRoot 的 teamKPI 仍有历史累积值，可能获得很高的 tier
    ...
}
```

旧 root 原本被豁免（返回 tier 0），切换后却会被当成一个拥有大量 `teamTotalInvestValue` 的普通用户。这在 `_distributeHybridRewards` 中可能导致旧 root 获得它不应该获得的团队等级奖励。

### 3.3 团队投资值 (teamTotalInvestValue) 数据不一致

`teamTotalInvestValue` 通过以下函数维护：

```solidity
// 质押时：向上遍历推荐链，每个祖先节点 +amount
// 解质押时：向上遍历推荐链，每个祖先节点 -amount
function _updateTeamInvestmentValues(address user, uint256 amount, bool isIncrease) internal {
    address[] memory referralChain = getReferrals(user, maxD);
    for (uint8 i = 0; i < referralChain.length; ) {
        if (isIncrease) {
            teamTotalInvestValue[referralChain[i]] += amount;
        } else {
            teamTotalInvestValue[referralChain[i]] -= amount;
        }
    }
}
```

切换 root 后：
- `teamTotalInvestValue[oldRoot]` 仍保留着所有下属用户的累计投资值
- `teamTotalInvestValue[newRoot]` 为 0
- 后续旧用户的 stake/unstake 仍然会更新 `teamTotalInvestValue[oldRoot]`（因为他们的推荐链仍然到达旧 root）
- 新用户（绑定到 newRoot 的）的 stake/unstake 只更新 `teamTotalInvestValue[newRoot]`

**这意味着"团队总投资额"被分裂到两个不相关的地址上。**

### 3.4 奖励分配的不一致

`_distributeTeamReward` 中有两处使用 `rootAddress`：

```solidity
// 情况1: 无推荐链时，全部团队费给 rootAddress
if (referralChain.length == 0) {
    IERC20(USDX).transfer(rootAddress, fee);  // → newRoot
    return fee;
}

// 情况2: 未分配完的团队奖励给 rootAddress
if (totalDistributed < fee) {
    marketingAmount = fee - totalDistributed;
    IERC20(USDX).transfer(rootAddress, marketingAmount);  // → newRoot
}
```

但 `_distributeHybridRewards` 中的奖励分配是基于推荐链遍历的：
- 旧用户的推荐链仍然到达 `oldRoot`
- `oldRoot` 可能在链中被遍历到，并且因为 `_getUserTier(oldRoot)` 不再返回 0，可能获得等级奖励

**结果：**
- "兜底"费用（无推荐链/剩余金额）→ `newRoot`
- 链上遍历到的 `oldRoot` → 可能获得等级奖励（本不应该）
- 奖励分配逻辑出现内在矛盾

### 3.5 旧 Root 的 `_hasLocked = false` 阻断新绑定

`lockReferral` 和 `adminBindReferral` 中都有检查：

```solidity
if (!_hasLocked[_referrer]) revert InvalidReferrer();
```

旧 root 的 `_hasLocked` 被设为 `false` 后：
- 即使旧 root 仍是某些用户的推荐人（`_referrals[UserA] = oldRoot`），新用户也**无法再绑定到旧 root**
- 但旧 root 下面的用户（如 UserA、UserB）的 `_hasLocked` 仍为 `true`，新用户可以绑定到他们
- 这导致旧 root 下的子树可以继续"向下生长"，但旧 root 本身无法再接收新的直推用户

---

## 4. 具体场景模拟

### 场景：正常运营后切换 Root

**初始状态：**
- `rootAddress = 0xOldRoot`
- 用户 A 绑定推荐人为 `0xOldRoot`
- 用户 B 绑定推荐人为用户 A
- 用户 B 质押了 1000 USDX
- `teamTotalInvestValue[0xOldRoot] = 1000`
- `teamTotalInvestValue[UserA] = 1000`

**Owner 调用 `setRootAddress(0xNewRoot)`：**

| 操作 | 结果 |
|------|------|
| `_hasLocked[0xOldRoot] = false` | 旧 root 不再可被绑定 |
| `rootAddress = 0xNewRoot` | 状态变量更新 |
| `_hasLocked[0xNewRoot] = true` | 新 root 可被绑定 |

**切换后各查询结果：**

| 查询 | 结果 | 是否正确 |
|------|------|---------|
| `getReferrals(UserB, 30)` | `[UserA, 0xOldRoot]` | 仍指向旧 root |
| `getTeamKpi(0xOldRoot)` | `1000` | 旧数据未清理 |
| `getTeamKpi(0xNewRoot)` | `0` | 新 root 无数据 |
| `_getUserTier(0xOldRoot)` | 根据 KPI=1000 计算 | 错误，应返回 0 |
| `_getUserTier(0xNewRoot)` | `0` (特殊判断) | 正确 |

**切换后用户 B 解质押：**
1. 推荐链遍历：`getReferrals(UserB, 30)` → `[UserA, 0xOldRoot]`
2. 团队投资更新：`teamTotalInvestValue[UserA] -= 1000`, `teamTotalInvestValue[0xOldRoot] -= 1000`
3. 团队奖励分配：遍历链 `[UserA, 0xOldRoot]`
   - `_getUserTier(0xOldRoot)` 不再返回 0，而是基于其 KPI 和个人质押计算
   - 如果旧 root 的 tier > 0，它会获得等级奖励（不应该获得）
4. 未分配奖励发给 `rootAddress`（即 `0xNewRoot`）

**切换后新用户 C 绑定 `0xNewRoot` 并质押：**
1. `_referrals[UserC] = 0xNewRoot`
2. `teamTotalInvestValue[0xNewRoot] += stakeAmount`
3. UserC 的推荐链：`[0xNewRoot]`
4. 与 UserA、UserB 完全独立，无法形成统一的团队

---

## 5. 解决方案

### 方案一：禁用 `setRootAddress`（最简方案）

如果业务上不需要切换 root，最安全的做法是移除该函数或将 `rootAddress` 设为 `immutable`。

```solidity
address private immutable rootAddress;
```

**优点：** 彻底消除问题
**缺点：** 失去运营灵活性

### 方案二：仅更新 `rootAddress` 的功能性角色（推荐方案）

核心思路：`rootAddress` 的两个角色分离：
1. **推荐树的根节点**（不应变更，因为树结构已固化）
2. **兜底费用接收地址**（可以变更）

将"兜底费用接收地址"拆分为独立变量：

```solidity
address private rootAddress;         // 推荐树根节点 (不可变)
address private feeCollector;        // 兜底费用接收地址 (可变)

// 构造函数中
rootAddress = _rootAddress;
feeCollector = _rootAddress;  // 初始相同

// 新函数: 只改费用接收地址
function setFeeCollector(address _feeCollector) external onlyOwner {
    require(_feeCollector != address(0), "Invalid address");
    feeCollector = _feeCollector;
}

// _distributeTeamReward 中改为:
IERC20(USDX).transfer(feeCollector, marketingAmount);
```

**优点：**
- 推荐树结构不受影响
- `teamTotalInvestValue` 不需要迁移
- `_getUserTier(rootAddress)` 仍然正确返回 0
- 运营方可以灵活更改费用接收地址

**缺点：** 引入新的状态变量，需要审查所有使用 `rootAddress` 的地方

### 方案三：完整迁移（复杂但彻底）

如果确实需要更换推荐树的根节点，需要完整处理所有关联数据：

```solidity
function setRootAddress(address _newRoot) external onlyOwner {
    require(_newRoot != address(0), "Invalid address");
    require(_newRoot != rootAddress, "Same address");

    address oldRoot = rootAddress;

    // 1. 迁移旧 root 直推用户的推荐关系到新 root
    address[] storage children = _children[oldRoot];
    for (uint256 i = 0; i < children.length; i++) {
        _referrals[children[i]] = _newRoot;
        _children[_newRoot].push(children[i]);
    }
    delete _children[oldRoot];

    // 2. 迁移 teamTotalInvestValue
    teamTotalInvestValue[_newRoot] = teamTotalInvestValue[oldRoot];
    teamTotalInvestValue[oldRoot] = 0;

    // 3. 更新锁定状态
    _hasLocked[oldRoot] = false;
    _hasLocked[_newRoot] = true;

    // 4. 更新 rootAddress
    rootAddress = _newRoot;

    emit RootAddressChanged(oldRoot, _newRoot);
}
```

**优点：** 完整处理了所有关联数据，推荐链不断裂
**缺点：**
- 如果旧 root 的直推用户很多，循环可能消耗大量 Gas，导致交易失败
- 需要新增事件 `RootAddressChanged`
- 仅迁移了**直推**用户，间接用户（如 UserD → UserA → oldRoot）的链通过 UserA 自动连接到新 root，无需额外处理

### 方案四：方案二 + 方案三的混合（推荐的最优方案）

综合考虑，推荐将 `rootAddress` 的双重角色拆分，并在确实需要迁移时提供迁移函数：

```solidity
// 状态变量
address private rootAddress;
address private feeCollector;

// 改变费用接收地址 (常用操作，低风险)
function setFeeCollector(address _feeCollector) external onlyOwner {
    require(_feeCollector != address(0), "Invalid address");
    emit FeeCollectorChanged(feeCollector, _feeCollector);
    feeCollector = _feeCollector;
}

// 迁移推荐树根节点 (极少使用，需要完整迁移)
function migrateRootAddress(address _newRoot) external onlyOwner {
    require(_newRoot != address(0), "Invalid address");
    require(_newRoot != rootAddress, "Same address");
    require(_referrals[_newRoot] == address(0), "New root already has referrer");

    address oldRoot = rootAddress;

    // 迁移直推用户
    address[] storage oldChildren = _children[oldRoot];
    uint256 childCount = oldChildren.length;
    for (uint256 i = 0; i < childCount; i++) {
        _referrals[oldChildren[i]] = _newRoot;
        _children[_newRoot].push(oldChildren[i]);
    }
    delete _children[oldRoot];

    // 迁移团队投资值
    teamTotalInvestValue[_newRoot] = teamTotalInvestValue[oldRoot];
    teamTotalInvestValue[oldRoot] = 0;

    // 更新锁定状态
    _hasLocked[oldRoot] = false;
    _hasLocked[_newRoot] = true;

    // 更新根地址和费用收集地址
    rootAddress = _newRoot;
    feeCollector = _newRoot;

    emit RootAddressMigrated(oldRoot, _newRoot, childCount);
}

// 删除原有 setRootAddress 函数
```

---

## 6. 各方案对比

| 维度 | 方案一(禁用) | 方案二(角色分离) | 方案三(完整迁移) | 方案四(混合) |
|------|-------------|-----------------|-----------------|-------------|
| 实现复杂度 | 极低 | 低 | 中 | 中 |
| 推荐链完整性 | 无问题 | 无问题 | 完整迁移 | 完整迁移 |
| KPI 数据一致性 | 无问题 | 无问题 | 完整迁移 | 完整迁移 |
| 运营灵活性 | 无 | 中(仅改费用地址) | 高 | 高 |
| Gas 风险 | 无 | 无 | 高(大量子节点时) | 高(大量子节点时) |
| 推荐场景 | root 永不变更 | 只需改费用地址 | 需要完全迁移 root | 通用场景 |

---

## 7. 建议

1. **首先明确业务需求**：`setRootAddress` 的使用场景是什么？是为了更换费用接收地址，还是真的需要迁移整棵推荐树？

2. **如果只是改费用地址** → 采用**方案二**，将 `rootAddress` 的"费用接收"角色拆分为 `feeCollector`

3. **如果需要真正迁移 root** → 采用**方案四**，但需要注意：
   - 迁移前评估旧 root 的直推子节点数量，确保 Gas 可控
   - 如果子节点过多，考虑分批迁移（但这会增加实现复杂度）
   - 迁移操作应该极少执行（理想状态下只在部署初期调整）

4. **无论采用哪种方案**，当前的 `setRootAddress` 都不应在生产环境中使用。在修复前，Owner 应避免调用此函数。
